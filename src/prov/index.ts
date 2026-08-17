import type {
  MemoryAgent,
  MemoryConfidence,
  MemoryEntry,
  MemoryEntryType,
  MemoryKind,
} from "../task-schema.js";

/** Values established by the server after authenticating a client connection. */
export interface AuthenticatedConnection {
  readonly agent: MemoryAgent;
  readonly sessionId: string;
  readonly taskId: string;
  readonly confidence: MemoryConfidence;
}

/** The only fields accepted from a record client in P0. */
export interface ClientContent {
  readonly type: MemoryEntryType;
  readonly layer: "draft";
  readonly kind: MemoryKind;
  readonly summary: string;
  readonly payload_ref: string | null;
}

export type ProvenanceErrorCode =
  | "CLIENT_PROVENANCE_FORBIDDEN"
  | "CLIENT_FIELD_FORBIDDEN"
  | "INVALID_CLIENT_CONTENT"
  | "FACT_LAYER_FORBIDDEN";

export class ProvenanceError extends Error {
  readonly code: ProvenanceErrorCode;

  constructor(code: ProvenanceErrorCode, message: string) {
    super(message);
    this.name = "ProvenanceError";
    this.code = code;
  }
}

const contentFields = new Set([
  "type",
  "layer",
  "kind",
  "summary",
  "payload_ref",
]);

const provenanceFields = new Set([
  "id",
  "agent",
  "session_id",
  "timestamp",
  "confidence",
  "source_scope",
  "task_id",
]);

const entryTypes = new Set<MemoryEntryType>([
  "decision",
  "artifact",
  "observation",
  "question",
  "fact",
]);

const entryKinds = new Set<MemoryKind>(["reference", "state"]);

function requireClientContent(value: unknown): asserts value is ClientContent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProvenanceError(
      "INVALID_CLIENT_CONTENT",
      "Client content must be an object.",
    );
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new ProvenanceError(
        "CLIENT_FIELD_FORBIDDEN",
        "Symbol fields are not accepted in client content.",
      );
    }
    if (provenanceFields.has(key)) {
      throw new ProvenanceError(
        "CLIENT_PROVENANCE_FORBIDDEN",
        `Client-supplied provenance field is forbidden: ${key}`,
      );
    }
    if (!contentFields.has(key)) {
      throw new ProvenanceError(
        "CLIENT_FIELD_FORBIDDEN",
        `Unknown client content field: ${key}`,
      );
    }
  }

  const content = value as Record<string, unknown>;

  if (content.layer === "fact") {
    throw new ProvenanceError(
      "FACT_LAYER_FORBIDDEN",
      "Direct writes to layer=fact require a confirmed promotion.",
    );
  }

  if (
    !entryTypes.has(content.type as MemoryEntryType) ||
    content.layer !== "draft" ||
    !entryKinds.has(content.kind as MemoryKind) ||
    typeof content.summary !== "string" ||
    !(typeof content.payload_ref === "string" || content.payload_ref === null)
  ) {
    throw new ProvenanceError(
      "INVALID_CLIENT_CONTENT",
      "Client content does not match the record content schema.",
    );
  }
}

/**
 * Creates a complete entry while keeping all provenance under server control.
 * The connection is expected to have been authenticated by the caller.
 */
export function buildEntry(
  connection: AuthenticatedConnection,
  clientContent: ClientContent,
): MemoryEntry;
export function buildEntry(
  connection: AuthenticatedConnection,
  clientContent: unknown,
): MemoryEntry {
  requireClientContent(clientContent);

  return {
    id: crypto.randomUUID(),
    task_id: connection.taskId,
    agent: connection.agent,
    session_id: connection.sessionId,
    timestamp: new Date().toISOString(),
    type: clientContent.type,
    layer: "draft",
    kind: clientContent.kind,
    summary: clientContent.summary,
    payload_ref: clientContent.payload_ref,
    confidence: connection.confidence,
    source_scope: "personal",
  };
}
