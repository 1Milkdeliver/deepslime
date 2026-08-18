import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 摄入管线 CLI 入口。
 *
 * 用法:
 *   node scripts/ingest.mjs \
 *     --vault <vault-root> \
 *     --codex <codex-sessions-dir> \
 *     --dsh <dsh-sessions-dir> \
 *     --edge <edge-history-sqlite> \
 *     [--agent dsh] [--session <id>] [--key <idempotency-key>]
 *
 * 说明:
 * - --agent 默认 dsh;--session 默认 ingest-<时间戳>;--key 默认 session 值;
 * - 未提供的源会被跳过,并记入覆盖诚实区的 missing 清单;
 * - 重复运行同一 --key 是幂等的(同 id 不重复写入)。
 */

function parseArgs(argv) {
  const args = { vault: null, codex: null, dsh: null, edge: null, agent: "dsh", session: null, key: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) continue;
    switch (flag) {
      case "--vault": args.vault = value; index += 1; break;
      case "--codex": args.codex = value; index += 1; break;
      case "--dsh": args.dsh = value; index += 1; break;
      case "--edge": args.edge = value; index += 1; break;
      case "--agent": args.agent = value; index += 1; break;
      case "--session": args.session = value; index += 1; break;
      case "--key": args.key = value; index += 1; break;
      default:
        console.error(`[ingest] 未知参数: ${flag}`);
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
  if (!args.vault) {
    console.error("[ingest] 必须提供 --vault <vault-root>");
    process.exit(2);
  }

  const sessionId = args.session ?? `ingest-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const idempotencyKey = args.key ?? sessionId;

  const sources = [];
  if (args.codex) sources.push({ source: "codex", path: args.codex });
  if (args.dsh) sources.push({ source: "dsh", path: args.dsh });
  if (args.edge) sources.push({ source: "edge", path: args.edge });

  const { runIngest } = await import("../.test-dist/ingest/index.js");

  runIngest({
    vaultRoot: resolve(args.vault),
    sources,
    agent: args.agent,
    sessionId,
    idempotencyKey,
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("[ingest] 失败");
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}
