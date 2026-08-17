import assert from "node:assert/strict";
import test from "node:test";

import { runBench } from "./bench.mjs";

test("bench measures all three SPEC section 7 P0 metrics", async () => {
  const result = await runBench({ openSamples: 2 });

  assert.deepEqual(result.dataset, {
    tasks: 3,
    entriesPerTask: 10,
    totalEntries: 30,
  });
  assert.equal(result.continuation.withMemory.context.estimatedTokens > 0, true);
  assert.equal(result.continuation.withMemory.timing.samples, 6);
  assert.equal(result.falseLoading.irrelevantProbes, 6);
  assert.equal(result.falseLoading.falseLoadRate, 0);
  assert.equal(result.reattach.successRate, 1);
  assert.equal(result.passed, true);
});
