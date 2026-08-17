import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TaskStore } from "../.test-dist/task-store.js";

const TASK_ID = "60000000-0000-4000-8000-000000000006";
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
  const taskDir = join(vaultRoot, "slime-mold", "tasks", TASK_ID);

  const step = (name, detail) => log(`[ok] ${name}: ${detail}`);

  try {
    // TaskStore currently opens existing tasks, so creation initializes the
    // CONTRACT.md directory shape before the first open.
    const sessionA = new TaskStore(vaultRoot);
    await mkdir(join(taskDir, "log"), { recursive: true });
    await writeFile(
      join(taskDir, "task.json"),
      `${JSON.stringify({ id: TASK_ID, name: TASK_NAME, status: "active" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(taskDir, "state.md"), "New task; no work recorded yet.\n", "utf8");
    step("create", `task ${TASK_ID} in temporary vault ${vaultRoot}`);

    const openedA = await sessionA.open({ id: TASK_ID });
    assert.equal(openedA.taskId, TASK_ID);
    assert.equal(openedA.recentEntries.length, 0);
    step("session A open", `state=${JSON.stringify(openedA.state.content.trim())}`);

    const recorded = await sessionA.record(
      {
        agent: "dsh",
        sessionId: "w6-session-a",
        taskId: TASK_ID,
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

    await sessionA.checkpoint(TASK_ID, { content: CHECKPOINT });
    step("session A checkpoint", `${CHECKPOINT.length} characters persisted`);

    await sessionA.close(TASK_ID);
    const closedMetadata = JSON.parse(await readFile(join(taskDir, "task.json"), "utf8"));
    assert.equal(closedMetadata.status, "dormant");
    step("session A close", "lifecycle status=dormant");

    // A separate instance represents a new authenticated client session. It
    // resumes only with the explicit id and reads everything from disk.
    const sessionB = new TaskStore(vaultRoot);
    const reopened = await sessionB.open({ id: TASK_ID });
    assert.equal(reopened.taskId, TASK_ID);
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
    return { taskId: TASK_ID, recordedId: recorded.id, state: reopened.state.content };
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
