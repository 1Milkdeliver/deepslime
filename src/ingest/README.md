# 摄入管线(Ingest Pipeline)

把异构 agent 会话数据解析、聚合为"会话→任务",写入 TaskStore,供 Obsidian 溯源面板展示。

```
Codex JSONL ──┐
DSH zstd ────┼→ 解析器 → 会话→任务聚合 → TaskStore → Obsidian 面板
Edge SQLite ─┘
```

## 架构

| 模块 | 文件 | 职责 |
|---|---|---|
| 归一化模型 | `src/ingest/types.ts` | IngestSession/IngestEvent 三源共同中间格式 |
| 聚合器 | `src/ingest/aggregate.ts` | 标题种子 + 归一化分组 + 高光提取 + 信号排序 |
| TaskStore 写入 | `src/ingest/writer.ts` | open 创建 + record 写入 + 自持幂等清单 |
| 管线主流程 | `src/ingest/index.ts` | 三源解析 → 聚合 → 写入 → sm-config 覆盖诚实区 |
| Codex 解析器 | `src/ingest/parsers/codex.ts` | JSONL 容错解析(新旧结构) |
| DSH 解析器 | `src/ingest/parsers/dsh.ts` | zstd 解码(fzstd)+ JSONL/单对象 |
| Edge 解析器 | `src/ingest/parsers/edge.ts` | SQLite 只读 + Chromium 时间戳 + 浏览会话切分 |
| CLI | `scripts/ingest.mjs` | 命令行入口 |

## 运行

```bash
# 先编译 TS 到 .test-dist
npm run pretest

# 摄入(可只提供部分源,缺省源计入覆盖诚实区 missing)
node scripts/ingest.mjs \
  --vault <vault-root> \
  --codex "C:/Users/Huawei/.codex/sessions" \
  --dsh "<project>/<dsh-sessions-dir>" \
  --edge "<Edge User Data>/Default/History" \
  --agent dsh \
  --session "ingest-2026-08-17" \
  --key "ingest-2026-08-17"
```

幂等:`--key` 相同则重复运行不产生重复条目(由 `slime-mold/ingest-state.json` 清单保证)。

## 数据源

| 源 | 位置(P0 目标) | 格式 |
|---|---|---|
| Codex | `C:\Users\Huawei\.codex\sessions` | 按日期分目录的 .jsonl(流式读取,支持 >2GiB) |
| DSH | `C:\Users\Huawei\.dsh\sessions\<workspace>\<session-id>\session.jsonl.zstd` | zstd 压缩的 JSONL 事件流(fzstd 解码) |
| Edge | `C:\Users\Huawei\AppData\Local\Microsoft\Edge\User Data\Default\History` | SQLite(node:sqlite 只读,Chromium 标准表) |

## 输出

- TaskStore:vault `slime-mold/tasks/<task-id>/{task.json,state.md,log/entries.jsonl}`
- 覆盖诚实区:vault `slime-mold/sm-config.json`(SPEC 6.2,面板只读展示)
- 幂等清单:vault `slime-mold/ingest-state.json`(管线内部)

## 加载协议(新会话随时接续,SPEC 5.5)

**无需 Obsidian,三个 CLI 脚本即可在任何会话中加载/记录任务记忆:**

```bash
# 1. 新会话第一步:看有哪些任务(只列清单,不加载内容)
node scripts/list-tasks.mjs --vault <vault-root> [--limit 30]

# 2. 选择任务后加载记忆(两级加载)
node scripts/load-task.mjs --vault <vault-root> --name "<任务名>"   # 完整:接续简报 + 最近 20 条
node scripts/load-task.mjs --vault <vault-root> --name "<任务名>" --brief  # 摘要(几十 token)
node scripts/load-task.mjs --vault <vault-root> --id <uuid>         # 按明确 id 加载

# 3. 会话中随时记录一条记忆(provenance 由 TaskStore 服务端注入)
node scripts/record-note.mjs \
  --vault <vault-root> --name "<任务名>" \
  --agent dsh --session "<会话id>" \
  --type observation --summary "<一句话摘要>" [--confidence medium]
```

**加载语义(P0,与 MCP open 一致):** 按明确名称或 id 加载,不自动召回相似任务(SPEC 5.5 的意图检测是 P1)。brief 模式只给摘要,展开细节需显式加载——两级加载 + 可见加载,防误加载。

## 设计决策

1. **聚合不做语义分类**(SPEC 1.2 红线:不展示"自动分类"为卖点)——只按标题归一化分组;
2. **幂等由管线自持清单保证**,不依赖存储层 id 幂等(存储层 id 由服务端生成,客户端无法控制);
3. **Edge 浏览历史没有 agent 归属**,IngestSession.agent 可空,写入时由管线注入 agent;
4. **单源失败不中断整条管线**(optional 语义),错误计入结果报告;
5. 每条记忆写入 draft 层(P0 契约),layer=fact 需用户确认后晋升(未实现);
6. **溯源按来源注入**:条目 agent/session_id 来自源会话(Codex→claude-code,DSH→dsh),options 仅兜底;
7. **任务名剥离零宽字符**(U+200B-200F/2060-206F/202A-202E/FEFF 等),防隐藏文本污染任务名。

## 测试

```bash
npm test
```

`src/ingest/__tests__/` 下:聚合 6 例 + 管线端到端 2 例。
DSH zstd 解码的端到端验证需真实数据(测试用未压缩回退路径)。

## 当前状态(2026-08-18)

- ✅ 三源摄入端到端:Codex 101 会话 / DSH 10 会话 / Edge 139 浏览会话 → vault(67 任务)
- ✅ 加载协议三脚本(list/load/record)真实数据验证通过
- ✅ 溯源按来源注入 + 任务名零宽字符清理
- ✅ 40/40 测试 + verify 绿,已推送 GitHub
