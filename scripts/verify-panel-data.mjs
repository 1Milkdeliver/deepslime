// 模拟 Obsidian 面板读取真实 vault 数据(与 obsidian store-reader.ts 相同逻辑)
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const VAULT = "D:/Deepseek Harness/deepslime/vault";

const adapter = {
  async listDirectories(path) {
    try {
      const entries = await readdir(join(VAULT, path), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },
  async readText(path) {
    try {
      return await readFile(join(VAULT, path), "utf8");
    } catch {
      return null;
    }
  },
};

async function scan() {
  const taskDirs = await adapter.listDirectories("slime-mold/tasks");
  const summaries = [];
  for (const taskId of taskDirs) {
    const base = `slime-mold/tasks/${taskId}`;
    let meta;
    try {
      meta = JSON.parse(await adapter.readText(`${base}/task.json`));
    } catch {
      continue;
    }
    const text = await adapter.readText(`${base}/log/entries.jsonl`);
    const entries = (text ?? "")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const state = await adapter.readText(`${base}/state.md`);
    summaries.push({
      name: meta.name,
      status: meta.status,
      entryCount: entries.length,
      agents: [...new Set(entries.map((e) => e.agent))],
      lastActivity: entries.map((e) => e.timestamp).sort().at(-1) ?? meta.id,
      statePreview: (state ?? "").slice(0, 80),
    });
  }
  summaries.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
  return summaries;
}

scan()
  .then((tasks) => {
    console.log("=== 面板将显示的任务菌落(前 10,按最近活动排序) ===");
    tasks.slice(0, 10).forEach((t) =>
      console.log(
        `${t.status.padEnd(7)} ${String(t.entryCount).padStart(4)}条 ${t.agents.join("/").padEnd(14)} ${t.name.slice(0, 36)}`,
      ),
    );
    console.log(`...共 ${tasks.length} 个任务`);
    const total = tasks.reduce((s, t) => s + t.entryCount, 0);
    console.log(`记忆条目总计: ${total}`);
  })
  .catch((e) => {
    console.error("ERR", e);
    process.exit(1);
  });
