import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function assertSafeTaskId(taskId: string): void {
  if (
    taskId.length === 0 ||
    taskId === "." ||
    taskId === ".." ||
    taskId.includes("/") ||
    taskId.includes("\\") ||
    isAbsolute(taskId)
  ) {
    throw new Error("Invalid task id");
  }
}

export async function assertSafePayloadRef(taskDir: string, payloadRef: string | null): Promise<void> {
  if (payloadRef === null) return;
  if (payloadRef.length === 0 || isAbsolute(payloadRef)) {
    throw new Error("payload_ref must be a non-empty relative path");
  }

  const segments = payloadRef.split(/[\\/]+/u);
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new Error("payload_ref contains an unsafe path segment");
  }

  const root = await realpath(taskDir);
  const target = resolve(root, payloadRef);
  assertInside(root, target);

  // Resolve the closest existing ancestor. This catches symlink/junction escapes
  // even when the final payload file has not been created yet.
  let existing = target;
  while (!(await exists(existing))) {
    const parent = dirname(existing);
    if (parent === existing) throw new Error("Unable to resolve payload_ref");
    existing = parent;
  }
  assertInside(root, await realpath(existing));
}

function assertInside(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("payload_ref resolves outside the task directory");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
