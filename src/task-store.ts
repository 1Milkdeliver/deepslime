import type { MemoryEntry } from "./task-schema.js";
import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildEntry,
  type AuthenticatedConnection,
  type ClientContent,
} from "./prov/index.js";
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
    const taskId = "id" in task ? task.id : await this.findOrCreateTaskIdByName(task.name);
    assertSafeTaskId(taskId);

    // Preserve the explicit-id not-found contract instead of leaking the
    // canonical lock's realpath ENOENT for a directory that does not exist.
    if ("id" in task) await this.readMetadata(taskId);

    return withTaskLock(this.taskDir(taskId), async () => {
      await this.readMetadata(taskId);
      const state = await this.recoverState(taskId);
      const stored = await readEntries(this.entriesPath(taskId), taskId);
      const recentEntries = stored
        .slice(-TaskStore.RECENT_ENTRY_LIMIT)
        .map(stripSchemaVersion);
      return { taskId, state: { content: state }, recentEntries };
    });
  }

  async record(
    connection: AuthenticatedConnection,
    content: ClientContent,
  ): Promise<{ id: string }> {
    const entry = buildEntry(connection, content);
    assertSafeTaskId(connection.taskId);
    const taskDir = this.taskDir(connection.taskId);

    await withTaskLock(taskDir, async () => {
      await this.readMetadata(connection.taskId);
      await assertSafePayloadRef(taskDir, entry.payload_ref);
      await mkdir(join(taskDir, "log"), { recursive: true });
      await appendEntry(this.entriesPath(connection.taskId), entry);
    });
    return { id: entry.id };
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

  private async findOrCreateTaskIdByName(name: string): Promise<string> {
    await mkdir(this.tasksRoot, { recursive: true });

    // Name resolution and creation share the canonical tasks-root lock so two
    // stores (including stores reached through vault aliases) cannot create
    // duplicate tasks for the same previously unseen name.
    return withTaskLock(this.tasksRoot, async () => {
      const existingTaskId = await this.findTaskIdByName(name);
      if (existingTaskId !== undefined) return existingTaskId;

      const taskId = randomUUID();
      assertSafeTaskId(taskId);
      const taskDir = this.taskDir(taskId);
      await mkdir(taskDir, { recursive: true });

      await withTaskLock(taskDir, async () => {
        await mkdir(join(taskDir, "log"), { recursive: true });
        await atomicReplace(this.statePath(taskId), "");
        await atomicReplace(
          this.metadataPath(taskId),
          `${JSON.stringify({ id: taskId, name, status: "active" }, null, 2)}\n`,
        );
      });
      return taskId;
    });
  }

  private async findTaskIdByName(name: string): Promise<string | undefined> {
    let directories;
    try {
      directories = await readdir(this.tasksRoot, { withFileTypes: true });
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }

    const matches: string[] = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const metadata = await this.readMetadata(directory.name);
      if (metadata.name === name) matches.push(directory.name);
    }
    if (matches.length === 0) return undefined;
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(error: unknown, code: string): boolean {
  return isPlainRecord(error) && error.code === code;
}
