/**
 * 图谱节点生成器。
 *
 * 把 TaskStore 数据投影为 Obsidian 原生图谱可识别的 markdown 节点 + wikilink:
 * - 每个任务一个节点文件:包含任务名、状态、接续简报摘要、agent 链接;
 * - 每个 agent 一个节点文件:聚合该 agent 的全部任务;
 * - 任务通过"共享 agent"和"共享会话前缀"建立菌落关联;
 * - 输出到 <vault>/菌落/,全部由本脚本可重建(SPEC:存储与 Obsidian 解耦)。
 *
 * 用法:
 *   node scripts/emit-graph.mjs --vault <vault-root>
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const AGENT_LABELS = {
  "claude-code": "Claude Code",
  dsh: "DSH",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
};

const TYPE_LABELS = {
  decision: "决策",
  artifact: "产物",
  observation: "观察",
  question: "提问",
  fact: "事实",
};

/** 从路径段中提取任务 id(uuid 目录名)。 */
const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listTaskDirs(tasksRoot) {
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && TASK_ID_RE.test(entry.name))
    .map((entry) => entry.name);
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readTextIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function parseEntries(jsonl) {
  if (jsonl === null) return [];
  return jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** 生成文件名:任务名清洗后 + 任务 id 前缀,避免重名与非法字符。 */
function taskFileName(taskId, name) {
  const cleaned = (name || "task")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `task-${taskId.slice(0, 8)}-${cleaned}.md`;
}

function agentFileName(agent) {
  return `agent-${agent}.md`;
}

function slugFor(value) {
  return String(value).replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
}

/** 提取"会话主题前缀":session id 里常见的主题词,用于跨任务关联。 */
function sessionTopic(sessionId) {
  // 例如 ingest-2026-08-17、bench-xxx、session-xxx
  const match = String(sessionId).match(/^([a-z-]+?)-[0-9]/i);
  return match ? match[1] : null;
}

async function emitGraph(vaultRoot) {
  const tasksRoot = join(vaultRoot, "slime-mold", "tasks");
  const graphRoot = join(vaultRoot, "菌落");
  await mkdir(graphRoot, { recursive: true });

  const taskDirs = await listTaskDirs(tasksRoot);
  const tasks = [];

  for (const taskId of taskDirs) {
    const base = join(tasksRoot, taskId);
    const metadata = await readJsonIfPresent(join(base, "task.json"));
    if (metadata === null) continue;
    const state = (await readTextIfPresent(join(base, "state.md"))) ?? "";
    const entries = parseEntries(await readTextIfPresent(join(base, "log", "entries.jsonl")));

    const agents = [...new Set(entries.map((entry) => entry.agent).filter(Boolean))];
    const types = [...new Set(entries.map((entry) => entry.type).filter(Boolean))];
    const sessionTopics = [...new Set(entries.map((entry) => sessionTopic(entry.session_id)).filter(Boolean))];

    tasks.push({
      id: taskId,
      name: metadata.name ?? taskId,
      status: metadata.status ?? "dormant",
      state,
      entryCount: entries.length,
      agents,
      types,
      sessionTopics,
      lastActivity: entries.map((e) => e.timestamp).filter(Boolean).sort().at(-1) ?? "",
    });
  }

  // 写任务节点
  const agentMembers = new Map();
  const topicMembers = new Map();
  for (const task of tasks) {
    const fileName = taskFileName(task.id, task.name);
    const agentLinks = task.agents
      .map((agent) => `[[${agentFileName(agent)}|${AGENT_LABELS[agent] ?? agent}]]`)
      .join(" ");
    const topicLinks = task.sessionTopics
      .map((topic) => `[[topic-${slugFor(topic)}|${topic}]]`)
      .join(" ");

    const typeLine = task.types
      .map((type) => `[[type-${type}|${TYPE_LABELS[type] ?? type}]]`)
      .join(" ");

    const statePreview = task.state
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("#"))
      .slice(0, 3)
      .join(" ")
      .slice(0, 200);

    const stateBlock =
      statePreview.length > 0
        ? `\n> [!note] 接续简报\n> ${statePreview}\n`
        : "";

    const content = `# ${task.name}

- 状态:${task.status === "active" ? "活跃" : "休眠"}
- 记忆:${task.entryCount} 条
${task.lastActivity ? `- 最近活动:${task.lastActivity}` : ""}

## 来源 agent
${agentLinks || "—"}

${topicLinks ? `## 会话主题\n${topicLinks}\n` : ""}
${typeLine ? `## 记忆类型\n${typeLine}\n` : ""}
${stateBlock}
`;
    await writeFile(join(graphRoot, fileName), content, "utf8");

    for (const agent of task.agents) {
      const members = agentMembers.get(agent) ?? [];
      members.push({ id: task.id, name: task.name, fileName });
      agentMembers.set(agent, members);
    }
    for (const topic of task.sessionTopics) {
      const members = topicMembers.get(topic) ?? [];
      members.push({ id: task.id, name: task.name, fileName });
      topicMembers.set(topic, members);
    }
  }

  // 写 agent 节点
  for (const [agent, members] of agentMembers) {
    const label = AGENT_LABELS[agent] ?? agent;
    const links = members
      .map((m) => `- [[${m.fileName}|${m.name}]](${m.id})`)
      .join("\n");
    const content = `# ${label}

> agent 菌落:该 agent 参与的任务

${links}
`;
    await writeFile(join(graphRoot, agentFileName(agent)), content, "utf8");
  }

  // 写会话主题节点(跨任务关联:同一主题的会话聚在一起)
  for (const [topic, members] of topicMembers) {
    const links = members
      .map((m) => `- [[${m.fileName}|${m.name}]]`)
      .join("\n");
    const content = `# 会话主题:${topic}

> 多个任务共享该会话前缀,可能是同一工作流的延续

${links}
`;
    await writeFile(join(graphRoot, `topic-${slugFor(topic)}.md`), content, "utf8");
  }

  // 写记忆类型节点
  const allTypes = [...new Set(tasks.flatMap((task) => task.types))];
  for (const type of allTypes) {
    const members = tasks.filter((task) => task.types.includes(type));
    const links = members
      .map((m) => `- [[${taskFileName(m.id, m.name)}|${m.name}]]`)
      .join("\n");
    const content = `# 记忆类型:${TYPE_LABELS[type] ?? type}

${links}
`;
    await writeFile(join(graphRoot, `type-${type}.md`), content, "utf8");
  }

  // 菌落总览
  const overview = `# 任务菌落

> 由 \`scripts/emit-graph.mjs\` 生成,可随时重建。

- 任务:${tasks.length} 个
- agent:${agentMembers.size} 个
- 会话主题:${topicMembers.size} 个

## 全部任务
${tasks
  .map(
    (t) =>
      `- [[${taskFileName(t.id, t.name)}|${t.name}]] · ${t.entryCount} 条 · ${t.agents.map((a) => AGENT_LABELS[a] ?? a).join("/") || "无 agent"}`,
  )
  .join("\n")}
`;
  await writeFile(join(graphRoot, "任务菌落.md"), overview, "utf8");

  return {
    graphRoot,
    tasks: tasks.length,
    agents: agentMembers.size,
    topics: topicMembers.size,
    taskIds: tasks.map((t) => t.id),
  };
}

function parseArgs(argv) {
  const args = { vault: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--vault") {
      args.vault = argv[index + 1];
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
    console.error("[emit-graph] 必须提供 --vault <vault-root>");
    process.exit(2);
  }

  emitGraph(resolve(args.vault))
    .then((result) => {
      console.log(
        `[emit-graph] 生成完成:${result.tasks} 任务 / ${result.agents} agent / ${result.topics} 主题 → ${result.graphRoot}`,
      );
    })
    .catch((error) => {
      console.error("[emit-graph] 失败");
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}

export { emitGraph };
