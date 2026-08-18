import type { MemoryAgent, MemoryConfidence } from "../task-schema.js";

/**
 * 摄入管线的归一化中间模型。
 *
 * 三个异构数据源(Codex JSONL / DSH zstd / Edge SQLite)各自解析后,
 * 统一汇入本模型,再由聚合器做"会话→任务"聚合,最后写入 TaskStore。
 * 保持最小字段集:只携带聚合和溯源需要的信息,不复制原文。
 */
export type IngestSource = "codex" | "dsh" | "edge";

export type IngestEventType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "decision"
  | "artifact"
  | "observation";

/** 一条归一化的事件(消息/工具调用/状态变化)。 */
export interface IngestEvent {
  /** 事件在源会话内的序号,用于保持顺序。 */
  seq: number;
  /** 归一化后的时间戳(ISO8601 UTC);源无时间时为空串。 */
  timestamp: string;
  type: IngestEventType;
  /** 事件正文(消息文本/工具名/摘要),聚合时用于提取任务信号。 */
  text: string;
  /** 可选的附加结构化信息,不参与聚合,保留给溯源。 */
  meta?: Record<string, unknown>;
}

/** 一个归一化会话:三个数据源的共同汇入形态。 */
export interface IngestSession {
  /** 源会话 ID(Codex 会话 id / DSH session id / Edge 浏览会话 id)。 */
  sessionId: string;
  /** 源类型。 */
  source: IngestSource;
  /**
   * 会话所属的 agent 标识。
   * 对 Codex/DSH 会话必填;Edge 浏览历史没有 agent 归属,可为空,
   * 写入 TaskStore 时由管线入口注入的 agent 决定(见 TaskStoreWriter)。
   */
  agent?: MemoryAgent;
  /** 会话标题或首个用户消息,用于命名任务。 */
  title: string;
  /** 会话开始时间(ISO8601 UTC),用于排序;未知为空串。 */
  startedAt: string;
  /** 会话结束时间(ISO8601 UTC);未知为空串。 */
  endedAt: string;
  /** 归一化事件,按 seq 升序。 */
  events: IngestEvent[];
  /** 事件数达到上限被截断时为 true(超大会话)。 */
  truncated?: boolean;
}

/** 聚合器输出:一个"任务候选"及其来源会话。 */
export interface TaskCandidate {
  /** 聚合得到的任务名(由标题/首消息/高频信号生成)。 */
  taskName: string;
  /** 参与聚合的会话。 */
  sessions: IngestSession[];
  /** 会话内的关键事件(决策/产物),聚合后写入 TaskStore 的候选条目。 */
  highlights: AggregatedHighlight[];
}

export interface AggregatedHighlight {
  session: IngestSession;
  event: IngestEvent;
  /** 映射到 MemoryEntry.type 的候选值。 */
  entryType: "decision" | "artifact" | "observation" | "question" | "fact";
  summary: string;
  confidence: MemoryConfidence;
}

/** 解析器统一返回的原始解析结果。 */
export interface ParsedSource {
  source: IngestSource;
  sessions: IngestSession[];
  /** 统计信息,用于覆盖诚实区(sm-config.json)与日志。 */
  stats: {
    totalEvents: number;
    skippedEvents: number;
    sessionsWithTimestamp: number;
    warnings: string[];
  };
}

/** 解析器接口:每个数据源实现一个。 */
export interface SourceParser {
  readonly source: IngestSource;
  /** 解析指定路径/目录,返回归一化会话。 */
  parse(input: string): Promise<ParsedSource>;
}
