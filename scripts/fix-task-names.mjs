/**
 * 存量数据修复:清理任务名中的零宽字符与不可见格式字符。
 *
 * 历史摄入时任务名可能包含零宽文本(U+200B/200C/200D/2060/FEFF 等),
 * 作为任务名毫无意义且难以阅读。本脚本就地清理 task.json 的 name,
 * 不改动 log/entries.jsonl(记忆内容不变,幂等键不受影响)。
 *
 * 用法:
 *   node scripts/fix-task-names.mjs --vault <vault-root>
 */
import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TASK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripZeroWidth(value) {
  // 零宽字符 + 不可见格式字符 + 双向文本控制符
  return value.replace(/[\u200B-\u200F\u2060-\u206F\uFEFF\u00AD\u034F\u180E\u202A-\u202E]/gu, "");
}

async function fixTaskNames(vaultRoot) {
  const tasksRoot = join(vaultRoot, "slime-mold", "tasks");
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  const taskDirs = entries
    .filter((entry) => entry.isDirectory() && TASK_ID_RE.test(entry.name))
    .map((entry) => entry.name);

  let fixed = 0;
  const report = [];

  for (const taskId of taskDirs) {
    const metadataPath = join(tasksRoot, taskId, "task.json");
    let metadata;
    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch {
      continue;
    }
    if (typeof metadata.name !== "string") continue;

    const cleaned = stripZeroWidth(metadata.name).replace(/\s+/g, " ").trim();
    if (cleaned === metadata.name) continue;

    const oldName = metadata.name;
    const newName = cleaned.length === 0 ? `untitled-${taskId.slice(0, 8)}` : cleaned;

    // 原子写入:临时文件 + rename
    const temporary = `${metadataPath}.${Date.now().toString(36)}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ ...metadata, name: newName }, null, 2)}\n`, "utf8");
    await rename(temporary, metadataPath);

    fixed += 1;
    report.push({ taskId, oldName: oldName.slice(0, 40), newName: newName.slice(0, 40) });
  }

  return { total: taskDirs.length, fixed, report };
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
    console.error("[fix-task-names] 必须提供 --vault <vault-root>");
    process.exit(2);
  }

  fixTaskNames(resolve(args.vault))
    .then((result) => {
      console.log(`[fix-task-names] 共 ${result.total} 任务,修复 ${result.fixed} 个`);
      for (const item of result.report.slice(0, 20)) {
        console.log(`  ${item.taskId.slice(0, 8)} "${item.oldName}" → "${item.newName}"`);
      }
      if (result.report.length > 20) {
        console.log(`  ...等共 ${result.report.length} 个`);
      }
    })
    .catch((error) => {
      console.error("[fix-task-names] 失败");
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}

export { fixTaskNames, stripZeroWidth };
