import type { MemoryEntry } from "./task-schema.js";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicReplace, readTextIfPresent } from "./store/files.js";
import {
  appendCheckpoint,
  appendEntry,
  readCheckpoints,
  readEntries,
  type StoredMemoryEntry,
} from "./store/log.js";
import { withTaskLock } from "./store/lock.js";
import { assertSafePayloadRef, assertSafeTaskId } from "./store/paths.js";

export type TaskIdentifier = { id: string } | { name: string };

export interface TaskState {
  content: string;
}

export interface OpenTaskResult {
  taskId: string;
  state: TaskState;
  recentEntries: MemoryEntry[];
}

export class TaskStore {
  private static readonly RECENT_ENTRY_LIMIT = 50;
  private readonly tasksRoot: string;

  constructor(vaultRoot: string = process.cwd()) {
    this.tasksRoot = resolve(vaultRoot, "slime-mold", "tasks");
  }

  async open(task: TaskIdentifier): Promise<OpenTaskResult> {
    const taskId = "id" in task ? task.id : await this.findTaskIdByName(task.name);
    assertSafeTaskId(taskId);

    return withTaskLock(this.taskDir(taskId), async () => {
      await this.readMetadata(taskId);
      const state = await this.recoverState(taskId);
      const stored = await readEntries(this.entriesPath(taskId));
      const recentEntries = stored
        .slice(-TaskStore.RECENT_ENTRY_LIMIT)
        .map(stripSchemaVersion);
      return { taskId, state: { content: state }, recentEntries };
    });
  }

  async record(entry: MemoryEntry): Promise<void> {
    assertMemoryEntry(entry);
    assertSafeTaskId(entry.task_id);
    const taskDir = this.taskDir(entry.task_id);

    await withTaskLock(taskDir, async () => {
      await this.readMetadata(entry.task_id);
      await assertSafePayloadRef(taskDir, entry.payload_ref);
      const existing = await readEntries(this.entriesPath(entry.task_id));
      if (existing.some((candidate) => candidate.id === entry.id)) return;
      await mkdir(join(taskDir, "log"), { recursive: true });
      await appendEntry(this.entriesPath(entry.task_id), entry);
    });
  }

  async checkpoint(taskId: string, state: TaskState): Promise<void> {
    assertSafeTaskId(taskId);
    if (!isPlainRecord(state) || Object.keys(state).length !== 1 || typeof state.content !== "string") {
      throw new Error("Invalid checkpoint state");
    }

    await withTaskLock(this.taskDir(taskId), async () => {
      await this.readMetadata(taskId);
      await mkdir(join(this.taskDir(taskId), "log"), { recursive: true });
      await appendCheckpoint(this.checkpointsPath(taskId), state.content);
      await atomicReplace(this.statePath(taskId), state.content);
    });
  }

  async close(taskId: string): Promise<void> {
    assertSafeTaskId(taskId);
    await withTaskLock(this.taskDir(taskId), async () => {
      const metadata = await this.readMetadata(taskId);
      await atomicReplace(
        this.metadataPath(taskId),
        `${JSON.stringify({ ...metadata, status: "dormant" }, null, 2)}\n`,
      );
    });
  }

  private taskDir(taskId: string): string {
    return join(this.tasksRoot, taskId);
  }

  private metadataPath(taskId: string): string {
    return join(this.taskDir(taskId), "task.json");
  }

  private statePath(taskId: string): string {
    return join(this.taskDir(taskId), "state.md");
  }

  private entriesPath(taskId: string): string {
    return join(this.taskDir(taskId), "log", "entries.jsonl");
  }

  private checkpointsPath(taskId: string): string {
    return join(this.taskDir(taskId), "log", "checkpoints.jsonl");
  }

  private async readMetadata(taskId: string): Promise<Record<string, unknown>> {
    const text = await readTextIfPresent(this.metadataPath(taskId));
    if (text === undefined) throw new Error(`Task not found: ${taskId}`);
    try {
      const metadata: unknown = JSON.parse(text);
      if (!isPlainRecord(metadata)) throw new Error("metadata is not an object");
      if (typeof metadata.id === "string" && metadata.id !== taskId) {
        throw new Error(`Task metadata id does not match directory: ${taskId}`);
      }
      return metadata;
    } catch (error) {
      throw new Error(`Invalid task metadata: ${taskId}`, { cause: error });
    }
  }

  private async findTaskIdByName(name: string): Promise<string> {
    let directories;
    try {
      directories = await readdir(this.tasksRoot, { withFileTypes: true });
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) throw new Error(`Task not found by name: ${name}`);
      throw error;
    }

    const matches: string[] = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const metadata = await this.readMetadata(directory.name);
      if (metadata.name === name) matches.push(directory.name);
    }
    if (matches.length === 0) throw new Error(`Task not found by name: ${name}`);
    if (matches.length > 1) throw new Error(`Task name is ambiguous: ${name}`);
    return matches[0];
  }

  private async recoverState(taskId: string): Promise<string> {
    const checkpoints = await readCheckpoints(this.checkpointsPath(taskId));
    const durable = checkpoints.at(-1)?.content;
    if (durable !== undefined) {
      const current = await readTextIfPresent(this.statePath(taskId));
      if (current !== durable) await atomicReplace(this.statePath(taskId), durable);
      return durable;
    }
    return (await readTextIfPresent(this.statePath(taskId))) ?? "";
  }
}

function stripSchemaVersion(entry: StoredMemoryEntry): MemoryEntry {
  const { schema_version: _schemaVersion, ...memoryEntry } = entry;
  return memoryEntry;
}

function assertMemoryEntry(entry: MemoryEntry): void {
  if (!isPlainRecord(entry)) throw new Error("Invalid memory entry");
  const keys = [
    "id", "task_id", "agent", "session_id", "timestamp", "type", "layer", "kind",
    "summary", "payload_ref", "confidence", "source_scope",
  ];
  if (Object.keys(entry).length !== keys.length || keys.some((key) => !(key in entry))) {
    throw new Error("Memory entry must use the strict 12-field schema");
  }
  for (const field of ["id", "task_id", "agent", "session_id", "timestamp", "summary"] as const) {
    if (typeof entry[field] !== "string" || entry[field].length === 0) {
      throw new Error(`Invalid memory entry field: ${field}`);
    }
  }
  if (!new Set(["decision", "artifact", "observation", "question", "fact"]).has(entry.type)) {
    throw new Error("Invalid memory entry type");
  }
  if (!new Set(["fact", "draft"]).has(entry.layer)) throw new Error("Invalid memory layer");
  if (!new Set(["reference", "state"]).has(entry.kind)) throw new Error("Invalid memory kind");
  if (!new Set(["high", "medium", "low"]).has(entry.confidence)) {
    throw new Error("Invalid memory confidence");
  }
  if (entry.source_scope !== "personal") throw new Error("source_scope must be personal in P0");
  if (entry.payload_ref !== null && typeof entry.payload_ref !== "string") {
    throw new Error("Invalid payload_ref");
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(error: unknown, code: string): boolean {
  return isPlainRecord(error) && error.code === code;
}
