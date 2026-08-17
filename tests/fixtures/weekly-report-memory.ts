import type { MemoryEntry } from "../../src/task-schema.js";

/** The fields accepted by CONTRACT.md's `record` operation. */
export type RecordMemoryEntry = Omit<
  MemoryEntry,
  "id" | "agent" | "session_id" | "timestamp" | "confidence"
>;

export interface WeeklyReportFixtureOptions {
  weekLabel?: string;
}

/**
 * Build deterministic, contract-valid draft memories for one weekly report.
 * Provenance fields are deliberately absent: TaskStore must inject them.
 */
export function makeWeeklyReportMemories(
  taskId: string,
  options: WeeklyReportFixtureOptions = {},
): RecordMemoryEntry[] {
  const weekLabel = options.weekLabel ?? "2026-W33";

  return [
    {
      task_id: taskId,
      type: "observation",
      layer: "draft",
      kind: "state",
      summary: `${weekLabel}：完成周报数据汇总，核心指标已核对。`,
      payload_ref: null,
      source_scope: "personal",
    },
    {
      task_id: taskId,
      type: "decision",
      layer: "draft",
      kind: "state",
      summary: `${weekLabel}：周报采用“进展、风险、下周计划”三段结构。`,
      payload_ref: null,
      source_scope: "personal",
    },
    {
      task_id: taskId,
      type: "question",
      layer: "draft",
      kind: "reference",
      summary: `${weekLabel}：待确认下周发布窗口是否调整。`,
      payload_ref: null,
      source_scope: "personal",
    },
  ];
}
