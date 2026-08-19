/**
 * 加载任务记忆(接续协议,SPEC 5.5)。
 *
 * 两级加载:
 *   --brief   只加载摘要(任务名/状态/条目数/最近活动/最近 3 条)——几十 token;
 *   默认      完整加载:接续简报(state.md)+ 最近 N 条记忆(含溯源)。
 *
 * 新会话接续:
 *   node scripts/list-tasks.mjs --vault <vault-root>          # 看有哪些任务
 *   node scripts/load-task.mjs --vault <vault-root> --name "..."   # 加载记忆
 *
 * 按明确 id 或名称加载,不自动召回相似任务(P0 语义,与 MCP open 一致)。
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_LABELS = { "claude-code": "Claude Code", dsh: "DSH", chatgpt: "ChatGPT", cursor: "Cursor" };
const TYPE_LABELS = { decision: "决策", artifact: "产物", observation: "观察", question: "提问", fact: "事实" };

function agentLabel(agent) {
  return AGENT_LABELS[agent] ?? agent;
}

function typeLabel(type) {
  return TYPE_LABELS[type] ?? type;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString("zh-CN", { hour12: false });
}

async function findTaskDir(tasksRoot, identifier) {
  // id 直接匹配目录名;name 匹配 task.json 的 name
  if (identifier.id !== undefined) {
    if (!TASK_ID_RE.test(identifier.id)) throw new Error(`非法任务 id: ${identifier.id}`);
    const dir = join(tasksRoot, identifier.id);
    try {
      await readFile(join(dir, "task.json"), "utf8");
      return dir;
    } catch {
      throw new Error(`任务不存在: ${identifier.id}`);
    }
  }

  const entries = await readdir(tasksRoot, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !TASK_ID_RE.test(entry.name)) continue;
    try {
      const metadata = JSON.parse(await readFile(join(tasksRoot, entry.name, "task.json"), "utf8"));
      if (metadata.name === identifier.name) matches.push(entry.name);
    } catch {}
  }
  if (matches.length === 0) throw new Error(`任务不存在: ${identifier.name}`);
  if (matches.length > 1) throw new Error(`任务名有歧义,请用 id 加载: ${identifier.name}`);
  return join(tasksRoot, matches[0]);
}

async function loadTask(vaultRoot, identifier, options = {}) {
  const tasksRoot = join(vaultRoot, "slime-mold", "tasks");
  const taskDir = await findTaskDir(tasksRoot, identifier);
  const taskId = taskDir.split(/[\\/]/).at(-1);

  const metadata = JSON.parse(await readFile(join(taskDir, "task.json"), "utf8"));
  let state = "";
  try {
    state = await readFile(join(taskDir, "state.md"), "utf8");
  } catch {}

  const entries = [];
  try {
    const logText = await readFile(join(taskDir, "log", "entries.jsonl"), "utf8");
    for (const line of logText.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {}
    }
  } catch {}

  const recent = entries
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
    .slice(0, options.recent ?? 20);

  return {
    taskId,
    metadata,
    state,
    totalEntries: entries.length,
    recent,
    brief: {
      name: metadata.name,
      status: metadata.status,
      entryCount: entries.length,
      agents: [...new Set(entries.map((e) => e.agent).filter(Boolean))].map(agentLabel).join("/") || "—",
      lastActivity: entries.map((e) => e.timestamp).filter(Boolean).sort().at(-1) ?? "",
      statePreview: state
        .split("\n")
        .filter((line) => line.trim() !== "" && !line.startsWith("#"))
        .slice(0, 3)
        .join(" ")
        .slice(0, 200),
    },
  };
}

function printBrief(result) {
  const b = result.brief;
  console.log(`任务:${b.name} [${b.status === "active" ? "活跃" : "休眠"}]`);
  console.log(`记忆:${b.entryCount} 条 · ${b.agents} · 最近 ${b.lastActivity || "无"}`);
  if (b.statePreview) console.log(`接续:${b.statePreview}`);
}

function printFull(result) {
  console.log(`# ${result.metadata.name}`);
  console.log(`- id:${result.taskId} 状态:${result.metadata.status === "active" ? "活跃" : "休眠"}`);
  console.log(`- 记忆:${result.totalEntries} 条(显示最近 ${result.recent.length} 条)`);
  console.log("");
  if (result.state.trim()) {
    console.log("## 接续简报(state.md)");
    console.log(result.state.trim());
    console.log("");
  }
  if (result.recent.length > 0) {
    console.log("## 最近记忆(溯源)");
    result.recent.forEach((entry, index) => {
      console.log(
        `[${index + 1}] [${agentLabel(entry.agent)}] ${typeLabel(entry.type)} · 置信度${entry.confidence} · ${formatTime(entry.timestamp)}`,
      );
      console.log(`    ${entry.summary}`);
      console.log(`    会话 ${entry.session_id}${entry.payload_ref ? ` · 产物 ${entry.payload_ref}` : ""}`);
    });
  }
}

function parseArgs(argv) {
  const args = { vault: null, id: null, name: null, brief: false, recent: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--vault": args.vault = value; index += 1; break;
      case "--id": args.id = value; index += 1; break;
      case "--name": args.name = value; index += 1; break;
      case "--brief": args.brief = true; break;
      case "--recent": args.recent = Number(value) || 20; index += 1; break;
      default:
        console.error(`[load-task] 未知参数: ${flag}`);
        process.exitCode = 2;
        return null;
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
  if (args === null) process.exit(2);
  if (!args.vault || (!args.id && !args.name)) {
    console.error("[load-task] 必须提供 --vault 与 --id 或 --name");
    process.exit(2);
  }

  const identifier = args.id !== null ? { id: args.id } : { name: args.name };
  loadTask(resolve(args.vault), identifier, { recent: args.recent })
    .then((result) => {
      if (args.brief) printBrief(result);
      else printFull(result);
    })
    .catch((error) => {
      console.error(`[load-task] ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
}

export { loadTask };
