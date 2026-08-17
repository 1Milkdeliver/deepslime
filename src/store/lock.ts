const taskQueues = new Map<string, Promise<void>>();

/** Process-wide single-writer queue, shared by every TaskStore instance. */
export async function withTaskLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = taskQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  taskQueues.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (taskQueues.get(key) === tail) taskQueues.delete(key);
  }
}
