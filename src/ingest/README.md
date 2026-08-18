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
| Codex | `C:\Users\Huawei\.codex\sessions` | 按日期分目录的 .jsonl |
| DSH | 项目内 `sessions/`(待确认) | zstd 压缩的 JSONL |
| Edge | `C:\Users\Huawei\AppData\Local\Microsoft\Edge\User Data\Default\History` | SQLite(Chromium 标准表) |

## 输出

- TaskStore:vault `slime-mold/tasks/<task-id>/{task.json,state.md,log/entries.jsonl}`
- 覆盖诚实区:vault `slime-mold/sm-config.json`(SPEC 6.2,面板只读展示)
- 幂等清单:vault `slime-mold/ingest-state.json`(管线内部)

## 设计决策

1. **聚合不做语义分类**(SPEC 1.2 红线:不展示"自动分类"为卖点)——只按标题归一化分组;
2. **幂等由管线自持清单保证**,不依赖存储层 id 幂等(存储层 id 由服务端生成,客户端无法控制);
3. **Edge 浏览历史没有 agent 归属**,IngestSession.agent 可空,写入时由管线注入 agent;
4. **单源失败不中断整条管线**(optional 语义),错误计入结果报告;
5. 每条记忆写入 draft 层(P0 契约),layer=fact 需用户确认后晋升(未实现)。

## 测试

```bash
npm test
```

`src/ingest/__tests__/` 下:聚合 6 例 + 管线端到端 2 例。
DSH zstd 解码的端到端验证需真实数据(测试用未压缩回退路径)。

## 当前状态(2026-08-17)

- ✅ R2 Obsidian 面板方案落盘(`codex-reports/r2-obsidian-panel.md`)
- ✅ 代码全部落盘(解析器/聚合/写入/CLI/测试)
- ⚠️ 待环境恢复后跑 typecheck + 测试
- ⚠️ DSH 会话目录名待确认;Codex sessions 目录结构待确认
