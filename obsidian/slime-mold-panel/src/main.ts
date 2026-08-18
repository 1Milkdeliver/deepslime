import { Plugin, WorkspaceLeaf } from "obsidian";
import { SlimeMoldPanelView, VIEW_TYPE } from "./view";

export default class SlimeMoldPanelPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new SlimeMoldPanelView(leaf, this.app.vault),
    );

    this.addRibbonIcon("network", "打开黏菌溯源面板", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-slime-mold-panel",
      name: "打开黏菌溯源面板",
      callback: () => this.activateView(),
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf === undefined) {
      leaf = workspace.getRightLeaf(false);
      if (leaf === null) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}
