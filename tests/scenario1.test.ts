import assert from "node:assert/strict";
import test from "node:test";

import type { MemoryEntry } from "../src/task-schema.js";
import { TaskStore } from "../src/task-store.js";
import type { AuthenticatedConnection } from "../src/prov/index.js";
import {
  makeWeeklyReportMemories,
  type RecordMemoryEntry,
} from "./fixtures/weekly-report-memory.js";

const testConnection: AuthenticatedConnection = {
  agent: "dsh",
  sessionId: "scenario1-session-a",
  taskId: "", // filled per task after open
  confidence: "high",
};

function assertServerProvenance(entry: MemoryEntry): void {
  assert.ok(entry.id, "recorded entry must have a server-generated id");
  assert.ok(entry.agent, "recorded entry must have a server-injected agent");
  assert.ok(
    entry.session_id,
    "recorded entry must have a server-injected session id",
  );
  assert.ok(
    !Number.isNaN(Date.parse(entry.timestamp)),
    "recorded entry timestamp must be ISO-8601 compatible",
  );
  assert.ok(
    ["high", "medium", "low"].includes(entry.confidence),
    "recorded entry must have server-generated confidence",
  );
}

test("场景一：新会话按 task id 恢复周报状态和最近记忆", async () => {
  // A unique explicit name prevents accidental recall of a pre-existing task.
  const taskName = `scenario1-weekly-report-${Date.now()}`;
  const checkpointContent = [
    "# 周报续接状态",
    "",
    "已完成：本周进展与风险汇总。",
    "下一步：确认发布窗口后提交周报。",
  ].join("\n");

  // Session A: create/open by name, record memories, checkpoint, then close.
  const sessionA = new TaskStore();
  const created = await sessionA.open({ name: taskName });
  assert.ok(created.taskId, "opening a new task by name must return its id");
  testConnection.taskId = created.taskId;

  const fixtureEntries = makeWeeklyReportMemories(created.taskId);
  const recordedIds: string[] = [];
  for (const entry of fixtureEntries) {
    const result = await sessionA.record(testConnection, entry);
    assert.ok(result.id, "record must return the stored entry id");
    recordedIds.push(result.id);
  }

  await sessionA.checkpoint(created.taskId, { content: checkpointContent });
  await sessionA.close(created.taskId);

  // Session B: a fresh store instance may only use the explicit task id.
  const sessionB = new TaskStore();
  const restored = await sessionB.open({ id: created.taskId });

  assert.equal(restored.taskId, created.taskId);
  assert.deepEqual(restored.state, { content: checkpointContent });

  const restoredById = new Map(
    restored.recentEntries.map((entry) => [entry.id, entry]),
  );
  assert.equal(
    restoredById.size,
    fixtureEntries.length,
    "all recently recorded weekly-report entries must be restored",
  );

  fixtureEntries.forEach((expected, index) => {
    const actual = restoredById.get(recordedIds[index]);
    assert.ok(actual, `recorded entry ${recordedIds[index]} must be restored`);
    assert.equal(actual.task_id, created.taskId);
    assert.equal(actual.type, expected.type);
    assert.equal(actual.layer, expected.layer);
    assert.equal(actual.kind, expected.kind);
    assert.equal(actual.summary, expected.summary);
    assert.equal(actual.payload_ref, expected.payload_ref);
    assert.equal(actual.source_scope, "personal");
    assertServerProvenance(actual);
  });
});
