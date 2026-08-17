import { resolve } from "node:path";

import {
  buildEntry,
  type AuthenticatedConnection,
} from "../prov/index.js";
import { TaskStore, type OpenTaskResult } from "../task-store.js";
import {
  ValidationError,
  validateRecordInputForTask,
  type RecordInput,
} from "../validate/index.js";

export interface JsonObjectSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
  readonly oneOf?: readonly unknown[];
}

export interface ToolDefinition<Input, Output> {
  readonly name: "open" | "record" | "checkpoint" | "close";
  readonly inputSchema: JsonObjectSchema;
  readonly handler: (
    input: Input,
    connection: AuthenticatedConnection,
  ) => Promise<Output>;
}

export interface OpenToolInput {
  readonly id?: string;
  readonly name?: string;
}

export interface CheckpointToolInput {
  readonly taskId: string;
  readonly state: { readonly content: string };
}

export interface CloseToolInput {
  readonly taskId: string;
}

export interface McpToolDependencies {
  readonly vaultRoot: string;
  readonly store?: TaskStore;
}

export type McpToolDefinitions = readonly [
  ToolDefinition<OpenToolInput, OpenTaskResult>,
  ToolDefinition<RecordInput, { id: string }>,
  ToolDefinition<CheckpointToolInput, void>,
  ToolDefinition<CloseToolInput, void>,
];

const openInputSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
  },
  required: [],
  additionalProperties: false,
  oneOf: [
    { required: ["id"] },
    { required: ["name"] },
  ],
} as const satisfies JsonObjectSchema;

const recordInputSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["decision", "artifact", "observation", "question", "fact"],
    },
    layer: { type: "string", enum: ["draft"] },
    kind: { type: "string", enum: ["reference", "state"] },
    summary: { type: "string" },
    payload_ref: { type: ["string", "null"] },
  },
  required: ["type", "layer", "kind", "summary", "payload_ref"],
  additionalProperties: false,
} as const satisfies JsonObjectSchema;

const checkpointInputSchema = {
  type: "object",
  properties: {
    taskId: { type: "string" },
    state: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
      additionalProperties: false,
    },
  },
  required: ["taskId", "state"],
  additionalProperties: false,
} as const satisfies JsonObjectSchema;

const closeInputSchema = {
  type: "object",
  properties: { taskId: { type: "string" } },
  required: ["taskId"],
  additionalProperties: false,
} as const satisfies JsonObjectSchema;

/** Creates four SDK-independent MCP tool descriptions around a TaskStore. */
export function createMcpTools(dependencies: McpToolDependencies): McpToolDefinitions {
  const store = dependencies.store ?? new TaskStore(dependencies.vaultRoot);
  const tasksRoot = resolve(dependencies.vaultRoot, "slime-mold", "tasks");

  return [
    {
      name: "open",
      inputSchema: openInputSchema,
      async handler(input) {
        const task = validateOpenInput(input);
        return store.open(task);
      },
    },
    {
      name: "record",
      inputSchema: recordInputSchema,
      async handler(input, connection) {
        const content = await validateRecordInputForTask(
          input,
          resolve(tasksRoot, connection.taskId),
        );
        const entry = buildEntry(connection, content);
        await store.record(entry);
        return { id: entry.id };
      },
    },
    {
      name: "checkpoint",
      inputSchema: checkpointInputSchema,
      async handler(input) {
        const checkpoint = validateCheckpointInput(input);
        await store.checkpoint(checkpoint.taskId, checkpoint.state);
      },
    },
    {
      name: "close",
      inputSchema: closeInputSchema,
      async handler(input) {
        const close = validateCloseInput(input);
        await store.close(close.taskId);
      },
    },
  ];
}

function validateOpenInput(value: unknown): { id: string } | { name: string } {
  const input = exactObject(value, ["id", "name"], "open input");
  const hasId = Object.prototype.hasOwnProperty.call(input, "id");
  const hasName = Object.prototype.hasOwnProperty.call(input, "name");
  if (hasId === hasName) {
    throw new ValidationError("open input must contain exactly one of id or name");
  }
  if (hasId) return { id: requireNonEmptyString(input.id, "id") };
  return { name: requireNonEmptyString(input.name, "name") };
}

function validateCheckpointInput(value: unknown): CheckpointToolInput {
  const input = exactObject(value, ["taskId", "state"], "checkpoint input", true);
  const state = exactObject(input.state, ["content"], "checkpoint state", true);
  if (typeof state.content !== "string") {
    throw new ValidationError("content must be a string");
  }
  return {
    taskId: requireNonEmptyString(input.taskId, "taskId"),
    state: { content: state.content },
  };
}

function validateCloseInput(value: unknown): CloseToolInput {
  const input = exactObject(value, ["taskId"], "close input", true);
  return { taskId: requireNonEmptyString(input.taskId, "taskId") };
}

function exactObject(
  value: unknown,
  allowedFields: readonly string[],
  label: string,
  requireAll = false,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`);
  }
  const input = value as Record<string, unknown>;
  const unknownFields = Object.keys(input).filter((key) => !allowedFields.includes(key));
  if (unknownFields.length > 0) {
    throw new ValidationError(`unknown field(s): ${unknownFields.join(", ")}`);
  }
  if (requireAll) {
    const missing = allowedFields.filter(
      (key) => !Object.prototype.hasOwnProperty.call(input, key),
    );
    if (missing.length > 0) {
      throw new ValidationError(`missing field(s): ${missing.join(", ")}`);
    }
  }
  return input;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  return value;
}
