import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TaskStore } from "../.test-dist/task-store.js";

const TASK_NAME = "W6 lifecycle verification";
const CHECKPOINT = [
  "# W6 continuation state",
  "",
  "Completed: task creation and one durable observation.",
  "Next: continue from session B.",
].join("\n");

/**
 * Exercise the smallest durable TaskStore lifecycle using a disposable vault.
 * A logger may be supplied by tests; failures are intentionally allowed to
 * escape so the command-line entry point can return a non-zero exit status.
 */
export async function runLifecycleVerification({ log = console.log } = {}) {
  const vaultRoot = await mkdtemp(join(tmpdir(), "slime-mold-w6-"));

  const step = (name, detail) => log(`[ok] ${name}: ${detail}`);

  try {
    // W8: open({name}) creates a missing task, initializing task.json/state.md/log.
    const sessionA = new TaskStore(vaultRoot);
    const created = await sessionA.open({ name: TASK_NAME });
    const taskId = created.taskId;
    assert.ok(taskId, "open by name must create and return a task id");
    const taskDir = join(vaultRoot, "slime-mold", "tasks", taskId);
    step("create", `task "${TASK_NAME}" (${taskId}) in temporary vault ${vaultRoot}`);

    const openedA = await sessionA.open({ id: taskId });
    assert.equal(openedA.taskId, taskId);
    assert.equal(openedA.recentEntries.length, 0);
    step("session A open", `state=${JSON.stringify(openedA.state.content.trim())}`);

    const recorded = await sessionA.record(
      {
        agent: "dsh",
        sessionId: "w6-session-a",
        taskId,
        confidence: "high",
      },
      {
        type: "observation",
        layer: "draft",
        kind: "state",
        summary: "Session A completed the initial lifecycle work.",
        payload_ref: null,
      },
    );
    step("session A record", `entry ${recorded.id}`);

    await sessionA.checkpoint(taskId, { content: CHECKPOINT });
    step("session A checkpoint", `${CHECKPOINT.length} characters persisted`);

    await sessionA.close(taskId);
    const closedMetadata = JSON.parse(await readFile(join(taskDir, "task.json"), "utf8"));
    assert.equal(closedMetadata.status, "dormant");
    step("session A close", "lifecycle status=dormant");

    // A separate instance represents a new authenticated client session. It
    // resumes only with the explicit id and reads everything from disk.
    const sessionB = new TaskStore(vaultRoot);
    const reopened = await sessionB.open({ id: taskId });
    assert.equal(reopened.taskId, taskId);
    assert.deepEqual(reopened.state, { content: CHECKPOINT });
    assert.equal(reopened.recentEntries.length, 1);
    assert.equal(reopened.recentEntries[0].id, recorded.id);
    assert.equal(reopened.recentEntries[0].summary, "Session A completed the initial lifecycle work.");
    assert.equal(reopened.recentEntries[0].session_id, "w6-session-a");
    step(
      "session B reopen",
      `restored checkpoint and entry ${reopened.recentEntries[0].id}`,
    );

    step("verify", "create -> record -> checkpoint -> close -> reopen -> resume passed");
    return { taskId, recordedId: recorded.id, state: reopened.state.content };
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  runLifecycleVerification().catch((error) => {
    console.error("[failed] W6 lifecycle verification");
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
