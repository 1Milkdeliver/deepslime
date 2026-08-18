import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { decompress } from "fzstd";
import type {
  IngestEvent,
  IngestSession,
  ParsedSource,
  SourceParser,
} from "../types.js";

/**
 * DSH(DeepSeek Harness)会话解析器。
 *
 * DSH 会话以 zstd 压缩的 JSONL 存储于 ~/.dsh/sessions/<workspace>/<session-id>/session.jsonl.zstd。
 * 真实行结构(DSH 事件流):
 * - { "type": "session", "id": "...", "createdAt": <ms>, "cwd": "...", "agentPreset": "..." }
 * - { "type": "user/message", "seq": N, "time": <ms>, "data": { "content": [{ "type": "text", "text": "..." }], "role": "user", "id": "..." } }
 * - { "type": "assistant/message", "time": <ms>, "data": { "message": { "role": "assistant", "content": [{ "type": "text", "text": "..." }] } } }
 * - { "type": "tool/call", "time": <ms>, "data": { "name": "...", "arguments": "<json string>" } }
 * - { "type": "tool/result", "time": <ms>, "data": { "message": { "content": [{ "type": "tool-result", "content": [{ "type": "text", "text": "..." }] }] } } }
 * - { "type": "session/title", "data": { "title": "..." } }
 * 流式 chunk 事件(assistant/chunk、reasoning-chunks、text-chunks、tool-call-chunks)跳过,
 * 因为同轮必有完整 assistant/message / tool/call。
 */

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

export interface DshParserOptions {
  /** 单会话最多事件数。 */
  maxEventsPerSession?: number;
  /** 是否递归扫描子目录。 */
  recursive?: boolean;
}

export class DshZstdParser implements SourceParser {
  readonly source = "dsh" as const;
  private readonly maxEventsPerSession: number;
  private readonly recursive: boolean;

  constructor(options: DshParserOptions = {}) {
    this.maxEventsPerSession = options.maxEventsPerSession ?? 2000;
    this.recursive = options.recursive ?? true;
  }

  /** 解析 zstd 文件或目录,返回归一化 DSH 会话。 */
  async parse(input: string): Promise<ParsedSource> {
    const files = await collectZstdFiles(input, this.recursive);
    const sessions: IngestSession[] = [];
    const warnings: string[] = [];

    for (const file of files) {
      const parsed = await this.parseFile(file);
      if (parsed === null) {
        warnings.push(`无法解析 DSH 会话文件: ${file}`);
        continue;
      }
      sessions.push(parsed);
    }

    return {
      source: "dsh",
      sessions,
      stats: {
        totalEvents: sessions.reduce((sum, s) => sum + s.events.length, 0),
        skippedEvents: 0,
        sessionsWithTimestamp: sessions.filter((s) => s.startedAt !== "").length,
        warnings,
      },
    };
  }

  private async parseFile(path: string): Promise<IngestSession | null> {
    let buffer: Buffer;
    try {
      buffer = await readFile(path);
    } catch {
      return null;
    }

    const decompressed = this.decompress(buffer, path);
    if (decompressed === null) return null;

    const text = new TextDecoder("utf-8", { fatal: false }).decode(decompressed);
    const sessionId = baseId(path);
    const events: IngestEvent[] = [];
    let title = "";
    let sessionCreatedAt = "";

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");

    for (const [index, line] of lines.entries()) {
      if (events.length >= this.maxEventsPerSession) break;
      let record: DshEventRecord;
      try {
        record = JSON.parse(line) as DshEventRecord;
      } catch {
        continue; // 容错:坏行跳过
      }

      // session 元数据行:提取 id / createdAt
      if (record.type === "session") {
        sessionCreatedAt = msToIso(record.createdAt);
        continue;
      }
      if (record.type === "session/title") {
        const t = record.data?.title;
        if (typeof t === "string" && title === "") title = t;
        continue;
      }

      const event = extractDshEvent(record, index);
      if (event === null) continue;
      events.push({ ...event, seq: events.length });
    }

    if (events.length === 0) return null;

    const timestamps = events
      .map((event) => event.timestamp)
      .filter((value) => value !== "")
      .sort();

    return {
      sessionId,
      source: "dsh",
      agent: "dsh",
      title: title || events[0].text.slice(0, 120) || sessionId,
      startedAt: timestamps[0] ?? sessionCreatedAt,
      endedAt: timestamps.at(-1) ?? sessionCreatedAt,
      events,
    };
  }

  private decompress(buffer: Buffer, path: string): Uint8Array | null {
    if (hasZstdMagic(buffer)) {
      try {
        return decompress(new Uint8Array(buffer));
      } catch (error) {
        throw new Error(`DSH 会话 zstd 解压失败: ${path}`, { cause: error });
      }
    }
    // 没有 magic 的可能是未压缩 JSON,直接返回原字节。
    return new Uint8Array(buffer);
  }
}

/** DSH 事件行(按真实格式的宽松字段建模)。 */
interface DshEventRecord {
  type?: unknown;
  seq?: unknown;
  time?: unknown;
  createdAt?: unknown;
  id?: unknown;
  data?: {
    title?: unknown;
    role?: unknown;
    name?: unknown;
    arguments?: unknown;
    content?: unknown;
    message?: unknown;
    text?: unknown;
  };
}

/** 从一行 DSH 事件中提取归一化事件;无法识别返回 null。 */
function extractDshEvent(
  record: DshEventRecord,
  lineIndex: number,
): Omit<IngestEvent, "seq"> | null {
  const timestamp = msToIso(record.time) ?? "";
  const type = record.type;
  const data = isRecord(record.data) ? record.data : undefined;

  // 用户消息:user/message 或 agent/inbox/spliced 中 role=user 的插入消息
  if (type === "user/message") {
    return {
      timestamp,
      type: "user_message",
      text: contentToText(data?.content) || `(空用户消息 #${lineIndex})`,
    };
  }
  if (type === "agent/inbox/spliced" && data !== undefined) {
    const inserted = Array.isArray(data.content) ? data.content : [];
    const userMsg = inserted.find((item) => isRecord(item) && item.role === "user");
    if (userMsg !== undefined && isRecord(userMsg)) {
      const text = contentToText((userMsg as Record<string, unknown>).content);
      if (text !== "") {
        return { timestamp, type: "user_message", text };
      }
    }
    return null;
  }

  // 助手完整消息
  if (type === "assistant/message") {
    const message = isRecord(data?.message) ? data.message as Record<string, unknown> : undefined;
    const text = contentToText(message?.content) || contentToText(data?.content);
    return {
      timestamp,
      type: "assistant_message",
      text: text || `(空助手消息 #${lineIndex})`,
    };
  }

  // 工具调用
  if (type === "tool/call") {
    const name = typeof data?.name === "string" ? data.name : "tool";
    const args = stringifyToolArguments(data?.arguments);
    return {
      timestamp,
      type: "tool_call",
      text: args ? `${name}: ${args}` : name,
      meta: { tool: name },
    };
  }

  // 工具结果:data.message.content[].content[].text 或 data.content
  if (type === "tool/result") {
    const message = isRecord(data?.message) ? data.message as Record<string, unknown> : undefined;
    const text = contentToText(message?.content) || contentToText(data?.content);
    return {
      timestamp,
      type: "tool_result",
      text: text || `(工具结果 #${lineIndex})`,
    };
  }

  // 其余类型(session/permission/step 等)不产生记忆事件
  return null;
}

/** 把 content 数组(或单个对象)中的 text 拼接出来。 */
function contentToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const part of value) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (!isRecord(part)) continue;
      // 直取 text;或递归取嵌套 content(tool-result 结构)
      const direct = part.text ?? part.content;
      if (typeof direct === "string") {
        parts.push(direct);
      } else {
        const nested = contentToText(direct);
        if (nested !== "") parts.push(nested);
      }
    }
    return parts.filter((text) => text !== "").join("\n");
  }
  if (isRecord(value)) {
    const text = value.text ?? value.content;
    if (typeof text === "string") return text;
    return contentToText(text);
  }
  return "";
}

/** tool/call 的 arguments 可能是 JSON 字符串或对象,压缩成简短可读形式。 */
function stringifyToolArguments(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed).slice(0, 200);
    } catch {
      return value.slice(0, 200);
    }
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value).slice(0, 200);
  }
  return "";
}

/** 毫秒时间戳 → ISO8601 UTC;无效返回空串。 */
function msToIso(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "";
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return "";
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function hasZstdMagic(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  for (let index = 0; index < 4; index += 1) {
    if (buffer[index] !== ZSTD_MAGIC[index]) return false;
  }
  return true;
}

/** 收集目录下的全部 zstd 会话文件。 */
async function collectZstdFiles(input: string, recursive: boolean): Promise<string[]> {
  const info = await safeStat(input);
  if (info === "file") return [input];
  if (info !== "dir") return [];

  const entries = await readdir(input, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(input, entry.name);
    if (entry.isFile()) {
      if (/\.(zst|zstd)$/i.test(entry.name)) files.push(full);
    } else if (entry.isDirectory() && recursive) {
      files.push(...(await collectZstdFiles(full, true)));
    }
  }
  return files.sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function baseId(path: string): string {
  return path.split(/[\\/]/).at(-2) ?? path;
}

async function safeStat(path: string): Promise<"file" | "dir" | "missing"> {
  try {
    const info = await stat(path);
    return info.isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}
