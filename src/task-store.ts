import type { MemoryEntry } from "./task-schema.js";

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
  async open(_task: TaskIdentifier): Promise<OpenTaskResult> {
    throw new Error("TaskStore.open is not implemented");
  }

  async record(_entry: MemoryEntry): Promise<void> {
    throw new Error("TaskStore.record is not implemented");
  }

  async checkpoint(_taskId: string, _state: TaskState): Promise<void> {
    throw new Error("TaskStore.checkpoint is not implemented");
  }

  async close(_taskId: string): Promise<void> {
    throw new Error("TaskStore.close is not implemented");
  }
}
