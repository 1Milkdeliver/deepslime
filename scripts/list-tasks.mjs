/**
 * 列出所有任务(菌落总览)。
 *
 * 新会话第一入口:不加载任何记忆内容,只给任务清单
 * (名称/状态/条目数/最近活动),供选择要接续的任务。
 *
 * 用法:
 *   node scripts/list-tasks.mjs --vault <vault-root> [--limit 30]
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_LABELS = { "claude-code": "Claude", dsh: "DSH", chatgpt: "ChatGPT", cursor: "Cursor" };

async function listTasks(vaultRoot, limit = 30) {
  const tasksRoot = join(vaultRoot, "slime-mold", "tasks");
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  const taskDirs = entries
    .filter((entry) => entry.isDirectory() && TASK_ID_RE.test(entry.name))
    .map((entry) => entry.name);

  const tasks = [];
  for (const taskId of taskDirs) {
    const base = join(tasksRoot, taskId);
    let metadata;
    try {
      metadata = JSON.parse(await readFile(join(base, "task.json"), "utf8"));
    } catch {
      continue;
    }
    let entryCount = 0;
    let agents = [];
    let lastActivity = "";
    try {
      const logText = await readFile(join(base, "log", "entries.jsonl"), "utf8");
      const agentSet = new Set();
      for (const line of logText.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          entryCount += 1;
          if (entry.agent) agentSet.add(entry.agent);
          if (entry.timestamp && entry.timestamp > lastActivity) lastActivity = entry.timestamp;
        } catch {}
      }
      agents = [...agentSet];
    } catch {}
    tasks.push({
      id: taskId,
      name: metadata.name ?? taskId,
      status: metadata.status ?? "dormant",
      entryCount,
      agents: agents.map((a) => AGENT_LABELS[a] ?? a).join("/") || "—",
      lastActivity,
    });
  }

  tasks.sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
  return limit > 0 ? tasks.slice(0, limit) : tasks;
}

function parseArgs(argv) {
  const args = { vault: null, limit: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--vault") {
      args.vault = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--limit") {
      args.limit = Number(argv[index + 1]) || 0;
      index += 1;
    }
  }
  return args;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.vault) {
    console.error("[list-tasks] 必须提供 --vault <vault-root>");
    process.exit(2);
  }

  listTasks(resolve(args.vault), args.limit)
    .then((tasks) => {
      if (tasks.length === 0) {
        console.log("[list-tasks] 暂无任务(先运行 scripts/ingest.mjs 摄入,或 open 创建)");
        return;
      }
      console.log(`[list-tasks] 共 ${tasks.length} 个任务(按最近活动排序):`);
      console.log("");
      tasks.forEach((task, index) => {
        const status = task.status === "active" ? "活跃" : "休眠";
        console.log(
          `${String(index + 1).padStart(2)}. [${status}] ${task.name}  · ${task.entryCount} 条 · ${task.agents} · ${task.lastActivity || "无时间"}`,
        );
        console.log(`     id: ${task.id}`);
      });
      console.log("");
      console.log("接续: node scripts/load-task.mjs --vault <vault-root> --name \"<任务名>\"");
    })
    .catch((error) => {
      console.error("[list-tasks] 失败");
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}

export { listTasks };
