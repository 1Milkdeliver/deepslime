import assert from "node:assert/strict";
import test from "node:test";

import { ProvenanceError, buildEntry } from "../index.ts";

const connection = Object.freeze({
  agent: "dsh",
  sessionId: "session-from-authenticated-connection",
  taskId: "4c4a69d4-bbe5-47db-914d-5f4f87be1594",
  confidence: "high",
});

const draftContent = Object.freeze({
  type: "observation",
  layer: "draft",
  kind: "reference",
  summary: "The service owns provenance metadata.",
  payload_ref: null,
});

test("rejects client-supplied provenance fields", () => {
  assert.throws(
    () =>
      buildEntry(connection, {
        ...draftContent,
        agent: "cursor",
        session_id: "forged-session",
        timestamp: "2000-01-01T00:00:00.000Z",
        confidence: "low",
        id: "forged-id",
      }),
    (error) =>
      error instanceof ProvenanceError &&
      error.code === "CLIENT_PROVENANCE_FORBIDDEN",
  );
});

test("generates timestamp and complete provenance on the server", () => {
  const before = Date.now();
  const entry = buildEntry(connection, draftContent);
  const after = Date.now();

  assert.equal(entry.agent, connection.agent);
  assert.equal(entry.session_id, connection.sessionId);
  assert.equal(entry.task_id, connection.taskId);
  assert.equal(entry.confidence, connection.confidence);
  assert.equal(entry.source_scope, "personal");
  assert.match(
    entry.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.ok(Date.parse(entry.timestamp) >= before);
  assert.ok(Date.parse(entry.timestamp) <= after);
  assert.notEqual(entry.timestamp, draftContent.timestamp);
});

test("rejects direct client writes to the fact layer", () => {
  assert.throws(
    () => buildEntry(connection, { ...draftContent, layer: "fact" }),
    (error) =>
      error instanceof ProvenanceError && error.code === "FACT_LAYER_FORBIDDEN",
  );
});
