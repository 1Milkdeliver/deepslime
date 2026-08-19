/**
 * 会话中随时记录一条记忆(record 协议)。
 *
 * 走 TaskStore.record:服务端注入 id/agent/session_id/timestamp/confidence,
 * 客户端只提交内容字段(SPEC/CONTRACT provenance 契约)。
 *
 * 用法:
 *   node scripts/record-note.mjs \
 *     --vault <vault-root> \
 *     --name "<任务名>" \
 *     --agent dsh --session "<会话id>" \
 *     --type decision|artifact|observation|question \
 *     --summary "<一句话摘要>" \
 *     [--kind reference|state] [--confidence high|medium|low]
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENTRY_TYPES = new Set(["decision", "artifact", "observation", "question", "fact"]);
const KINDS = new Set(["reference", "state"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);
const AGENTS = new Set(["claude-code", "dsh", "chatgpt", "cursor"]);

function parseArgs(argv) {
  const args = {
    vault: null, name: null, agent: "dsh", session: null,
    type: "observation", kind: "reference", confidence: "medium", summary: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) continue;
    switch (flag) {
      case "--vault": args.vault = value; index += 1; break;
      case "--name": args.name = value; index += 1; break;
      case "--agent": args.agent = value; index += 1; break;
      case "--session": args.session = value; index += 1; break;
      case "--type": args.type = value; index += 1; break;
      case "--kind": args.kind = value; index += 1; break;
      case "--confidence": args.confidence = value; index += 1; break;
      case "--summary": args.summary = value; index += 1; break;
      default:
        console.error(`[record-note] 未知参数: ${flag}`);
        process.exitCode = 2;
        return null;
    }
  }
  return args;
}

function validate(args) {
  const problems = [];
  if (!args.vault) problems.push("--vault 必填");
  if (!args.name) problems.push("--name 必填");
  if (!args.summary || args.summary.trim() === "") problems.push("--summary 必填");
  if (!AGENTS.has(args.agent)) problems.push(`--agent 必须是 ${[...AGENTS].join("/")}`);
  if (!args.session) problems.push("--session 必填");
  if (!ENTRY_TYPES.has(args.type)) problems.push(`--type 必须是 ${[...ENTRY_TYPES].join("/")}`);
  if (!KINDS.has(args.kind)) problems.push(`--kind 必须是 ${[...KINDS].join("/")}`);
  if (!CONFIDENCES.has(args.confidence)) problems.push(`--confidence 必须是 ${[...CONFIDENCES].join("/")}`);
  return problems;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) process.exit(2);

  const problems = validate(args);
  if (problems.length > 0) {
    console.error("[record-note] " + problems.join("; "));
    process.exit(2);
  }

  const { TaskStore } = await import("../.test-dist/task-store.js");

  try {
    const store = new TaskStore(resolve(args.vault));
    const opened = await store.open({ name: args.name });
    const { id } = await store.record(
      {
        agent: args.agent,
        sessionId: args.session,
        taskId: opened.taskId,
        confidence: args.confidence,
      },
      {
        type: args.type,
        layer: "draft",
        kind: args.kind,
        summary: args.summary,
        payload_ref: null,
      },
    );
    console.log(`[record-note] 已记录到任务 "${args.name}" (${opened.taskId}) 条目 ${id}`);
  } catch (error) {
    console.error(`[record-note] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
