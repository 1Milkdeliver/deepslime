import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Atomically publishes a new file containing the old committed bytes plus one
 * complete JSON line. Existing committed records are never changed.
 */
export async function atomicAppendJsonLine(path: string, value: unknown): Promise<void> {
  const previous = (await readTextIfPresent(path)) ?? "";
  const separator = previous.length > 0 && !previous.endsWith("\n") ? "\n" : "";
  await atomicReplace(path, `${previous}${separator}${JSON.stringify(value)}\n`);
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
