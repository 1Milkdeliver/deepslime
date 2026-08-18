import type {
  AggregatedHighlight,
  IngestEvent,
  IngestSession,
  TaskCandidate,
} from "./types.js";

export interface AggregateOptions {
  /**
   * 事件类型的任务信号权重。
   * 标题/首消息权重最高(通常表达任务意图),决策/产物次之,普通消息最低。
   */
  weights?: Partial<Record<IngestEvent["type"], number>>;
}

const DEFAULT_WEIGHTS: Record<IngestEvent["type"], number> = {
  user_message: 2,
  assistant_message: 1,
  tool_call: 1.5,
  tool_result: 0.5,
  decision: 3,
  artifact: 3,
  observation: 1,
};

/** 从事件正文中提取任务候选名的长度上限。 */
const TITLE_CAP = 64;

/** 每个会话最多提取的 observation 类高光数(控制 Edge 浏览等大批量事件)。 */
const MAX_OBSERVATIONS_PER_SESSION = 5;

/**
 * 会话→任务 聚合器。
 *
 * 策略(P0,不做语义分类,SPEC 1.2 红线:不展示"自动分类"为卖点):
 * 1. 会话标题/首个用户消息作为任务名种子;
 * 2. 同 agent 内相同/高度相似标题的会话聚合为同一任务候选(归一化标题);
 * 3. 突出 decision/artifact 事件为溯源亮点;
 * 4. 每个会话只归属一个任务候选(以标题种子为准)。
 */
export class SessionAggregator {
  private readonly weights: Record<IngestEvent["type"], number>;

  constructor(options: AggregateOptions = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  }

  /**
   * 聚合一批会话为任务候选。
   * 返回候选列表,按任务信号总分降序。
   * 分组键大小写不敏感、空白折叠;任务名保留组内首个会话的原始标题。
   */
  aggregate(sessions: IngestSession[]): TaskCandidate[] {
    const groups = new Map<string, IngestSession[]>();

    for (const session of sessions) {
      const key = this.groupKey(session);
      const group = groups.get(key) ?? [];
      group.push(session);
      groups.set(key, group);
    }

    const candidates: TaskCandidate[] = [];
    for (const [groupKey, group] of groups) {
      const sorted = [...group].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      candidates.push({
        taskName: this.displayName(sorted[0], groupKey),
        sessions: sorted,
        highlights: this.extractHighlights(group),
      });
    }

    return candidates.sort(
      (a, b) => this.score(b.sessions) - this.score(a.sessions),
    );
  }

  /** 分组键:标题种子归一化(小写 + 空白折叠 + 剥离零宽字符 + 截断)。 */
  private groupKey(session: IngestSession): string {
    const seed = cleanTitle(session);
    const normalized = seed.replace(/\s+/g, " ").trim().toLowerCase();
    return normalized.length === 0
      ? `untitled-${session.source}-${session.sessionId.slice(0, 8)}`
      : normalized.slice(0, TITLE_CAP);
  }

  /** 展示名:组内首个会话的原始标题(剥离零宽字符 + 截断);空则用分组键。 */
  private displayName(first: IngestSession, groupKey: string): string {
    const seed = cleanTitle(first);
    const normalized = seed.replace(/\s+/g, " ").trim();
    return normalized.length === 0 ? groupKey : normalized.slice(0, TITLE_CAP);
  }

  /** 提取每个会话内的高光事件(decision/artifact/question + 高信号事件)。 */
  private extractHighlights(group: IngestSession[]): AggregatedHighlight[] {
    const highlights: AggregatedHighlight[] = [];
    const seen = new Set<string>();

    for (const session of group) {
      // 每会话高光上限:observation 类事件(如 Edge 浏览)数量大,只保留代表样本。
      let observationBudget = MAX_OBSERVATIONS_PER_SESSION;
      for (const event of session.events) {
        const entryType = mapToEntryType(event);
        if (entryType === null) continue;

        if (entryType === "observation" && observationBudget <= 0) continue;
        if (entryType === "observation") observationBudget -= 1;

        const key = `${session.sessionId}:${event.seq}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const summary = summarize(event, session);
        if (summary.length === 0) continue;

        highlights.push({
          session,
          event,
          entryType,
          summary,
          confidence: confidenceFor(event, session),
        });
      }
    }
    return highlights;
  }

  /** 任务信号总分(用于候选排序)。 */
  private score(sessions: IngestSession[]): number {
    let total = 0;
    for (const session of sessions) {
      for (const event of session.events) {
        total += this.weights[event.type] ?? 0;
      }
    }
    return total;
  }
}

function firstUserText(session: IngestSession): string {
  const firstUser = session.events.find((event) => event.type === "user_message");
  return firstUser?.text ?? "";
}

/** 把归一化事件映射到 MemoryEntry.type;低价值事件返回 null。 */
function mapToEntryType(event: IngestEvent): AggregatedHighlight["entryType"] | null {
  switch (event.type) {
    case "decision":
      return "decision";
    case "artifact":
      return "artifact";
    case "tool_call":
      return "observation";
    case "observation":
      return "observation";
    case "user_message":
      return "question";
    default:
      return null;
  }
}

/** 生成一句话摘要:截断正文,标注来源会话。 */
function summarize(event: IngestEvent, session: IngestSession): string {
  const text = event.text.trim().replace(/\s+/g, " ");
  if (text.length === 0) return "";
  const capped = text.length > 120 ? `${text.slice(0, 117)}…` : text;
  const agent = session.agent ?? "unknown";
  return `[${session.source}/${agent}] ${capped}`;
}

/** 置信度启发式:P0 从会话来源与事件类型推断,不依赖模型打分。 */
function confidenceFor(
  event: IngestEvent,
  session: IngestSession,
): AggregatedHighlight["confidence"] {
  if (event.type === "decision" || event.type === "artifact") return "high";
  if (session.agent === "claude-code") return "medium";
  return "low";
}

/**
 * 剥离文本中的零宽字符与不可见格式字符。
 * 某些会话把零宽文本(U+200B/200C/200D/2060/FEFF 等)当作消息内容,
 * 作为任务名毫无意义且难以阅读。
 */
export function stripZeroWidth(value: string): string {
  return value.replace(
    // 零宽字符 + 不可见格式字符 + 双向文本控制符
    /[\u200B-\u200F\u2060-\u206F\uFEFF\u00AD\u034F\u180E\u202A-\u202E]/gu,
    "",
  );
}

/** 任务名种子:标题优先,否则首个用户消息;统一剥离零宽字符。 */
function cleanTitle(session: IngestSession): string {
  return stripZeroWidth(session.title.trim() || firstUserText(session));
}