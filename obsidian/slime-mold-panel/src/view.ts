import { ItemView, WorkspaceLeaf } from "obsidian";
import {
  readCoverage,
  scanTasks,
  type CoverageConfig,
  type MemoryEntry,
  type TaskSummary,
  type VaultAdapter,
} from "./store-reader";

export const VIEW_TYPE = "slime-mold-panel";

/** Obsidian Vault adapter 实现:把 vault 内路径映射到 adapter。 */
function createVaultAdapter(vault: import("obsidian").Vault): VaultAdapter {
  return {
    async listDirectories(path) {
      const items = vault.adapter.list ? await vault.adapter.list(path) : { files: [], folders: [] };
      return items.folders.map((folder) => folder.split("/").at(-1) ?? folder);
    },
    async readText(path) {
      try {
        return await vault.adapter.read(path);
      } catch {
        return null;
      }
    },
  };
}

const AGENT_LABELS: Record<string, string> = {
  "claude-code": "Claude",
  dsh: "DSH",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
};

const TYPE_LABELS: Record<string, string> = {
  decision: "决策",
  artifact: "产物",
  observation: "观察",
  question: "提问",
  fact: "事实",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function confidenceLabel(confidence: string): string {
  return CONFIDENCE_LABELS[confidence] ?? confidence;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export class SlimeMoldPanelView extends ItemView {
  private readonly vaultAdapter: VaultAdapter;

  constructor(leaf: WorkspaceLeaf, vault: import("obsidian").Vault) {
    super(leaf);
    this.vaultAdapter = createVaultAdapter(vault);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "黏菌 · 溯源面板";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("slime-mold-panel");

    await this.render(container);
  }

  async onClose(): Promise<void> {
    // 无清理需求
  }

  private async render(container: HTMLElement): Promise<void> {
    container.empty();

    // 顶栏:标题 + 刷新
    const header = container.createDiv({ cls: "sm-header" });
    const title = header.createDiv({ cls: "sm-title" });
    title.createEl("h2", { text: "黏菌 · 溯源面板" });
    const subtitle = title.createEl("div", { cls: "sm-subtitle" });
    subtitle.setText("会话可弃,记忆永存");

    const refreshButton = header.createEl("button", {
      cls: "sm-refresh",
      text: "↻ 刷新",
    });
    refreshButton.addEventListener("click", () => this.render(container));

    try {
      const [tasks, coverage] = await Promise.all([
        scanTasks(this.vaultAdapter),
        readCoverage(this.vaultAdapter),
      ]);

      this.renderCoverage(container, coverage);
      this.renderTaskList(container, tasks);
    } catch (error) {
      container.createEl("div", {
        cls: "sm-error",
        text: `读取失败:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private renderCoverage(container: HTMLElement, coverage: CoverageConfig | null): void {
    const section = container.createDiv({ cls: "sm-coverage" });

    if (coverage === null) {
      section.createDiv({ cls: "sm-coverage-note", text: "未找到 sm-config.json(摄入管线尚未运行)" });
      return;
    }

    const row = section.createDiv({ cls: "sm-coverage-row" });

    const ingestedBlock = row.createDiv({ cls: "sm-coverage-block" });
    ingestedBlock.createDiv({ cls: "sm-coverage-label", text: "已接入" });
    const ingestedPills = ingestedBlock.createDiv({ cls: "sm-pills" });
    for (const item of coverage.ingested) {
      const pill = ingestedPills.createSpan({ cls: `sm-pill sm-pill-ingested sm-source-${item.source}` });
      pill.setText(`${item.source} · ${item.sessions} 会话 / ${item.events} 事件`);
    }
    if (coverage.ingested.length === 0) {
      ingestedPills.createSpan({ cls: "sm-coverage-note", text: "无" });
    }

    const missingBlock = row.createDiv({ cls: "sm-coverage-block" });
    missingBlock.createDiv({ cls: "sm-coverage-label", text: "未接入" });
    const missingPills = missingBlock.createDiv({ cls: "sm-pills" });
    for (const item of coverage.missing) {
      missingPills.createSpan({ cls: "sm-pill sm-pill-missing", text: item });
    }
    if (coverage.missing.length === 0) {
      missingPills.createSpan({ cls: "sm-coverage-note", text: "无" });
    }

    const updated = section.createDiv({ cls: "sm-coverage-updated" });
    updated.setText(`更新于 ${formatTime(coverage.updatedAt)}`);
  }

  private renderTaskList(container: HTMLElement, tasks: TaskSummary[]): void {
    const section = container.createDiv({ cls: "sm-task-list" });

    const listHeader = section.createDiv({ cls: "sm-list-header" });
    listHeader.createEl("h3", { text: "任务菌落" });
    const count = listHeader.createSpan({ cls: "sm-count", text: `${tasks.length}` });

    if (tasks.length === 0) {
      section.createDiv({ cls: "sm-empty", text: "暂无任务" });
      return;
    }

    for (const task of tasks) {
      const card = section.createEl("details", { cls: "sm-task-card" });

      const summary = card.createEl("summary", { cls: "sm-task-summary" });
      const nameWrap = summary.createDiv({ cls: "sm-task-name-wrap" });
      nameWrap.createDiv({ cls: "sm-task-name", text: task.metadata.name });
      const meta = nameWrap.createDiv({ cls: "sm-task-meta" });

      const status = meta.createSpan({
        cls: `sm-badge sm-status-${task.metadata.status}`,
        text: task.metadata.status === "active" ? "活跃" : "休眠",
      });
      void status;

      const entryCount = meta.createSpan({
        cls: "sm-badge sm-badge-plain",
        text: `${task.entryCount} 条记忆`,
      });
      void entryCount;

      for (const agent of task.agents) {
        const agentBadge = meta.createSpan({
          cls: `sm-badge sm-agent sm-agent-${agent}`,
          text: agentLabel(agent),
        });
        void agentBadge;
      }

      if (task.lastActivity && task.lastActivity !== task.metadata.id) {
        const time = meta.createSpan({
          cls: "sm-task-time",
          text: formatTime(task.lastActivity),
        });
        void time;
      }

      const body = card.createDiv({ cls: "sm-task-body" });

      const state = task.state.trim();
      if (state.length > 0) {
        const stateBlock = body.createDiv({ cls: "sm-state" });
        stateBlock.createDiv({ cls: "sm-state-label", text: "接续简报" });
        const stateText = stateBlock.createEl("pre", { cls: "sm-state-content" });
        stateText.setText(state.slice(0, 800));
      }

      const entryList = body.createEl("ul", { cls: "sm-entries" });
      for (const entry of task.entries.slice(0, 200)) {
        entryList.createEl("li", {}, (li) => {
          li.addClass("sm-entry");

          const entryHeader = li.createDiv({ cls: "sm-entry-header" });
          entryHeader.createSpan({
            cls: `sm-badge sm-agent sm-agent-${entry.agent}`,
            text: agentLabel(entry.agent),
          });
          entryHeader.createSpan({
            cls: `sm-badge sm-type sm-type-${entry.type}`,
            text: typeLabel(entry.type),
          });
          entryHeader.createSpan({
            cls: `sm-badge sm-conf sm-conf-${entry.confidence}`,
            text: confidenceLabel(entry.confidence),
          });
          if (entry.layer === "fact") {
            entryHeader.createSpan({ cls: "sm-badge sm-layer-fact", text: "事实" });
          }
          const entryTime = entryHeader.createSpan({ cls: "sm-entry-time", text: formatTime(entry.timestamp) });

          const entrySummary = li.createDiv({ cls: "sm-entry-summary", text: entry.summary });

          const entryMeta = li.createDiv({ cls: "sm-entry-meta" });
          entryMeta.setText(`会话 ${entry.session_id}`);
          if (entry.payload_ref) {
            entryMeta.createSpan({ text: " · " });
            entryMeta.createSpan({ cls: "sm-payload", text: `产物 ${entry.payload_ref}` });
          }
          void entryTime;
        });
      }
    }
  }
}

/** 供测试引用的纯函数。 */
export function formatEntry(entry: MemoryEntry): string {
  return `[${entry.agent}] ${entry.type}/${entry.confidence} ${formatTime(entry.timestamp)}: ${entry.summary}`;
}
