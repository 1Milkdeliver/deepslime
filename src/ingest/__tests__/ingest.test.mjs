import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TaskStore } from "../../../.test-dist/task-store.js";
import { runIngest } from "../../../.test-dist/ingest/index.js";

/**
 * DSH 会话文件通常是 zstd 压缩的 JSONL。本测试写未压缩 JSONL 内容
 * (解析器对无 zstd magic 的文件走"原字节直读"回退路径),从而在
 * 不依赖压缩工具的前提下验证整条管线;真实 zstd 解码由 fzstd 保证,
 * 解码正确性用真实数据单独验证(scripts/ingest.mjs 端到端)。
 */
function dshJson(value) {
  return Buffer.from(value.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
}

async function makeCodexSession(dir, fileName, records) {
  await mkdir(dir, { recursive: true });
  const lines = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(join(dir, fileName), lines + "\n", "utf8");
}

test("摄入管线:Codex + DSH + 缺省源 → 聚合 → 写入 TaskStore → sm-config", async (t) => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "slime-mold-ingest-"));
  const codexDir = join(vaultRoot, "sources", "codex");
  const dshDir = join(vaultRoot, "sources", "dsh");
  t.after(() => rm(vaultRoot, { recursive: true, force: true }));

  // Codex 会话(JSONL,含 Codex Desktop 真实格式:event_msg + response_item)
  await makeCodexSession(codexDir, "2026-08-17.jsonl", [
    { type: "session_meta", timestamp: "2026-08-17T08:00:00.000Z", payload: { session_id: "s1" } },
    {
      type: "event_msg",
      timestamp: "2026-08-17T08:00:01.000Z",
      payload: { type: "user_message", message: "整理项目周报" },
    },
    {
      type: "event_msg",
      timestamp: "2026-08-17T08:00:02.000Z",
      payload: { type: "agent_message", message: "我来整理周报结构" },
    },
    {
      type: "response_item",
      timestamp: "2026-08-17T08:00:05.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "我来整理周报结构" }],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-08-17T08:00:10.000Z",
      payload: { type: "function_call", name: "write_file", arguments: { path: "report.md" } },
    },
    // developer 系统消息不应成为记忆事件或任务名种子
    {
      type: "response_item",
      timestamp: "2026-08-17T08:00:11.000Z",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "<system context>" }],
      },
    },
  ]);

  // DSH 会话(未压缩 JSONL 内容,真实 DSH 事件流格式,解析器回退路径)
  await mkdir(join(dshDir, "session-abc123"), { recursive: true });
  await writeFile(
    join(dshDir, "session-abc123", "session.jsonl.zstd"),
    dshJson([
      { type: "session", id: "session-abc123", createdAt: 1786691721491, cwd: "D:\\Deepseek Harness" },
      { type: "session/title", data: { title: "继续 slime-mold 摄入管线" } },
      {
        type: "user/message",
        seq: 7,
        time: 1786691778637,
        data: { content: [{ type: "text", text: "继续 slime-mold 摄入管线" }], role: "user" },
      },
      {
        type: "assistant/message",
        seq: 8,
        time: 1786691778645,
        data: { message: { role: "assistant", content: [{ type: "text", text: "好的,继续" }] } },
      },
      {
        type: "tool/call",
        seq: 9,
        time: 1786691778700,
        data: { name: "read_file", arguments: "{\"path\":\"SPEC.md\"}" },
      },
      {
        type: "tool/result",
        seq: 10,
        time: 1786691778800,
        data: {
          message: {
            content: [
              {
                type: "tool-result",
                content: [{ type: "text", text: "# SPEC" }],
              },
            ],
          },
        },
      },
    ]),
  );

  const result = await runIngest({
    vaultRoot,
    sources: [
      { source: "codex", path: codexDir },
      { source: "dsh", path: dshDir },
      // edge 缺省:应计入 missing
    ],
    agent: "dsh",
    sessionId: "ingest-test-1",
    idempotencyKey: "ingest-test-key-1",
  });

  // 解析统计
  assert.equal(result.sources.length, 2);
  assert.ok(result.sources.every((source) => source.parsed !== null));
  assert.ok(result.taskCandidates >= 2, "应聚合出至少 2 个任务候选");
  assert.ok(result.entriesWritten >= 2, "应写入至少 2 条记忆");

  // 写入 TaskStore 后可 open 读取(每个任务自己的条目数)
  const store = new TaskStore(vaultRoot);
  const opened = await store.open({ name: "整理项目周报" });
  assert.ok(opened.recentEntries.length >= 1);
  const first = opened.recentEntries[0];
  assert.equal(first.agent, "dsh");
  assert.equal(first.session_id, "ingest-test-1");
  assert.equal(first.layer, "draft");
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  // 全部任务条目总数 = entriesWritten
  const dshOpened = await store.open({ name: "继续 slime-mold 摄入管线" });
  const totalEntries =
    opened.recentEntries.length + dshOpened.recentEntries.length;
  assert.equal(totalEntries, result.entriesWritten);

  // sm-config.json 覆盖诚实区
  const config = JSON.parse(
    await readFile(join(vaultRoot, "slime-mold", "sm-config.json"), "utf8"),
  );
  assert.equal(config.version, 1);
  assert.deepEqual(
    config.ingested.map((item) => item.source).sort(),
    ["codex", "dsh"],
  );
  assert.ok(config.missing.some((item) => item.includes("Edge")));

  // 幂等:同 key 重跑不产生重复条目
  const rerun = await runIngest({
    vaultRoot,
    sources: [
      { source: "codex", path: codexDir },
      { source: "dsh", path: dshDir },
    ],
    agent: "dsh",
    sessionId: "ingest-test-1",
    idempotencyKey: "ingest-test-key-1",
  });
  assert.equal(rerun.entriesWritten, 0);
  assert.ok(rerun.entriesSkipped >= result.entriesWritten);
  const reopened = await store.open({ name: "整理项目周报" });
  assert.equal(reopened.recentEntries.length, opened.recentEntries.length);
});

test("摄入管线:单个源解析失败不中断(optional)", async (t) => {
  const vaultRoot = await mkdtemp(join(tmpdir(), "slime-mold-ingest-fail-"));
  t.after(() => rm(vaultRoot, { recursive: true, force: true }));

  const codexDir = join(vaultRoot, "codex");
  await makeCodexSession(codexDir, "session-a.jsonl", [
    { type: "user_message", timestamp: "2026-08-17T08:00:00.000Z", content: "做设计" },
  ]);

  const result = await runIngest({
    vaultRoot,
    sources: [
      { source: "codex", path: codexDir },
      // 不存在的 DSH 目录:解析器返回空会话而非抛错
      { source: "dsh", path: join(vaultRoot, "no-such-dsh-dir") },
    ],
    agent: "dsh",
    sessionId: "ingest-test-2",
    idempotencyKey: "ingest-test-key-2",
  });

  assert.ok(result.taskCandidates >= 1);
  assert.equal(result.entriesWritten, 1);
  const store = new TaskStore(vaultRoot);
  const opened = await store.open({ name: "做设计" });
  assert.equal(opened.recentEntries.length, 1);
});
