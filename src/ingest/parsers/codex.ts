import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  IngestEvent,
  IngestSession,
  ParsedSource,
  SourceParser,
} from "../types.js";

/**
 * Codex CLI 会话 JSONL 解析器。
 *
 * Codex 会话存储:~/.codex/sessions/<date>/<session-id>.jsonl
 * 每行一个 JSON 对象(ndjson)。行结构因 Codex 版本而异,常见字段:
 * - { type: "session_start", timestamp, ... }
 * - { type: "response_item", timestamp, payload: { type: "message"|"function_call"|..., ... } }
 * - { type: "event_msg", ... }(旧版)
 * - { type: "user_message"|"agent_message"|"tool_call"|"tool_result", ... }(新版扁平结构)
 *
 * 本解析器采用容错策略:按行解析,识别常见结构,无法识别的行计入
 * skippedEvents,绝不因单行异常中断整个会话。
 */

export interface CodexParserOptions {
  /** 单会话最多事件数,防止超大会话拖慢聚合。 */
  maxEventsPerSession?: number;
  /** 是否递归扫描子目录(Codex 按日期分目录)。 */
  recursive?: boolean;
}

const DEFAULT_MAX_EVENTS = 2000;

interface RawJsonRecord {
  type?: unknown;
  timestamp?: unknown;
  payload?: unknown;
  content?: unknown;
  role?: unknown;
  name?: unknown;
  function_name?: unknown;
  arguments?: unknown;
  input?: unknown;
  output?: unknown;
  text?: unknown;
  message?: unknown;
  session_id?: unknown;
  cwd?: unknown;
}

export class CodexJsonlParser implements SourceParser {
  readonly source = "codex" as const;
  private readonly maxEventsPerSession: number;
  private readonly recursive: boolean;

  constructor(options: CodexParserOptions = {}) {
    this.maxEventsPerSession = options.maxEventsPerSession ?? DEFAULT_MAX_EVENTS;
    this.recursive = options.recursive ?? true;
  }

  /**
   * 解析一个 Codex 会话目录(含多个 .jsonl 会话文件)或单个 .jsonl 文件。
   */
  async parse(input: string): Promise<ParsedSource> {
    const files = await collectJsonlFiles(input, this.recursive);
    const sessions: IngestSession[] = [];
    const warnings: string[] = [];

    for (const file of files) {
      const parsed = await parseSessionFile(file, this.maxEventsPerSession);
      if (parsed === null) {
        warnings.push(`无法解析会话文件: ${file}`);
        continue;
      }
      sessions.push(parsed);
    }

    const totalEvents = sessions.reduce((sum, s) => sum + s.events.length, 0);
    return {
      source: "codex",
      sessions,
      stats: {
        totalEvents,
        skippedEvents: 0,
        sessionsWithTimestamp: sessions.filter((s) => s.startedAt !== "").length,
        warnings,
      },
    };
  }
}

/** 收集输入路径下的全部 .jsonl 文件(目录递归或单文件)。 */
async function collectJsonlFiles(input: string, recursive: boolean): Promise<string[]> {
  const stat = await safeStat(input);
  if (stat === "file") return [input];
  if (stat !== "dir") return [];

  const entries = await readdir(input, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(input, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(full);
    } else if (entry.isDirectory() && recursive) {
      files.push(...(await collectJsonlFiles(full, true)));
    }
  }
  return files.sort();
}

/** 解析单个会话文件为 IngestSession;失败返回 null。 */
async function parseSessionFile(
  path: string,
  maxEvents: number,
): Promise<IngestSession | null> {
  // 流式读取:Codex 会话文件可能超过 2 GiB(readFile 会抛 ERR_FS_FILE_TOO_LARGE)。
  const events: IngestEvent[] = [];
  let sessionId = basename(path).replace(/\.jsonl$/i, "");
  let startedAt = "";
  let endedAt = "";
  let title = "";
  let lineIndex = 0;
  let reachedCap = false;

  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");

  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      lineIndex += 1;
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (events.length >= maxEvents) {
        reachedCap = true;
        break;
      }

      let record: RawJsonRecord;
      try {
        record = JSON.parse(trimmed) as RawJsonRecord;
      } catch {
        continue; // 容错:坏行跳过(超大行/流式截断)
      }

      const event = extractEvent(record, lineIndex);
      if (event === null) continue;

      if (event.timestamp !== "") {
        if (startedAt === "" || event.timestamp < startedAt) startedAt = event.timestamp;
        if (event.timestamp > endedAt) endedAt = event.timestamp;
      }
      events.push({ ...event, seq: events.length });

      if (title === "" && event.type === "user_message") {
        title = event.text.slice(0, 120);
      }
    }
  } catch {
    return null;
  }

  if (events.length === 0) {
    return {
      sessionId,
      source: "codex",
      agent: "claude-code",
      title: title || basename(path).replace(/\.jsonl$/i, ""),
      startedAt,
      endedAt,
      events: [],
    };
  }

  return {
    sessionId,
    source: "codex",
    agent: "claude-code",
    title: title || events[0].text.slice(0, 120) || basename(path),
    startedAt,
    endedAt,
    events,
    ...(reachedCap ? { truncated: true } : {}),
  };
}

/** 从一行 JSON 记录中提取归一化事件;无法识别返回 null。 */
function extractEvent(record: RawJsonRecord, lineIndex: number): Omit<IngestEvent, "seq"> | null {
  const timestamp = toIso(record.timestamp) ?? "";
  const type = record.type;

  // 新版扁平结构:user_message / agent_message / tool_call / tool_result
  if (type === "user_message") {
    return {
      timestamp,
      type: "user_message",
      text: stringifyContent(record.content ?? record.text ?? record.message) || `(空用户消息 #${lineIndex})`,
    };
  }
  if (type === "agent_message" || type === "assistant_message") {
    return {
      timestamp,
      type: "assistant_message",
      text: stringifyContent(record.content ?? record.text ?? record.message) || `(空助手消息 #${lineIndex})`,
    };
  }
  if (type === "tool_call" || type === "function_call") {
    const name = String(record.name ?? record.function_name ?? "tool");
    const args = stringifyContent(record.arguments ?? record.input);
    return {
      timestamp,
      type: "tool_call",
      text: args ? `${name}: ${args}` : name,
      meta: { tool: name },
    };
  }
  if (type === "tool_result" || type === "function_call_output") {
    return {
      timestamp,
      type: "tool_result",
      text: stringifyContent(record.content ?? record.text ?? record.output) || `(工具结果 #${lineIndex})`,
    };
  }

  // event_msg 结构:真实用户消息/助手消息大多在此(Codex Desktop 格式)
  if (type === "event_msg" && isRecord(record.payload)) {
    const payload = record.payload as RawJsonRecord;
    const innerType = payload.type;
    if (innerType === "user_message") {
      return {
        timestamp,
        type: "user_message",
        text: stringifyContent(payload.message ?? payload.content ?? payload.text) || `(空用户消息 #${lineIndex})`,
      };
    }
    if (innerType === "agent_message" || innerType === "agent_reasoning") {
      return {
        timestamp,
        type: "assistant_message",
        text: stringifyContent(payload.message ?? payload.content ?? payload.text) || `(空助手消息 #${lineIndex})`,
      };
    }
  }

  // 新版 response_item 结构:payload 内嵌
  if (type === "response_item" && isRecord(record.payload)) {
    const payload = record.payload as RawJsonRecord;
    const innerType = payload.type;
    if (innerType === "message") {
      const role = payload.role;
      if (role === "user") {
        return { timestamp, type: "user_message", text: stringifyContent(payload.content) || `(空用户消息 #${lineIndex})` };
      }
      if (role === "assistant") {
        return { timestamp, type: "assistant_message", text: stringifyContent(payload.content) || `(空助手消息 #${lineIndex})` };
      }
      // developer/system 等角色是系统上下文,不产生记忆事件
      return null;
    }
    if (innerType === "function_call") {
      const name = String(payload.name ?? "tool");
      const args = stringifyContent(payload.arguments ?? payload.input);
      return {
        timestamp,
        type: "tool_call",
        text: args ? `${name}: ${args}` : name,
        meta: { tool: name },
      };
    }
    if (innerType === "function_call_output") {
      return {
        timestamp,
        type: "tool_result",
        text: stringifyContent(payload.output ?? payload.content) || `(工具结果 #${lineIndex})`,
      };
    }
    if (innerType === "agent_message" || innerType === "reasoning") {
      return {
        timestamp,
        type: "assistant_message",
        text: stringifyContent(payload.content ?? payload.text) || `(空助手消息 #${lineIndex})`,
      };
    }
  }

  // session_start 等元数据行:不产生事件,但可提取会话时间
  return null;
}

/** 把 content(可能是字符串或分段数组)转成纯文本。 */
function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part)) {
          const text = part.text ?? part.content;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .filter((text) => text !== "")
      .join("\n");
  }
  if (isRecord(value)) {
    const text = value.text ?? value.content;
    if (typeof text === "string") return text;
  }
  return "";
}

function toIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function safeStat(path: string): Promise<"file" | "dir" | "missing"> {
  try {
    const info = await stat(path);
    return info.isDirectory() ? "dir" : "file";
  } catch {
    return "missing";
  }
}
