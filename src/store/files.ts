import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AtomicFileHandle {
  writeFile(data: string, encoding: "utf8"): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicFileOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  open(path: string, flags: string): Promise<AtomicFileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const defaultFileOperations: AtomicFileOperations = { mkdir, open, rename, rm };

export async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function atomicReplace(
  path: string,
  content: string,
  operations: AtomicFileOperations = defaultFileOperations,
): Promise<void> {
  const parent = dirname(path);
  await operations.mkdir(parent, { recursive: true });
  const temporary = join(parent, `.${randomUUID()}.tmp`);
  let handle: AtomicFileHandle | undefined;
  try {
    handle = await operations.open(temporary, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await operations.rename(temporary, path);
    await syncDirectoryIfSupported(parent, operations);
  } finally {
    await handle?.close();
    await operations.rm(temporary, { force: true });
  }
}

/**
 * Atomically publishes a new file containing the old committed bytes plus one
 * complete JSON line. Existing committed records are never changed.
 */
export async function atomicAppendJsonLine(path: string, value: unknown): Promise<void> {
  const previous = (await readTextIfPresent(path)) ?? "";
  const confirmed = previous.endsWith("\n")
    ? previous
    : previous.slice(0, previous.lastIndexOf("\n") + 1);
  await atomicReplace(path, `${confirmed}${JSON.stringify(value)}\n`);
}

async function syncDirectoryIfSupported(
  path: string,
  operations: AtomicFileOperations,
): Promise<void> {
  let directory: AtomicFileHandle | undefined;
  try {
    directory = await operations.open(path, "r");
    await directory.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    await directory?.close();
  }
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return ["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EPERM"]
    .some((code) => isErrorCode(error, code));
}

export function parseJsonLines(path: string, text: string): unknown[] {
  const hasUnterminatedTail = text.length > 0 && !text.endsWith("\n");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();

  return lines.flatMap((line, index) => {
    if (line.trim() === "") return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch (error) {
      if (hasUnterminatedTail && index === lines.length - 1) return [];
      throw new Error(`Corrupt JSONL record in ${path} at line ${index + 1}`, {
        cause: error,
      });
    }
  });
}

export function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
