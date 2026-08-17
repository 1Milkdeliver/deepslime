export type MemoryAgent = "claude-code" | "dsh" | "chatgpt" | "cursor";

export type MemoryEntryType =
  | "decision"
  | "artifact"
  | "observation"
  | "question"
  | "fact";

export type MemoryLayer = "fact" | "draft";

export type MemoryKind = "reference" | "state";

export type MemoryConfidence = "high" | "medium" | "low";

export type MemorySourceScope = "personal" | "team" | "company";

export interface MemoryEntry {
  id: string;
  task_id: string;
  agent: MemoryAgent;
  session_id: string;
  timestamp: string;
  type: MemoryEntryType;
  layer: MemoryLayer;
  kind: MemoryKind;
  summary: string;
  payload_ref: string | null;
  confidence: MemoryConfidence;
  source_scope: MemorySourceScope;
}
