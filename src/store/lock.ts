import { realpath } from "node:fs/promises";

const taskQueues = new Map<string, Promise<void>>();

/** Process-wide single-writer queue, shared by every TaskStore instance. */
export async function withTaskLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const canonicalKey = await canonicalLockKey(key);
  const previous = taskQueues.get(canonicalKey) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  taskQueues.set(canonicalKey, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (taskQueues.get(canonicalKey) === tail) taskQueues.delete(canonicalKey);
  }
}

async function canonicalLockKey(path: string): Promise<string> {
  const canonical = await realpath(path);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}
