# DeepSlime 开发看板

> 主会话维护。每波结束更新。状态:✅ 完成 / ⚠️ 待审查 / ❌ 失败 / 🔄 进行中 / ⏳ 待启动

## 波 1(2026-08-17,并行 4 会话)

| 模块 | 内容 | 目录 | 状态 | 备注 |
|---|---|---|---|---|
| W1 存储层 | append-only 日志 + state.md + 原子替换 + 崩溃恢复 + 幂等 | src/store/ + task-store.ts | 🔄 进行中 | 测试已写,实现中 |
| W2 校验器 | payload_ref 安全 + 严格校验 + schema_version | src/validate/ | ✅ 验收通过 | 测试 8/8,含符号链接逃逸防护 |
| W3 测试夹具 | 场景一跨会话周报恢复 + 语料生成器 | tests/ | ✅ 已落盘,⚠️ 待验收 | typecheck 通过,含 Provenance 断言 |
| W4 Provenance | 服务端来源注入(修 Critical 1) | src/prov/ | ✅ 验收通过 | 测试 3/3,伪造字段拒绝+fact 直写拒绝 |

**抽查结论(主会话)**:W2/W3/W4 质量合格,接口经 CONTRACT 对齐互相咬合。W1 完成后全量验收。

## 波 2(2026-08-17,并行 3 会话)

| 模块 | 内容 | 目录 | 状态 | 备注 |
|---|---|---|---|---|
| W5 MCP 工具层 | 4 工具串联校验+provenance+存储 | src/mcp/ | ✅ 验收通过 | 测试 21/21 全量通过 |
| W6 集成验证 | 端到端闭环脚本 | scripts/verify.mjs | ✅ 验收通过 | `npm run verify` 跑通最小闭环 |
| W7 交叉审查 | 独立审 W1 存储层 | codex-reports/w7-review.md | ✅ 完成 | **结论:不可合并**(3C+2M+1m,全部成立) |

**里程碑:🏁 P0 最小闭环验收门达成**(create→open→record→checkpoint→close→reopen→resume 全链路通过)

## R1 修复轮(2026-08-17)

| 缺陷 | 严重度 | 状态 | 备注 |
|---|---|---|---|
| C1 截断尾日志固化损坏 | critical | 🔄 修复中 | pwsh-30 |
| C2 锁键路径别名 | critical | 🔄 修复中 | 同上 |
| C3 存储层无可信边界 | critical | 🔄 修复中 | 签名变化牵连 W5 |
| M1 无 fsync 持久化屏障 | major | 🔄 修复中 | 同上 |
| M2 重放只验 schema_version | major | 🔄 修复中 | 同上 |
| m1 O(n²) I/O | minor | ⏳ P1 | 不阻塞 |

**R1 结论:5/5 缺陷修复,28/28 测试通过,verify 绿,已合并推送。**

## 波 3(2026-08-17,自主推进)

| 模块 | 内容 | 目录 | 状态 |
|---|---|---|---|
| W8 open 创建语义 | open 支持不存在任务时创建(场景一"会话 A 创建"缺口) | src/task-store.ts + store/ | ✅ 已合并 |
| W9 指标评测 | 接续时间/误加载率/重回成功率评测脚本 | scripts/bench.mjs | ✅ 已合并 |

**波 3 指标结果(SPEC 7):**
- 误加载率:0/6 = **0%**(目标 <5%)✅
- 重回成功率:3/3 = **100%**(目标 >90%)✅
- 记忆上下文:无记忆 ~10 tokens vs 有记忆 ~1014 tokens(存储层差异 1.003×)
- 注:P0 为存储层测量,端到端指标待 P1 接 agent 后测

## P0 里程碑(全部达成)

| 验收门(SPEC 8.4) | 状态 |
|---|---|
| 最小闭环(open→record→checkpoint→close→reopen) | ✅ npm run verify 绿 |
| 崩溃恢复/幂等/路径安全(3 critical + 2 major) | ✅ R1 修复,28 测试 |
| open 创建语义(场景一) | ✅ W8 |
| 三项评测指标 | ✅ W9(0%/100%) |

## 波 3(待启动)

| 模块 | 内容 | 状态 |
|---|---|---|
| open 创建语义 | open 支持不存在任务时创建(场景一"会话 A 创建"缺口) | ⏳ |
| 指标评测 | 接续时间/误加载率/重回成功率 | ⏳ |

## 波 4(2026-08-17,摄入管线 + Obsidian 面板)

| 模块 | 内容 | 目录 | 状态 |
|---|---|---|---|
| R2 Obsidian 面板方案 | 溯源面板研究报告(SPEC 6.1/6.2 验收) | codex-reports/r2-obsidian-panel.md | ✅ 已落盘 |
| I1 归一化模型 | 三源共同中间格式 IngestSession/IngestEvent | src/ingest/types.ts | ✅ 验收通过 |
| I2 会话→任务聚合 | 标题种子+归一化+高光提取+信号排序 | src/ingest/aggregate.ts | ✅ 验收通过 |
| I3 TaskStore 写入 | open 创建+record 写入+自持幂等清单 | src/ingest/writer.ts | ✅ 验收通过 |
| I4 管线主流程 | 三源解析→聚合→写入→sm-config 覆盖诚实区 | src/ingest/index.ts | ✅ 验收通过 |
| I5 Codex 解析器 | 流式 JSONL + event_msg/response_item + developer 过滤 | src/ingest/parsers/codex.ts | ✅ 验收通过 |
| I6 DSH 解析器 | zstd 解码(fzstd)+ DSH 事件流格式 | src/ingest/parsers/dsh.ts | ✅ 验收通过 |
| I7 Edge 解析器 | SQLite 只读(node:sqlite)+ bigint 时间戳 + 浏览会话切分 | src/ingest/parsers/edge.ts | ✅ 验收通过 |
| I8 CLI 入口 | scripts/ingest.mjs | scripts/ingest.mjs | ✅ 验收通过 |
| I9 测试 | 聚合 6 例 + 管线端到端 2 例 | src/ingest/__tests__/ | ✅ 40/40 全绿 |
| O1 Obsidian 插件骨架 | manifest/main/view/store-reader/构建配置 | obsidian/slime-mold-panel/ | ✅ 已写,构建待 Obsidian 环境 |

**波 4 真实数据验证(2026-08-17):**

| 数据源 | 位置 | 会话 | 事件 |
|---|---|---|---|
| Codex | C:\Users\Huawei\.codex\sessions | 98 | 66,718 |
| DSH | C:\Users\Huawei\.dsh\sessions\--D-Deepseek~0020Harness-- | 7 | 4,849 |
| Edge | ...\Edge\User Data\Default\History | 139 浏览会话 | 5,279 |

- 聚合 66 个任务候选 → 写入 vault(D:\Deepseek Harness\slime-mold\vault\slime-mold\tasks)
- 幂等验证:同 key 重跑,14886 条跳过,仅增量写入
- 覆盖诚实区:sm-config.json 正确列出已接入/未接入(ChatGPT/Cursor 待提供)
- 真实数据发现并修复:Codex 3GB 超大文件(流式读取)、event_msg 消息格式、developer 角色过滤、DSH 事件流真实结构、Edge Chromium 时间戳 bigint 溢出

**里程碑:🏁 摄入管线端到端跑通(三源 → 聚合 → TaskStore → 覆盖诚实区 → Obsidian 面板数据就绪)**

**环境状态:✅ 已恢复(pwsh/glob/grep 正常);@types/node 已安装;40/40 测试 + verify 全绿。**
| I8 CLI 入口 | scripts/ingest.mjs | scripts/ingest.mjs | ✅ 已写 |
| I9 测试 | 聚合 6 例 + 管线端到端 2 例 | src/ingest/__tests__/ | ⚠️ 待跑 |

**环境状态:⚠️ pwsh/glob/grep 全部崩溃(0xC0000142),typecheck/测试待环境恢复后执行。**
**数据源位置:Edge History 已确认(C:\Users\Huawei\AppData\Local\Microsoft\Edge\User Data\Default\History);Codex 会话目录已确认(C:\Users\Huawei\.codex\sessions,格式待环境恢复后校验);DSH 会话位置未确认(用户也未确定,待导出后指定)。**
**已补充:Obsidian 插件骨架 obsidian/slime-mold-panel/(manifest/main/view/store-reader/构建配置)。**

## 波 5(2026-08-18,加载协议 + 数据质量)

| 模块 | 内容 | 目录 | 状态 |
|---|---|---|---|
| L1 任务清单 | list-tasks.mjs(新会话第一入口) | scripts/list-tasks.mjs | ✅ 验收通过 |
| L2 记忆加载 | load-task.mjs(两级加载:brief 摘要/完整接续简报+溯源) | scripts/load-task.mjs | ✅ 验收通过 |
| L3 随时记录 | record-note.mjs(provenance 服务端注入) | scripts/record-note.mjs | ✅ 验收通过 |
| F1 溯源修正 | 条目 agent/session_id 按来源注入(Codex→claude-code,DSH→dsh) | src/ingest/writer.ts | ✅ 验收通过 |
| F2 任务名清理 | 剥离零宽字符/双向控制符(U+200B-200F/2060-206F/202A-202E/FEFF) | aggregate.ts + fix-task-names.mjs | ✅ 19+17 存量修复,0 残留 |
| F3 图谱生成 | emit-graph.mjs(任务/agent/主题 wikilink 节点,可重建) | scripts/emit-graph.mjs | ✅ 可用(Obsidian 可选) |
| O2 面板样式 | Obsidian 面板美化(主题适配徽章/卡片) | obsidian/slime-mold-panel/ | ✅ 已部署 |

**波 5 结论:** 用户确认**不需要 Obsidian**,核心诉求是"任何新会话随时加载任务记忆接续"。加载协议三脚本真实 vault 验证通过:
`list-tasks → load-task(--brief/完整) → record-note` 闭环跑通。数据质量修复:agent 溯源正确(Codex 11,301 条 claude-code + DSH 1,013 条)、任务名零宽字符 0 残留。

**里程碑:🏁 加载协议落地——会话可弃,记忆永存(新会话一条命令接上过往)**
