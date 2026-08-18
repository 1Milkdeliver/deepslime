import assert from "node:assert/strict";
import test from "node:test";

import { SessionAggregator } from "../../../.test-dist/ingest/aggregate.js";

function session(overrides = {}) {
  return {
    sessionId: "s1",
    source: "codex",
    agent: "claude-code",
    title: "Weekly report",
    startedAt: "2026-08-17T08:00:00.000Z",
    endedAt: "2026-08-17T09:00:00.000Z",
    events: [],
    ...overrides,
  };
}

function user(text, seq = 0, timestamp = "2026-08-17T08:00:00.000Z") {
  return { seq, timestamp, type: "user_message", text };
}

test("相同标题的会话聚合为同一任务候选", () => {
  const aggregator = new SessionAggregator();
  const candidates = aggregator.aggregate([
    session({ sessionId: "a", title: "Weekly report" }),
    session({ sessionId: "b", title: "Weekly report" }),
    session({ sessionId: "c", title: "Resume 2024" }),
  ]);

  assert.equal(candidates.length, 2);
  const weekly = candidates.find((candidate) => candidate.taskName === "Weekly report");
  assert.ok(weekly);
  assert.deepEqual(
    weekly.sessions.map((session) => session.sessionId),
    ["a", "b"],
  );
  const resume = candidates.find((candidate) => candidate.taskName === "Resume 2024");
  assert.ok(resume);
  assert.equal(resume.sessions.length, 1);
});

test("标题归一化:空白折叠 + 大小写不敏感聚合,展示名保留首个会话原始标题", () => {
  const aggregator = new SessionAggregator();
  const candidates = aggregator.aggregate([
    session({ sessionId: "a", title: "  Weekly   Report " }),
    session({ sessionId: "b", title: "weekly report" }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].taskName, "Weekly Report");
  assert.equal(candidates[0].sessions.length, 2);
  assert.deepEqual(
    candidates[0].sessions.map((session) => session.sessionId),
    ["a", "b"],
  );
});

test("无标题会话用首个用户消息作为任务名种子", () => {
  const aggregator = new SessionAggregator();
  const candidates = aggregator.aggregate([
    session({
      sessionId: "a",
      title: "",
      events: [user("帮我写周报模板", 0)],
    }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].taskName, "帮我写周报模板");
});

test("decision/artifact 事件成为溯源高光", () => {
  const aggregator = new SessionAggregator();
  const candidates = aggregator.aggregate([
    session({
      sessionId: "a",
      title: "Project X",
      events: [
        user("开始", 0, "2026-08-17T08:00:00.000Z"),
        {
          seq: 1,
          timestamp: "2026-08-17T08:01:00.000Z",
          type: "decision",
          text: "确定采用 SQLite 存储",
        },
        {
          seq: 2,
          timestamp: "2026-08-17T08:02:00.000Z",
          type: "artifact",
          text: "生成设计文档",
        },
      ],
    }),
  ]);

  const highlights = candidates[0].highlights;
  assert.equal(highlights.length, 3); // question(user) + decision + artifact
  assert.equal(highlights[0].entryType, "question");
  assert.equal(highlights[1].entryType, "decision");
  assert.equal(highlights[1].confidence, "high");
  assert.equal(highlights[2].entryType, "artifact");
  assert.equal(highlights[2].confidence, "high");
  assert.match(highlights[1].summary, /^\[codex\/claude-code\]/);
});

test("候选按任务信号总分降序排序", () => {
  const aggregator = new SessionAggregator();
  const candidates = aggregator.aggregate([
    session({
      sessionId: "big",
      title: "Big task",
      events: [
        user("一", 0),
        { seq: 1, timestamp: "", type: "decision", text: "决策一" },
        { seq: 2, timestamp: "", type: "decision", text: "决策二" },
        { seq: 3, timestamp: "", type: "artifact", text: "产物一" },
      ],
    }),
    session({ sessionId: "small", title: "Small task", events: [user("问一句", 0)] }),
  ]);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].taskName, "Big task");
  assert.equal(candidates[1].taskName, "Small task");
});

test("Edge 会话(无 agent)可聚合,observation 成为高光且不报错", () => {
  const aggregator = new SessionAggregator();
  const candidates = aggregator.aggregate([
    session({
      sessionId: "edge-1",
      source: "edge",
      title: "GitHub 浏览",
      events: [
        {
          seq: 0,
          timestamp: "2026-08-17T08:00:00.000Z",
          type: "observation",
          text: "github.com/1Milkdeliver/slime-mold",
        },
      ],
    }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].taskName, "GitHub 浏览");
  assert.equal(candidates[0].highlights.length, 1); // observation 是高光
  assert.equal(candidates[0].highlights[0].entryType, "observation");
});
