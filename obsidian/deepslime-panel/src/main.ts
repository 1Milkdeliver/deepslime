import { Plugin, WorkspaceLeaf } from "obsidian";
import { SlimeMoldPanelView, VIEW_TYPE } from "./view";

export default class SlimeMoldPanelPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new SlimeMoldPanelView(leaf, this.app.vault),
    );

    this.addRibbonIcon("network", "打开 DeepSlime 溯源面板", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-deepslime-panel",
      name: "打开 DeepSlime 溯源面板",
      callback: () => this.activateView(),
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing !== undefined) {
      await workspace.revealLeaf(existing);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (leaf === null) return;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }
}
