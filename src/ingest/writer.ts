import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { TaskStore } from "../task-store.js";
import type { AuthenticatedConnection } from "../prov/index.js";
import type { MemoryAgent, MemoryConfidence } from "../task-schema.js";
import type { AggregatedHighlight, TaskCandidate } from "./types.js";

export interface IngestWriteOptions {
  /** 本次摄入的 agent 标识。 */
  agent: MemoryAgent;
  /** 本次摄入的会话 id(写入 provenance)。 */
  sessionId: string;
  /** 写入时注入的置信度。 */
  confidence?: MemoryConfidence;
  /**
   * 幂等键:同一键重复跑不产生重复条目。
   * 摄入管线自持幂等清单(vault 内 slime-mold/ingest-state.json),
   * 不依赖存储层的 id 幂等(存储层 id 由服务端生成,见 prov/buildEntry)。
   */
  idempotencyKey: string;
}

interface IngestState {
  version: 1;
  /** 键:确定性条目键(见 entryKey);值:TaskStore 返回的服务端 id。 */
  entries: Record<string, string>;
}

/**
 * 把聚合候选写入 TaskStore。
 *
 * 写入语义(与 CONTRACT 对齐):
 * - 通过 TaskStore.open({name}) 创建/复用任务(P0 已支持 open 创建语义,W8);
 * - 每条 highlight 通过 record() 写入 draft 层(SPEC/CONTRACT:P0 只允许 draft);
 * - record 的服务端注入(id/agent/session_id/timestamp/confidence)由 TaskStore 完成,
 *   本层只提供内容字段,遵守 provenance 契约;
 * - 幂等由本层维护的 ingest-state.json 清单保证:同一确定性条目键
 *   (idempotencyKey + taskName + source session + seq)只写一次。
 */
export class TaskStoreWriter {
  private readonly store: TaskStore;
  private readonly statePath: string;
  private state: IngestState = { version: 1, entries: {} };

  constructor(store: TaskStore, vaultRoot: string) {
    this.store = store;
    this.statePath = join(resolve(vaultRoot), "slime-mold", "ingest-state.json");
  }

  /**
   * 写入一个任务候选。
   * 返回 { taskId, written, skipped }。
   */
  async writeCandidate(
    candidate: TaskCandidate,
    options: IngestWriteOptions,
  ): Promise<{ taskId: string; written: number; skipped: number }> {
    await this.loadState();
    const opened = await this.store.open({ name: candidate.taskName });
    const taskId = opened.taskId;

    let written = 0;
    let skipped = 0;
    const updatedEntries: IngestState["entries"] = {};

    for (const highlight of candidate.highlights) {
      const key = this.entryKey(options, candidate, highlight);
      const existingId = this.state.entries[key];

      if (existingId !== undefined) {
        skipped += 1;
        updatedEntries[key] = existingId;
        continue;
      }

      const connection: AuthenticatedConnection = {
        agent: options.agent,
        sessionId: options.sessionId,
        taskId,
        confidence: options.confidence ?? highlight.confidence,
      };

      const { id } = await this.store.record(connection, {
        type: highlight.entryType,
        layer: "draft",
        kind: "reference",
        summary: highlight.summary,
        payload_ref: null,
      });
      updatedEntries[key] = id;
      written += 1;
    }

    await this.saveState(updatedEntries);
    return { taskId, written, skipped };
  }

  /** 确定性条目键:同 idempotencyKey + 同会话同事件永远同键。 */
  private entryKey(
    options: IngestWriteOptions,
    candidate: TaskCandidate,
    highlight: AggregatedHighlight,
  ): string {
    const raw = [
      options.idempotencyKey,
      candidate.taskName,
      highlight.session.sessionId,
      String(highlight.event.seq),
    ].join("|");
    return createHash("sha256").update(raw, "utf8").digest("hex");
  }

  private async loadState(): Promise<void> {
    try {
      const text = await readFile(this.statePath, "utf8");
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as IngestState).version === 1 &&
        typeof (parsed as IngestState).entries === "object" &&
        (parsed as IngestState).entries !== null
      ) {
        this.state = parsed as IngestState;
        return;
      }
    } catch {
      // 文件不存在或损坏:重置为空清单。损坏的清单仅影响幂等(重跑会
      // 产生重复条目),不破坏既有数据;存储层本身有崩溃恢复。
    }
    this.state = { version: 1, entries: {} };
  }

  /** 合并本次写入的键并原子落盘。 */
  private async saveState(updatedEntries: IngestState["entries"]): Promise<void> {
    const merged: IngestState["entries"] = { ...this.state.entries, ...updatedEntries };
    this.state = { version: 1, entries: merged };
    await mkdir(dirname(this.statePath), { recursive: true });
    // 写入采用临时文件 + rename,避免崩溃时留下半截 JSON。
    const temporary = `${this.statePath}.${Date.now().toString(36)}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await rename(temporary, this.statePath);
  }
}
