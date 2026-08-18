import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TaskStore } from "../task-store.js";
import { SessionAggregator } from "./aggregate.js";
import { TaskStoreWriter } from "./writer.js";
import { CodexJsonlParser } from "./parsers/codex.js";
import { DshZstdParser } from "./parsers/dsh.js";
import { EdgeHistoryParser } from "./parsers/edge.js";
import type { MemoryAgent } from "../task-schema.js";
import type { ParsedSource, SourceParser } from "./types.js";

/**
 * 摄入管线主流程:三个数据源 → 归一化 → 会话→任务聚合 → TaskStore。
 *
 * 用法:
 *   const result = await runIngest({
 *     vaultRoot,
 *     sources: [
 *       { source: "codex", path: "C:/Users/Huawei/.codex/sessions" },
 *       { source: "dsh", path: ".../dsh-sessions" },
 *       { source: "edge", path: ".../Default/History" },
 *     ],
 *     agent: "dsh",
 *     sessionId: "ingest-run-2026-08-17",
 *   });
 */

export interface IngestSourceInput {
  source: "codex" | "dsh" | "edge";
  /** 数据源路径(目录或文件)。 */
  path: string;
  /** 解析失败时是否跳过(默认 true,单个源失败不中断整条管线)。 */
  optional?: boolean;
}

export interface IngestRunOptions {
  /** vault 根目录(TaskStore 的构造参数)。 */
  vaultRoot: string;
  /** 数据源清单。 */
  sources: IngestSourceInput[];
  /** 写入 TaskStore 时注入的 agent(服务端 provenance,CONTRACT §5)。 */
  agent: MemoryAgent;
  /** 本次摄入的 session id(写入 provenance)。 */
  sessionId: string;
  /** 幂等键:同键重复跑不产生重复条目。 */
  idempotencyKey: string;
}

export interface IngestRunResult {
  /** 每个数据源的解析统计。 */
  sources: Array<{ source: string; path: string; parsed: ParsedSource | null; error?: string }>;
  /** 聚合出的任务候选数。 */
  taskCandidates: number;
  /** 写入 TaskStore 的任务数。 */
  tasksWritten: number;
  /** 实际写入的条目数。 */
  entriesWritten: number;
  /** 因幂等键跳过的条目数。 */
  entriesSkipped: number;
  /** 更新后的 sm-config.json 内容。 */
  coverage: CoverageConfig;
}

/** 覆盖诚实区配置(SPEC 6.2),由管线维护,面板只读展示。 */
export interface CoverageConfig {
  version: 1;
  updatedAt: string;
  ingested: Array<{ source: string; sessions: number; events: number }>;
  missing: string[];
}

export async function runIngest(options: IngestRunOptions): Promise<IngestRunResult> {
  const store = new TaskStore(options.vaultRoot);
  const aggregator = new SessionAggregator();
  const writer = new TaskStoreWriter(store, options.vaultRoot);

  const parsedSources: Array<{
    source: string;
    path: string;
    parsed: ParsedSource | null;
    error?: string;
  }> = [];
  const allSessions: ParsedSource["sessions"] = [];
  const ingestedCoverage: CoverageConfig["ingested"] = [];

  for (const source of options.sources) {
    try {
      const parser = createParser(source.source);
      const parsed = await parser.parse(source.path);
      parsedSources.push({ source: source.source, path: source.path, parsed });
      allSessions.push(...parsed.sessions);
      ingestedCoverage.push({
        source: source.source,
        sessions: parsed.sessions.length,
        events: parsed.stats.totalEvents,
      });
    } catch (error) {
      parsedSources.push({
        source: source.source,
        path: source.path,
        parsed: null,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!source.optional) throw error;
    }
  }

  const candidates = aggregator.aggregate(allSessions);
  let tasksWritten = 0;
  let entriesWritten = 0;
  let entriesSkipped = 0;

  for (const candidate of candidates) {
    const { written, skipped } = await writer.writeCandidate(candidate, {
      agent: options.agent,
      sessionId: options.sessionId,
      idempotencyKey: options.idempotencyKey,
    });
    tasksWritten += 1;
    entriesWritten += written;
    entriesSkipped += skipped;
  }

  const coverage: CoverageConfig = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ingested: ingestedCoverage,
    missing: computeMissingSources(options.sources),
  };
  await writeCoverage(options.vaultRoot, coverage);

  return {
    sources: parsedSources,
    taskCandidates: candidates.length,
    tasksWritten,
    entriesWritten,
    entriesSkipped,
    coverage,
  };
}

function createParser(source: string): SourceParser {
  switch (source) {
    case "codex":
      return new CodexJsonlParser();
    case "dsh":
      return new DshZstdParser();
    case "edge":
      return new EdgeHistoryParser();
    default:
      throw new Error(`Unknown ingest source: ${source}`);
  }
}

/** 计算未接入数据源清单(覆盖诚实区)。 */
function computeMissingSources(sources: IngestSourceInput[]): string[] {
  const missing: string[] = [];
  if (!sources.some((source) => source.source === "codex")) missing.push("Codex 会话");
  if (!sources.some((source) => source.source === "dsh")) missing.push("DSH 会话");
  if (!sources.some((source) => source.source === "edge")) missing.push("Edge 浏览器历史");
  missing.push("ChatGPT 对话(待用户提供)");
  missing.push("Cursor 对话(待用户提供)");
  return missing;
}

/** 把覆盖诚实配置写入 vault 的 slime-mold/sm-config.json。 */
async function writeCoverage(vaultRoot: string, coverage: CoverageConfig): Promise<void> {
  const configPath = join(resolve(vaultRoot), "slime-mold", "sm-config.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
}
