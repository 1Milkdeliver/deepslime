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

    const heading = container.createEl("h2", { text: "黏菌 · 溯源面板" });
    heading.addClass("sm-panel-heading");

    const refreshButton = container.createEl("button", { text: "刷新" });
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
        text: `读取失败:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private renderCoverage(container: HTMLElement, coverage: CoverageConfig | null): void {
    const section = container.createEl("section");
    section.addClass("sm-coverage");

    section.createEl("h3", { text: "数据覆盖" });

    if (coverage === null) {
      section.createEl("div", { text: "未找到 sm-config.json(摄入管线尚未运行)" });
      return;
    }

    const ingested = coverage.ingested
      .map((item) => `${item.source}(${item.sessions} 会话 / ${item.events} 事件)`)
      .join(" · ");
    section.createEl("div", {
      text: `已接入:${ingested || "无"}`,
    });

    const missing = coverage.missing.join("、");
    section.createEl("div", {
      text: `未接入:${missing || "无"}`,
    });
    section.createEl("div", {
      text: `更新于:${coverage.updatedAt}`,
    });
  }

  private renderTaskList(container: HTMLElement, tasks: TaskSummary[]): void {
    const section = container.createEl("section");
    section.addClass("sm-task-list");
    section.createEl("h3", { text: `任务菌落(${tasks.length})` });

    if (tasks.length === 0) {
      section.createEl("div", { text: "暂无任务" });
      return;
    }

    for (const task of tasks) {
      const card = section.createEl("details");
      card.addClass("sm-task-card");

      const summary = card.createEl("summary");
      summary.createEl("strong", { text: task.metadata.name });
      summary.createEl(
        "span",
        { text: ` · ${task.metadata.status} · ${task.entryCount} 条 · ${task.agents.join("/") || "无 agent"}` },
      );

      const body = card.createEl("div");
      body.addClass("sm-task-body");

      const state = task.state.trim();
      if (state.length > 0) {
        const stateBlock = body.createEl("pre");
        stateBlock.addClass("sm-state");
        stateBlock.setText(state.slice(0, 500));
      }

      const entryList = body.createEl("ul");
      entryList.addClass("sm-entries");
      for (const entry of task.entries.slice(0, 200)) {
        entryList.createEl("li", {}, (li) => {
          li.addClass("sm-entry");
          li.addClass(`sm-entry-${entry.layer}`);
          li.createEl("div", {
            text: `[${entry.agent}] ${entry.type} · ${entry.confidence} · ${formatTime(entry.timestamp)}`,
          });
          li.createEl("div", { text: entry.summary });
          li.createEl("div", {
            text: `会话:${entry.session_id}${entry.payload_ref ? ` · 产物:${entry.payload_ref}` : ""}`,
          });
        });
      }
    }
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** 供测试引用的纯函数。 */
export function formatEntry(entry: MemoryEntry): string {
  return `[${entry.agent}] ${entry.type}/${entry.confidence} ${formatTime(entry.timestamp)}: ${entry.summary}`;
}
