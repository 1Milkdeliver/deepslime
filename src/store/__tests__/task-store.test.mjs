import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TaskStore } from "../../../.test-dist/task-store.js";
import { withTaskLock } from "../../../.test-dist/store/lock.js";

const connectionFor = (taskId, overrides = {}) => ({
  agent: "claude-code",
  sessionId: "session-1",
  taskId,
  confidence: "high",
  ...overrides,
});

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

function content(overrides = {}) {
  return {
    type: "observation",
    layer: "draft",
    kind: "reference",
    summary: "source can be found in artifacts/source.txt",
    payload_ref: "artifacts/source.txt",
    ...overrides,
  };
}

function persistedEntry(taskId, overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    task_id: taskId,
    agent: "claude-code",
    session_id: "session-1",
    timestamp: "2026-08-17T08:00:00.000Z",
    ...content(),
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

test("record owns identity and provenance and returns the generated id", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const store = new TaskStore(f.vaultRoot);
  const connection = connectionFor(f.taskId);
  const value = content();

  const result = await store.record(connection, value);

  const log = await readFile(join(f.taskDir, "log", "entries.jsonl"), "utf8");
  const lines = log.trim().split("\n");
  assert.equal(lines.length, 1);
  const stored = JSON.parse(lines[0]);
  assert.equal(result.id, stored.id);
  assert.match(result.id, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(stored, {
    schema_version: 1,
    id: result.id,
    task_id: f.taskId,
    agent: connection.agent,
    session_id: connection.sessionId,
    timestamp: stored.timestamp,
    ...value,
    confidence: connection.confidence,
    source_scope: "personal",
  });
});

test("record rejects full entries, direct facts, and unsafe payload references", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const store = new TaskStore(f.vaultRoot);
  const connection = connectionFor(f.taskId);

  await assert.rejects(() => store.record(connection, persistedEntry(f.taskId)), /forbidden/i);
  await assert.rejects(() => store.record(connection, content({ layer: "fact" })), /fact/i);
  await assert.rejects(() => store.record(connection, content({ payload_ref: "../secret" })));
  await assert.rejects(() => store.record(connection, content({ payload_ref: join(f.vaultRoot, "x") })));

  await mkdir(join(f.taskDir, "artifacts"), { recursive: true });
  // A directory symlink/junction must not make an apparently relative reference escape.
  const outside = await mkdtemp(join(tmpdir(), "slime-mold-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const { symlink } = await import("node:fs/promises");
  await symlink(outside, join(f.taskDir, "artifacts", "escape"), "junction");
  await assert.rejects(() =>
    store.record(connection, content({ payload_ref: "artifacts/escape/file.txt" })),
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
  const value = persistedEntry(f.taskId);
  await writeFile(
    join(f.taskDir, "log", "entries.jsonl"),
    JSON.stringify({ schema_version: 1, ...value }) + "\n" + '{"partial":',
  );

  const result = await new TaskStore(f.vaultRoot).open({ id: f.taskId });
  assert.deepEqual(result.recentEntries, [value]);

  await writeFile(join(f.taskDir, "log", "entries.jsonl"), "not-json\n");
  await assert.rejects(() => new TaskStore(f.vaultRoot).open({ id: f.taskId }));
});

test("entry append discards a truncated tail before publishing the new record", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const first = persistedEntry(f.taskId);
  const entriesPath = join(f.taskDir, "log", "entries.jsonl");
  await writeFile(entriesPath, `${JSON.stringify({ schema_version: 1, ...first })}\n{"partial":`);

  assert.deepEqual((await new TaskStore(f.vaultRoot).open({ id: f.taskId })).recentEntries, [first]);
  const recorded = await new TaskStore(f.vaultRoot).record(
    connectionFor(f.taskId, { sessionId: "session-2" }),
    content({ summary: "record after recovery", payload_ref: null }),
  );

  const replayed = await new TaskStore(f.vaultRoot).open({ id: f.taskId });
  assert.deepEqual(replayed.recentEntries.map((entry) => entry.id), [first.id, recorded.id]);
  assert.equal((await readFile(entriesPath, "utf8")).includes('"partial"'), false);
});

test("checkpoint append discards a truncated tail before replay", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const checkpointsPath = join(f.taskDir, "log", "checkpoints.jsonl");
  await writeFile(
    checkpointsPath,
    `${JSON.stringify({ schema_version: 1, type: "checkpoint", content: "confirmed" })}\n{"partial":`,
  );

  assert.equal((await new TaskStore(f.vaultRoot).open({ id: f.taskId })).state.content, "confirmed");
  await new TaskStore(f.vaultRoot).checkpoint(f.taskId, { content: "after recovery" });

  assert.equal(
    (await new TaskStore(f.vaultRoot).open({ id: f.taskId })).state.content,
    "after recovery",
  );
  assert.equal((await readFile(checkpointsPath, "utf8")).includes('"partial"'), false);
});

test("physical task aliases share one process-wide writer lock", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const alias = `${f.taskDir}-alias`;
  const { symlink } = await import("node:fs/promises");
  await symlink(f.taskDir, alias, "junction");

  let active = 0;
  let maximumActive = 0;
  const operation = (key) => withTaskLock(key, async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
  });

  await Promise.all([operation(f.taskDir), operation(alias)]);
  assert.equal(maximumActive, 1);
});

test("TaskStore writers through vault aliases do not lose records", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const aliasRoot = `${f.vaultRoot}-alias`;
  t.after(() => rm(aliasRoot, { recursive: true, force: true }));
  const { symlink } = await import("node:fs/promises");
  await symlink(f.vaultRoot, aliasRoot, "junction");
  const stores = [new TaskStore(f.vaultRoot), new TaskStore(aliasRoot)];

  const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    stores[index % stores.length].record(
      connectionFor(f.taskId, { sessionId: `alias-session-${index}` }),
      content({ summary: `alias record ${index}`, payload_ref: null }),
    )));

  const reopened = await new TaskStore(f.vaultRoot).open({ id: f.taskId });
  assert.equal(reopened.recentEntries.length, results.length);
  assert.deepEqual(
    new Set(reopened.recentEntries.map((entry) => entry.id)),
    new Set(results.map((result) => result.id)),
  );
});

test("replay rejects malformed fields, unknown fields, and task mismatches", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const entriesPath = join(f.taskDir, "log", "entries.jsonl");
  const valid = { schema_version: 1, ...persistedEntry(f.taskId) };
  const { summary: _summary, ...missingField } = valid;
  const invalidRecords = [
    { ...valid, extra: true },
    missingField,
    { ...valid, confidence: "certain" },
    { ...valid, task_id: "33333333-3333-4333-8333-333333333333" },
  ];

  for (const invalid of invalidRecords) {
    await writeFile(entriesPath, `${JSON.stringify(invalid)}\n`);
    await assert.rejects(() => new TaskStore(f.vaultRoot).open({ id: f.taskId }));
  }
});

test("close atomically changes only lifecycle status and preserves task data", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const store = new TaskStore(f.vaultRoot);
  await store.record(connectionFor(f.taskId), content({ payload_ref: null }));
  await store.close(f.taskId);

  const metadata = JSON.parse(await readFile(join(f.taskDir, "task.json"), "utf8"));
  assert.deepEqual(metadata, { id: f.taskId, name: "Example task", status: "dormant" });
  assert.equal((await store.open({ id: f.taskId })).recentEntries.length, 1);
});
