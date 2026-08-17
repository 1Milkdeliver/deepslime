import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TaskStore } from "../../../.test-dist/task-store.js";

async function fixture(name = "Example task") {
  const vaultRoot = await mkdtemp(join(tmpdir(), "slime-mold-store-"));
  const taskId = "11111111-1111-4111-8111-111111111111";
  const taskDir = join(vaultRoot, "slime-mold", "tasks", taskId);
  await mkdir(join(taskDir, "log"), { recursive: true });
  await writeFile(
    join(taskDir, "task.json"),
    JSON.stringify({ id: taskId, name, status: "active" }, null, 2) + "\n",
  );
  await writeFile(join(taskDir, "state.md"), "initial state");
  return { vaultRoot, taskId, taskDir };
}

function entry(taskId, overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    task_id: taskId,
    agent: "claude-code",
    session_id: "session-1",
    timestamp: "2026-08-17T08:00:00.000Z",
    type: "observation",
    layer: "draft",
    kind: "reference",
    summary: "source can be found in artifacts/source.txt",
    payload_ref: "artifacts/source.txt",
    confidence: "high",
    source_scope: "personal",
    ...overrides,
  };
}

test("open resolves an explicit id or exact task name", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const store = new TaskStore(f.vaultRoot);

  assert.deepEqual(await store.open({ id: f.taskId }), {
    taskId: f.taskId,
    state: { content: "initial state" },
    recentEntries: [],
  });
  assert.equal((await store.open({ name: "Example task" })).taskId, f.taskId);
});

test("record persists schema-versioned JSONL and is idempotent by id", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const store = new TaskStore(f.vaultRoot);
  const value = entry(f.taskId);

  await Promise.all([store.record(value), store.record(value), store.record(value)]);

  const log = await readFile(join(f.taskDir, "log", "entries.jsonl"), "utf8");
  const lines = log.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { schema_version: 1, ...value });
  assert.deepEqual((await store.open({ id: f.taskId })).recentEntries, [value]);
});

test("record rejects task mismatch and unsafe payload references", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const store = new TaskStore(f.vaultRoot);

  await assert.rejects(() => store.record(entry(f.taskId, { payload_ref: "../secret" })));
  await assert.rejects(() => store.record(entry(f.taskId, { payload_ref: join(f.vaultRoot, "x") })));

  await mkdir(join(f.taskDir, "artifacts"), { recursive: true });
  // A directory symlink/junction must not make an apparently relative reference escape.
  const outside = await mkdtemp(join(tmpdir(), "slime-mold-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const { symlink } = await import("node:fs/promises");
  await symlink(outside, join(f.taskDir, "artifacts", "escape"), "junction");
  await assert.rejects(() =>
    store.record(entry(f.taskId, { payload_ref: "artifacts/escape/file.txt" })),
  );
});

test("checkpoint journal recovers a missing or stale state.md on a new store", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const store = new TaskStore(f.vaultRoot);
  await store.checkpoint(f.taskId, { content: "durable checkpoint" });

  await writeFile(join(f.taskDir, "state.md"), "stale after crash");
  const reopened = new TaskStore(f.vaultRoot);
  assert.equal((await reopened.open({ id: f.taskId })).state.content, "durable checkpoint");
  assert.equal(await readFile(join(f.taskDir, "state.md"), "utf8"), "durable checkpoint");
});

test("open tolerates a truncated uncommitted tail but rejects committed corruption", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const value = entry(f.taskId);
  await writeFile(
    join(f.taskDir, "log", "entries.jsonl"),
    JSON.stringify({ schema_version: 1, ...value }) + "\n" + '{"partial":',
  );

  const result = await new TaskStore(f.vaultRoot).open({ id: f.taskId });
  assert.deepEqual(result.recentEntries, [value]);

  await writeFile(join(f.taskDir, "log", "entries.jsonl"), "not-json\n");
  await assert.rejects(() => new TaskStore(f.vaultRoot).open({ id: f.taskId }));
});

test("close atomically changes only lifecycle status and preserves task data", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const store = new TaskStore(f.vaultRoot);
  await store.record(entry(f.taskId));
  await store.close(f.taskId);

  const metadata = JSON.parse(await readFile(join(f.taskDir, "task.json"), "utf8"));
  assert.deepEqual(metadata, { id: f.taskId, name: "Example task", status: "dormant" });
  assert.equal((await store.open({ id: f.taskId })).recentEntries.length, 1);
});
