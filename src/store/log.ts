import type { MemoryEntry } from "../task-schema.js";
import { validateMemoryEntry } from "../validate/index.js";
import { atomicAppendJsonLine, parseJsonLines, readTextIfPresent } from "./files.js";

export interface StoredMemoryEntry extends MemoryEntry {
  schema_version: 1;
}

export interface CheckpointRecord {
  schema_version: 1;
  type: "checkpoint";
  content: string;
}

export async function readEntries(
  path: string,
  expectedTaskId: string,
): Promise<StoredMemoryEntry[]> {
  const text = await readTextIfPresent(path);
  if (text === undefined) return [];
  return parseJsonLines(path, text).map((value) => parseStoredEntry(value, expectedTaskId, path));
}

export async function appendEntry(path: string, entry: MemoryEntry): Promise<void> {
  await atomicAppendJsonLine(path, { schema_version: 1, ...entry });
}

export async function readCheckpoints(path: string): Promise<CheckpointRecord[]> {
  const text = await readTextIfPresent(path);
  if (text === undefined) return [];
  return parseJsonLines(path, text).map((value) => {
    if (
      !isRecord(value) ||
      value.schema_version !== 1 ||
      value.type !== "checkpoint" ||
      typeof value.content !== "string"
    ) {
      throw new Error(`Invalid checkpoint record in ${path}`);
    }
    return value as unknown as CheckpointRecord;
  });
}

export async function appendCheckpoint(path: string, content: string): Promise<void> {
  await atomicAppendJsonLine(path, {
    schema_version: 1,
    type: "checkpoint",
    content,
  } satisfies CheckpointRecord);
}

function parseStoredEntry(
  value: unknown,
  expectedTaskId: string,
  path: string,
): StoredMemoryEntry {
  let entry;
  try {
    entry = validateMemoryEntry(value);
  } catch (error) {
    throw new Error(`Invalid memory entry record in ${path}`, { cause: error });
  }
  if (entry.task_id !== expectedTaskId) {
    throw new Error(`Memory entry task_id does not match task: ${expectedTaskId}`);
  }
  return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
