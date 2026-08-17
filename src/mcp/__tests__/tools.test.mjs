import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMcpTools } from "../../../.test-dist/mcp/index.js";
import { TaskStore } from "../../../.test-dist/task-store.js";

const taskId = "11111111-1111-4111-8111-111111111111";
const connection = Object.freeze({
  agent: "dsh",
  sessionId: "authenticated-session",
  taskId,
  confidence: "high",
});

async function fixture() {
  const vaultRoot = await mkdtemp(join(tmpdir(), "slime-mold-mcp-"));
  const taskDir = join(vaultRoot, "slime-mold", "tasks", taskId);
  await mkdir(join(taskDir, "log"), { recursive: true });
  await writeFile(
    join(taskDir, "task.json"),
    `${JSON.stringify({ id: taskId, name: "MCP task", status: "active" }, null, 2)}\n`,
  );
  await writeFile(join(taskDir, "state.md"), "initial state");
  return { vaultRoot, taskDir };
}

function byName(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing tool definition: ${name}`);
  return tool;
}

test("exports exactly four SDK-independent strict tool definitions", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const tools = createMcpTools({ vaultRoot: f.vaultRoot, store: new TaskStore(f.vaultRoot) });

  assert.deepEqual(tools.map((tool) => tool.name), ["open", "record", "checkpoint", "close"]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.handler, "function");
  }
});

test("open, checkpoint, and close expose TaskStore behavior", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const tools = createMcpTools({ vaultRoot: f.vaultRoot, store: new TaskStore(f.vaultRoot) });

  assert.deepEqual(await byName(tools, "open").handler({ id: taskId }, connection), {
    taskId,
    state: { content: "initial state" },
    recentEntries: [],
  });
  assert.equal(
    (await byName(tools, "open").handler({ name: "MCP task" }, connection)).taskId,
    taskId,
  );

  assert.equal(
    await byName(tools, "checkpoint").handler(
      { taskId, state: { content: "checkpointed" } },
      connection,
    ),
    undefined,
  );
  assert.equal(await readFile(join(f.taskDir, "state.md"), "utf8"), "checkpointed");

  assert.equal(await byName(tools, "close").handler({ taskId }, connection), undefined);
  const metadata = JSON.parse(await readFile(join(f.taskDir, "task.json"), "utf8"));
  assert.equal(metadata.status, "dormant");
});

test("record validates with W2, injects W4 provenance, persists, and returns id", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const tools = createMcpTools({ vaultRoot: f.vaultRoot, store: new TaskStore(f.vaultRoot) });
  const input = {
    type: "observation",
    layer: "draft",
    kind: "reference",
    summary: "MCP stores authenticated provenance.",
    payload_ref: null,
  };

  const result = await byName(tools, "record").handler(input, connection);
  assert.match(result.id, /^[0-9a-f-]{36}$/i);

  const opened = await new TaskStore(f.vaultRoot).open({ id: taskId });
  assert.equal(opened.recentEntries.length, 1);
  assert.deepEqual(opened.recentEntries[0], {
    id: result.id,
    task_id: taskId,
    agent: connection.agent,
    session_id: connection.sessionId,
    timestamp: opened.recentEntries[0].timestamp,
    type: input.type,
    layer: "draft",
    kind: input.kind,
    summary: input.summary,
    payload_ref: null,
    confidence: connection.confidence,
    source_scope: "personal",
  });
});

test("strict validation rejects unknown fields and unsafe payloads before storage", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const tools = createMcpTools({ vaultRoot: f.vaultRoot, store: new TaskStore(f.vaultRoot) });
  const record = byName(tools, "record");

  await assert.rejects(() => record.handler({
    type: "observation",
    layer: "draft",
    kind: "reference",
    summary: "escape",
    payload_ref: "../secret.txt",
  }, connection));
  await assert.rejects(() => record.handler({
    type: "observation",
    layer: "draft",
    kind: "reference",
    summary: "forged provenance",
    payload_ref: null,
    agent: "cursor",
  }, connection));
  await assert.rejects(() => byName(tools, "open").handler({ id: taskId, extra: true }, connection));
  await assert.rejects(() => byName(tools, "checkpoint").handler({
    taskId,
    state: { content: "x", extra: true },
  }, connection));

  await assert.rejects(readFile(join(f.taskDir, "log", "entries.jsonl"), "utf8"));
});

test("record delegates trusted connection and content to the store boundary", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.vaultRoot, { recursive: true, force: true }));
  const calls = [];
  const store = {
    async record(receivedConnection, receivedContent) {
      calls.push([receivedConnection, receivedContent]);
      return { id: "server-generated-id" };
    },
  };
  const tools = createMcpTools({ vaultRoot: f.vaultRoot, store });
  const input = {
    type: "observation",
    layer: "draft",
    kind: "reference",
    summary: "validated content",
    payload_ref: null,
  };

  assert.deepEqual(await byName(tools, "record").handler(input, connection), {
    id: "server-generated-id",
  });
  assert.deepEqual(calls, [[connection, input]]);
});
