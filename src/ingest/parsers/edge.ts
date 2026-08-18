import type {
  IngestEvent,
  IngestSession,
  ParsedSource,
  SourceParser,
} from "../types.js";

/**
 * Edge 历史 SQLite 解析器。
 *
 * 数据源:`<Edge User Data>/Default/History`(Chromium SQLite)。
 * Edge 历史没有"agent 会话"概念,本解析器按浏览时间间隔把连续浏览
 * 聚合成"浏览会话":间隔超过 GAP_MS 即切开。每个浏览会话对应一次
 * IngestSession(source=edge, agent 为空),任务名种子用页面标题。
 *
 * 时间字段:Chromium 时间戳 = 1601-01-01 UTC 起的微秒。
 * 转 ISO8601 UTC:`new Date((t - 11644473600000000) / 1000)`。
 */

const CHROMIUM_EPOCH_OFFSET_US = 11644473600000000n;
const GAP_MS = 30 * 60 * 1000; // 30 分钟无浏览视为会话切分点

interface EdgeUrlRow {
  id: number;
  url: string;
  title: string;
  /** Chromium 微秒时间戳,以字符串返回避免 JS number 溢出。 */
  last_visit_time: string;
}

interface EdgeVisitRow {
  url: number;
  /** Chromium 微秒时间戳,以字符串返回避免 JS number 溢出。 */
  visit_time: string;
}

export interface EdgeParserOptions {
  /** 浏览会话切分间隔(毫秒),默认 30 分钟。 */
  gapMs?: number;
  /** 单会话最多事件数,防止一个长期浏览会话过大。 */
  maxEventsPerSession?: number;
}

type SqliteDatabase = {
  all<T = unknown>(sql: string): T[];
  close(): void;
};

/**
 * 打开 SQLite 数据库(只读)。
 * 使用 Node 内置 node:sqlite(Node 22.5+);Node 24 已稳定支持。
 */
async function openDatabase(path: string): Promise<SqliteDatabase> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    all<T = unknown>(sql: string): T[] {
      return db.prepare(sql).all() as T[];
    },
    close() {
      db.close();
    },
  };
}

export class EdgeHistoryParser implements SourceParser {
  readonly source = "edge" as const;
  private readonly gapMs: number;
  private readonly maxEventsPerSession: number;

  constructor(options: EdgeParserOptions = {}) {
    this.gapMs = options.gapMs ?? GAP_MS;
    this.maxEventsPerSession = options.maxEventsPerSession ?? 500;
  }

  /** 解析 Edge 历史库,返回归一化浏览会话。 */
  async parse(input: string): Promise<ParsedSource> {
    const db = await openDatabase(input);
    const warnings: string[] = [];

    try {
      const urls = readUrls(db);
      if (urls.size === 0) {
        warnings.push("Edge 历史库中没有 urls 记录");
      }

      const visits = db.all<EdgeVisitRow>(
        "SELECT url, CAST(visit_time AS TEXT) AS visit_time FROM visits ORDER BY visit_time ASC",
      );
      const events: IngestEvent[] = [];

      for (const visit of visits) {
        const row = urls.get(visit.url);
        if (row === undefined) continue;
        const timestamp = chromiumTimestampToIso(visit.visit_time);
        if (timestamp === null) continue;
        events.push({
          seq: events.length,
          timestamp,
          type: "observation",
          text: row.title || row.url,
          meta: { url: row.url },
        });
      }

      const sessions = splitIntoBrowsingSessions(
        events,
        this.gapMs,
        this.maxEventsPerSession,
      );

      return {
        source: "edge",
        sessions,
        stats: {
          totalEvents: events.length,
          skippedEvents: 0,
          sessionsWithTimestamp: events.filter((event) => event.timestamp !== "").length,
          warnings,
        },
      };
    } finally {
      db.close();
    }
  }
}

/** 读取 urls 表为 id → 行 的映射。 */
function readUrls(db: SqliteDatabase): Map<number, EdgeUrlRow> {
  const rows = db.all<EdgeUrlRow>(
    "SELECT id, url, title, CAST(last_visit_time AS TEXT) AS last_visit_time FROM urls",
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * 把连续浏览事件按时间间隔切分为浏览会话。
 * 每个会话:sessionId = edge-<首个事件时间戳>,标题 = 首个事件文本。
 */
function splitIntoBrowsingSessions(
  events: IngestEvent[],
  gapMs: number,
  maxEventsPerSession: number,
): IngestSession[] {
  const sessions: IngestSession[] = [];
  let current: IngestEvent[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current.at(-1)!;
    sessions.push({
      sessionId: `edge-${first.timestamp.replace(/[:.]/g, "-") || String(events.indexOf(first))}`,
      source: "edge",
      title: first.text.slice(0, 120),
      startedAt: first.timestamp,
      endedAt: last.timestamp,
      events: current,
    });
    current = [];
  };

  for (const event of events) {
    if (current.length > 0 && event.timestamp !== "") {
      const previous = current.at(-1)!;
      const previousTime = Date.parse(previous.timestamp);
      const eventTime = Date.parse(event.timestamp);
      if (
        Number.isFinite(previousTime) &&
        Number.isFinite(eventTime) &&
        eventTime - previousTime > gapMs
      ) {
        flush();
      }
    }
    if (current.length >= maxEventsPerSession) flush();
    current.push(event);
  }
  flush();

  return sessions;
}

/** Chromium 微秒时间戳(数字或字符串)→ ISO8601 UTC;无效返回 null。 */
function chromiumTimestampToIso(value: number | bigint | string): string | null {
  if (value === null || value === undefined) return null;
  let us: bigint;
  try {
    us = BigInt(value);
  } catch {
    return null;
  }
  if (us <= 0n) return null;
  const millis = Number((us - CHROMIUM_EPOCH_OFFSET_US) / 1000n);
  if (!Number.isFinite(millis) || millis < 0) return null;
  return new Date(millis).toISOString();
}
