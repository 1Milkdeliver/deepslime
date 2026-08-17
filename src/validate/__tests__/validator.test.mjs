import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ValidationError,
  validateMemoryEntry,
  validateMemoryEntryForTask,
  validatePayloadRef,
  validateRecordInput,
  validateRecordInputForTask,
} from "../index.ts";

const validInput = {
  type: "artifact",
  layer: "draft",
  kind: "reference",
  summary: "Created the report",
  payload_ref: "artifacts/report.md",
};

const validEntry = {
  schema_version: 1,
  id: "123e4567-e89b-42d3-a456-426614174000",
  task_id: "123e4567-e89b-42d3-a456-426614174001",
  agent: "claude-code",
  session_id: "session-1",
  timestamp: "2026-08-17T08:00:00.000Z",
  ...validInput,
  confidence: "high",
  source_scope: "personal",
};

test("record input accepts exactly the five client content fields", () => {
  assert.deepEqual(validateRecordInput(validInput), validInput);
  assert.throws(
    () => validateRecordInput({ ...validInput, agent: "spoofed" }),
    (error) => error instanceof ValidationError && /unknown field.*agent/i.test(error.message),
  );
});

test("record input checks field types, enums, and prevents direct fact writes", () => {
  assert.throws(() => validateRecordInput({ ...validInput, type: "note" }), /type/);
  assert.throws(() => validateRecordInput({ ...validInput, summary: 7 }), /summary/);
  assert.throws(() => validateRecordInput({ ...validInput, layer: "fact" }), /fact/);
});

test("complete entries require schema_version 1 and reject unknown fields", () => {
  assert.deepEqual(validateMemoryEntry(validEntry), validEntry);
  assert.throws(() => validateMemoryEntry({ ...validEntry, schema_version: 2 }), /schema_version/);
  const { schema_version: _, ...unversioned } = validEntry;
  assert.throws(() => validateMemoryEntry(unversioned), /schema_version/);
  assert.throws(() => validateMemoryEntry({ ...validEntry, extra: true }), /unknown field.*extra/i);
});

test("complete entries validate identity, provenance, and contract constants", () => {
  assert.throws(() => validateMemoryEntry({ ...validEntry, id: "not-a-uuid" }), /id.*UUID/);
  assert.throws(() => validateMemoryEntry({ ...validEntry, timestamp: "2026-08-17" }), /timestamp/);
  assert.throws(() => validateMemoryEntry({ ...validEntry, confidence: "certain" }), /confidence/);
  assert.throws(() => validateMemoryEntry({ ...validEntry, source_scope: "team" }), /source_scope/);
});

test("payload_ref allows null and task-relative paths, including missing targets", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "slime-validate-task-"));
  await mkdir(join(taskDir, "artifacts"));
  await writeFile(join(taskDir, "artifacts", "present.md"), "ok");

  assert.equal(await validatePayloadRef(null, taskDir), null);
  assert.equal(
    await validatePayloadRef("artifacts/present.md", taskDir),
    "artifacts/present.md",
  );
  assert.equal(
    await validatePayloadRef("artifacts/future.md", taskDir),
    "artifacts/future.md",
  );
});

test("payload_ref rejects absolute paths and traversal in either separator style", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "slime-validate-task-"));
  for (const ref of [join(taskDir, "artifact.md"), "/etc/passwd", "../secret", "a/../secret", "a\\..\\secret", "C:\\secret"])
    await assert.rejects(() => validatePayloadRef(ref, taskDir), ValidationError);
});

test("payload_ref rejects a symlink that escapes the real task directory", async () => {
  const parent = await mkdtemp(join(tmpdir(), "slime-validate-parent-"));
  const taskDir = join(parent, "task");
  const outside = join(parent, "outside");
  await mkdir(taskDir);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(taskDir, "escape"), "junction");

  await assert.rejects(
    () => validatePayloadRef("escape/secret.txt", taskDir),
    (error) => error instanceof ValidationError && /symbolic link|outside/i.test(error.message),
  );
});

test("task-aware entry points combine strict schema and payload_ref validation", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "slime-validate-task-"));
  await assert.rejects(
    () => validateRecordInputForTask({ ...validInput, payload_ref: "../escape" }, taskDir),
    ValidationError,
  );
  await assert.rejects(
    () => validateMemoryEntryForTask({ ...validEntry, payload_ref: "../escape" }, taskDir),
    ValidationError,
  );
});
