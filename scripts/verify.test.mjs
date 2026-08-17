import assert from "node:assert/strict";
import test from "node:test";

import { runLifecycleVerification } from "./verify.mjs";

test("verification script completes the full two-session lifecycle", async () => {
  const output = [];
  const result = await runLifecycleVerification({ log: (line) => output.push(line) });

  assert.equal(result.taskId, "60000000-0000-4000-8000-000000000006");
  assert.match(result.recordedId, /^[0-9a-f-]{36}$/i);
  assert.match(result.state, /continue from session B/);
  assert.deepEqual(
    output.map((line) => line.match(/^\[ok\] ([^:]+)/)?.[1]),
    [
      "create",
      "session A open",
      "session A record",
      "session A checkpoint",
      "session A close",
      "session B reopen",
      "verify",
    ],
  );
});
