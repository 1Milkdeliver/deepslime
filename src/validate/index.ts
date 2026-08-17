import { lstat, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  win32,
} from "node:path";

const ENTRY_TYPES = ["decision", "artifact", "observation", "question", "fact"] as const;
const ENTRY_LAYERS = ["fact", "draft"] as const;
const ENTRY_KINDS = ["reference", "state"] as const;
const AGENTS = ["claude-code", "dsh", "chatgpt", "cursor"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

const RECORD_FIELDS = ["type", "layer", "kind", "summary", "payload_ref"] as const;
const ENTRY_FIELDS = [
  "schema_version",
  "id",
  "task_id",
  "agent",
  "session_id",
  "timestamp",
  ...RECORD_FIELDS,
  "confidence",
  "source_scope",
] as const;

type EntryType = (typeof ENTRY_TYPES)[number];
type EntryLayer = (typeof ENTRY_LAYERS)[number];
type EntryKind = (typeof ENTRY_KINDS)[number];
type Agent = (typeof AGENTS)[number];
type Confidence = (typeof CONFIDENCES)[number];

export interface RecordInput {
  type: EntryType;
  layer: "draft";
  kind: EntryKind;
  summary: string;
  payload_ref: string | null;
}

export interface VersionedMemoryEntry {
  schema_version: 1;
  id: string;
  task_id: string;
  agent: Agent;
  session_id: string;
  timestamp: string;
  type: EntryType;
  layer: EntryLayer;
  kind: EntryKind;
  summary: string;
  payload_ref: string | null;
  confidence: Confidence;
  source_scope: "personal";
}

export class ValidationError extends Error {
  override name = "ValidationError";
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("entry must be an object");
  }
  return value as Record<string, unknown>;
}

function requireExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new ValidationError(`unknown field(s): ${unknown.join(", ")}`);
  }

  const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
  if (missing.length > 0) {
    throw new ValidationError(`missing field(s): ${missing.join(", ")}`);
  }
}

function requireEnum<T extends string>(
  value: unknown,
  field: string,
  choices: readonly T[],
): asserts value is T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${choices.join(", ")}`);
  }
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
}

function requirePayloadRef(value: unknown): asserts value is string | null {
  if (value !== null && typeof value !== "string") {
    throw new ValidationError("payload_ref must be a string or null");
  }
}

function validateContentFields(
  value: Record<string, unknown>,
  allowFact: boolean,
): void {
  requireEnum(value.type, "type", ENTRY_TYPES);
  requireEnum(value.layer, "layer", ENTRY_LAYERS);
  if (!allowFact && value.layer === "fact") {
    throw new ValidationError("layer=fact cannot be written directly by a client");
  }
  requireEnum(value.kind, "kind", ENTRY_KINDS);
  requireString(value.summary, "summary");
  requirePayloadRef(value.payload_ref);
}

/** Strictly validates the five fields a client may submit to record. */
export function validateRecordInput(value: unknown): RecordInput {
  const input = objectRecord(value);
  requireExactFields(input, RECORD_FIELDS);
  validateContentFields(input, false);
  return input as unknown as RecordInput;
}

/** Strictly validates a persisted, provenance-enriched entry. */
export function validateMemoryEntry(value: unknown): VersionedMemoryEntry {
  const entry = objectRecord(value);
  requireExactFields(entry, ENTRY_FIELDS);

  if (entry.schema_version !== 1) {
    throw new ValidationError("schema_version must be 1");
  }
  requireUuid(entry.id, "id");
  requireUuid(entry.task_id, "task_id");
  requireEnum(entry.agent, "agent", AGENTS);
  requireString(entry.session_id, "session_id");
  requireUtcTimestamp(entry.timestamp);
  validateContentFields(entry, true);
  requireEnum(entry.confidence, "confidence", CONFIDENCES);
  if (entry.source_scope !== "personal") {
    throw new ValidationError("source_scope must be personal");
  }

  return entry as unknown as VersionedMemoryEntry;
}

function requireUuid(value: unknown, field: string): asserts value is string {
  requireString(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
}

function requireUtcTimestamp(value: unknown): asserts value is string {
  requireString(value, "timestamp");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError("timestamp must be an ISO8601 UTC timestamp");
  }
}

function isOutside(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === ".." || pathFromParent.startsWith(`..\\`) ||
    pathFromParent.startsWith("../") || isAbsolute(pathFromParent);
}

async function nearestExistingPath(path: string, stopAt: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      if (current === stopAt) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

/**
 * Validates a payload reference against both lexical traversal and filesystem
 * symlink escapes. Missing leaf paths are allowed so callers can validate a
 * reference before creating its artifact.
 */
export async function validatePayloadRef(
  payloadRef: unknown,
  taskDirectory: string,
): Promise<string | null> {
  requirePayloadRef(payloadRef);
  if (payloadRef === null) return null;
  if (payloadRef.length === 0 || payloadRef.includes("\0")) {
    throw new ValidationError("payload_ref must be a non-empty safe relative path");
  }
  if (isAbsolute(payloadRef) || posix.isAbsolute(payloadRef) || win32.isAbsolute(payloadRef)) {
    throw new ValidationError("payload_ref must not be an absolute path");
  }

  const segments = payloadRef.split(/[\\/]+/u);
  if (segments.includes("..")) {
    throw new ValidationError("payload_ref must not contain '..' traversal");
  }

  const lexicalRoot = resolve(taskDirectory);
  const candidate = resolve(lexicalRoot, payloadRef);
  if (isOutside(lexicalRoot, candidate)) {
    throw new ValidationError("payload_ref resolves outside the task directory");
  }

  let realRoot: string;
  try {
    realRoot = await realpath(lexicalRoot);
  } catch {
    throw new ValidationError("task directory does not exist");
  }

  const existing = await nearestExistingPath(candidate, lexicalRoot);
  const realExisting = await realpath(existing);
  if (isOutside(realRoot, realExisting)) {
    throw new ValidationError("payload_ref escapes the task directory through a symbolic link");
  }

  return payloadRef;
}

/** Validates client fields and their payload path as one operation. */
export async function validateRecordInputForTask(
  value: unknown,
  taskDirectory: string,
): Promise<RecordInput> {
  const input = validateRecordInput(value);
  await validatePayloadRef(input.payload_ref, taskDirectory);
  return input;
}

/** Validates a complete entry and its payload path as one operation. */
export async function validateMemoryEntryForTask(
  value: unknown,
  taskDirectory: string,
): Promise<VersionedMemoryEntry> {
  const entry = validateMemoryEntry(value);
  await validatePayloadRef(entry.payload_ref, taskDirectory);
  return entry;
}
