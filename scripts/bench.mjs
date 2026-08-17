import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

import { TaskStore } from "../.test-dist/task-store.js";

const TASK_COUNT = 3;
const ENTRIES_PER_TASK = 10;
const OPEN_SAMPLES = 20;
const TOKEN_CHARS = 4;

const TASKS = Array.from({ length: TASK_COUNT }, (_, index) => ({
  id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  name: `W9 benchmark task ${index + 1}`,
}));

const STATE = (task) => [
  `# ${task.name}`,
  "",
  "Completed: ten durable benchmark observations were recorded.",
  `Next: resume ${task.name} from its saved checkpoint.`,
].join("\n");

function contextStats(opened) {
  const serialized = JSON.stringify({ state: opened.state, entries: opened.recentEntries });
  return {
    characters: serialized.length,
    bytes: Buffer.byteLength(serialized, "utf8"),
    estimatedTokens: Math.ceil(serialized.length / TOKEN_CHARS),
  };
}

function summarizeSamples(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    samples: samples.length,
    meanMs: Number(meanMs.toFixed(3)),
    medianMs: Number(medianMs.toFixed(3)),
    minMs: Number(sorted[0].toFixed(3)),
    maxMs: Number(sorted.at(-1).toFixed(3)),
  };
}

async function measureOpen(store, identifier, samples) {
  const durations = [];
  let opened;
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    opened = await store.open(identifier);
    durations.push(performance.now() - start);
  }
  return { durations, timing: summarizeSamples(durations), opened };
}

async function initializeTask(vaultRoot, task) {
  const taskDir = join(vaultRoot, "slime-mold", "tasks", task.id);
  await mkdir(join(taskDir, "log"), { recursive: true });
  await writeFile(
    join(taskDir, "task.json"),
    `${JSON.stringify({ id: task.id, name: task.name, status: "active" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(taskDir, "state.md"), "", "utf8");
}

async function addMemories(store, task) {
  for (let index = 0; index < ENTRIES_PER_TASK; index += 1) {
    await store.record(
      {
        agent: "dsh",
        sessionId: `bench-${task.id}-${index + 1}`,
        taskId: task.id,
        confidence: "high",
      },
      {
        type: "observation",
        layer: "draft",
        kind: "state",
        summary: `${task.name}: durable observation ${index + 1} of ${ENTRIES_PER_TASK}.`,
        payload_ref: null,
      },
    );
  }
  await store.checkpoint(task.id, { content: STATE(task) });
}

async function measureFalseLoadRate(store, vaultRoot) {
  const probes = TASKS.flatMap((task) => [
    `${task.name} unrelated`,
    task.name.replace("benchmark", "bench mark"),
  ]);
  let accepted = 0;
  let rejected = 0;
  const benchmarkTaskIds = new Set(TASKS.map((task) => task.id));

  for (const name of probes) {
    const opened = await store.open({ name });
    if (benchmarkTaskIds.has(opened.taskId)) {
      accepted += 1;
    } else {
      // Current P0 creates an empty task for a new exact name. This counts as
      // rejecting unrelated memory, because no existing task was recalled.
      assert.deepEqual(opened.state, { content: "" });
      assert.equal(opened.recentEntries.length, 0);
      rejected += 1;
      await rm(join(vaultRoot, "slime-mold", "tasks", opened.taskId), {
        recursive: true,
        force: true,
      });
    }
  }

  // Exact-name controls ensure a zero rate is caused by precise matching,
  // rather than all name lookups being broken.
  for (const task of TASKS) {
    const opened = await store.open({ name: task.name });
    assert.equal(opened.taskId, task.id);
  }

  return {
    mode: "P0 exact-name simulation (new names may create empty tasks; no search API)",
    irrelevantProbes: probes.length,
    incorrectlyAccepted: accepted,
    correctlyRejected: rejected,
    exactNameControlsAccepted: TASKS.length,
    falseLoadRate: accepted / probes.length,
    target: "< 0.05",
    passed: accepted / probes.length < 0.05,
  };
}

async function measureReattachSuccess(vaultRoot) {
  let restored = 0;
  const failures = [];

  for (const task of TASKS) {
    try {
      // A fresh store instance represents an agent returning after going off-topic.
      const resumed = await new TaskStore(vaultRoot).open({ id: task.id });
      assert.deepEqual(resumed.state, { content: STATE(task) });
      assert.equal(resumed.recentEntries.length, ENTRIES_PER_TASK);
      assert.ok(resumed.recentEntries.every((entry) => entry.task_id === task.id));
      restored += 1;
    } catch (error) {
      failures.push({ taskId: task.id, error: String(error) });
    }
  }

  return {
    mode: "P0 open({id}) reattach simulation",
    attempts: TASKS.length,
    fullyRestored: restored,
    failures,
    successRate: restored / TASKS.length,
    target: "> 0.90",
    passed: restored / TASKS.length > 0.9,
  };
}

/** Run the three SPEC section 7 P0 measurements in a disposable real TaskStore. */
export async function runBench({ openSamples = OPEN_SAMPLES } = {}) {
  assert.ok(Number.isInteger(openSamples) && openSamples > 0, "openSamples must be a positive integer");
  const vaultRoot = await mkdtemp(join(tmpdir(), "slime-mold-w9-bench-"));
  const store = new TaskStore(vaultRoot);

  try {
    for (const task of TASKS) await initializeTask(vaultRoot, task);

    const withoutMemory = [];
    for (const task of TASKS) {
      const result = await measureOpen(store, { id: task.id }, openSamples);
      assert.equal(result.opened.recentEntries.length, 0);
      withoutMemory.push(result);
    }

    for (const task of TASKS) await addMemories(store, task);

    const withMemory = [];
    for (const task of TASKS) {
      const result = await measureOpen(store, { id: task.id }, openSamples);
      assert.equal(result.opened.recentEntries.length, ENTRIES_PER_TASK);
      withMemory.push(result);
    }

    const withoutMemorySamples = withoutMemory.flatMap((result) => result.durations);
    const withMemorySamples = withMemory.flatMap((result) => result.durations);
    const withoutTiming = summarizeSamples(withoutMemorySamples);
    const withTiming = summarizeSamples(withMemorySamples);
    const withoutContext = contextStats(withoutMemory[0].opened);
    const withContext = contextStats(withMemory[0].opened);

    const continuation = {
      method: "TaskStore.open latency; LLM work is represented only by loaded context size",
      withoutMemory: { timing: withoutTiming, context: withoutContext },
      withMemory: { timing: withTiming, context: withContext },
      storageLatencyDifferenceMs: Number((withTiming.meanMs - withoutTiming.meanMs).toFixed(3)),
      storageLatencyRatio: Number((withTiming.meanMs / withoutTiming.meanMs).toFixed(3)),
      tokenEstimateMethod: `ceil(serialized context characters / ${TOKEN_CHARS})`,
    };

    const falseLoading = await measureFalseLoadRate(store, vaultRoot);
    const reattach = await measureReattachSuccess(vaultRoot);
    const passed = falseLoading.passed && reattach.passed;
    assert.equal(
      passed,
      true,
      `one or more SPEC metric thresholds failed: ${JSON.stringify({ falseLoading, reattach })}`,
    );

    return {
      benchmark: "slime-mold SPEC section 7 (P0)",
      dataset: { tasks: TASK_COUNT, entriesPerTask: ENTRIES_PER_TASK, totalEntries: 30 },
      continuation,
      falseLoading,
      reattach,
      passed,
    };
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  runBench()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({ benchmark: "slime-mold SPEC section 7 (P0)", passed: false }));
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}
