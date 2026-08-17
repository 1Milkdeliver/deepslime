import assert from "node:assert/strict";
import test from "node:test";

import { atomicReplace } from "../../../.test-dist/store/files.js";

test("atomic replacement syncs file data before rename and directory metadata after", async () => {
  const events = [];
  const operations = {
    async mkdir() {
      events.push("mkdir");
    },
    async open(_path, flags) {
      const label = flags === "wx" ? "file" : "directory";
      events.push(`open-${label}`);
      return {
        async writeFile(content, encoding) {
          events.push(`write-${content}-${encoding}`);
        },
        async sync() {
          events.push(`sync-${label}`);
        },
        async close() {
          events.push(`close-${label}`);
        },
      };
    },
    async rename() {
      events.push("rename");
    },
    async rm() {
      events.push("cleanup");
    },
  };

  await atomicReplace("vault/task/state.md", "durable", operations);

  assert.deepEqual(events, [
    "mkdir",
    "open-file",
    "write-durable-utf8",
    "sync-file",
    "close-file",
    "rename",
    "open-directory",
    "sync-directory",
    "close-directory",
    "cleanup",
  ]);
});
