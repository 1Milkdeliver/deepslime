/**
 * 面板数据读取层(纯类型,不依赖 Obsidian API)。
 *
 * 由 Obsidian 插件调用,VaultAdapter 抽象由插件侧实现
 * (Obsidian 的 vault.adapter 或 Node fs,二者都满足该接口)。
 */

export interface MemoryEntry {
  id: string;
  task_id: string;
  agent: "claude-code" | "dsh" | "chatgpt" | "cursor";
  session_id: string;
  timestamp: string;
  type: "decision" | "artifact" | "observation" | "question" | "fact";
  layer: "fact" | "draft";
  kind: "reference" | "state";
  summary: string;
  payload_ref: string | null;
  confidence: "high" | "medium" | "low";
  source_scope: "personal";
}

export interface TaskMetadata {
  id: string;
  name: string;
  status: "active" | "dormant";
}

export interface TaskSummary {
  metadata: TaskMetadata;
  state: string;
  entries: MemoryEntry[];
  entryCount: number;
  agents: string[];
  lastActivity: string;
}

export interface CoverageConfig {
  version: 1;
  updatedAt: string;
  ingested: Array<{ source: string; sessions: number; events: number }>;
  missing: string[];
}

/** 文件系统抽象:插件侧实现(Obsidian adapter 或 Node fs)。 */
export interface VaultAdapter {
  /** 返回路径下的全部子目录名;路径不存在返回空数组。 */
  listDirectories(path: string): Promise<string[]>;
  /** 读取文本文件;不存在返回 null。 */
  readText(path: string): Promise<string | null>;
}

const TASKS_ROOT = "slime-mold/tasks";
const CONFIG_PATH = "slime-mold/sm-config.json";

/**
 * 扫描 vault 内 slime-mold/tasks/,汇总任务菌落 + 溯源明细。
 * 全部只读;条目按时间倒序返回。
 */
export async function scanTasks(adapter: VaultAdapter): Promise<TaskSummary[]> {
  const taskDirs = await adapter.listDirectories(TASKS_ROOT);
  const summaries: TaskSummary[] = [];

  for (const taskId of taskDirs) {
    const base = `${TASKS_ROOT}/${taskId}`;
    const metadata = await readJson<TaskMetadata>(adapter, `${base}/task.json`);
    if (metadata === null) continue;

    const state = (await adapter.readText(`${base}/state.md`)) ?? "";
    const entries = await readEntries(adapter, `${base}/log/entries.jsonl`);

    summaries.push({
      metadata,
      state,
      entries,
      entryCount: entries.length,
      agents: [...new Set(entries.map((entry) => entry.agent))],
      lastActivity:
        entries
          .map((entry) => entry.timestamp)
          .sort()
          .at(-1) ?? metadata.id,
    });
  }

  return summaries.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

/** 读取覆盖诚实配置;不存在返回 null。 */
export async function readCoverage(adapter: VaultAdapter): Promise<CoverageConfig | null> {
  return readJson<CoverageConfig>(adapter, CONFIG_PATH);
}

async function readEntries(adapter: VaultAdapter, path: string): Promise<MemoryEntry[]> {
  const text = await adapter.readText(path);
  if (text === null) return [];
  const entries: MemoryEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed) as MemoryEntry & { schema_version?: number };
      const { schema_version: _schema, ...entry } = parsed;
      if (isMemoryEntry(entry)) entries.push(entry);
    } catch {
      // 忽略坏行(与存储层容错一致)
    }
  }
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

async function readJson<T>(adapter: VaultAdapter, path: string): Promise<T | null> {
  const text = await adapter.readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.task_id === "string" &&
    typeof entry.summary === "string" &&
    typeof entry.timestamp === "string"
  );
}
