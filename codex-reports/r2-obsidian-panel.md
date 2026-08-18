# R2 研究报告:Obsidian 溯源面板方案

> 阶段:R2(研究)
> 作者:主会话(DSH)
> 状态:✅ 已落盘
> 依据:SPEC.md §5.1(三件套形态)、§5.4(记忆条目 schema)、§6.1(溯源即安全)、CONTRACT.md §2(12 字段 schema)、§3(工具集)
> 前置:P0 存储层已完成(32 测试全绿),摄入管线(Codex/DSH/Edge → TaskStore)进行中

---

## 1. 结论摘要(先说答案)

**Obsidian 溯源面板 = 一个 Obsidian 自建插件 + 纯 markdown 数据契约,零运行时依赖。**

- 面板不读取 TaskStore 的内存状态,只读取 vault 内的纯 markdown/JSON 文件(与 SPEC 5.1"存储与 Obsidian 解耦"一致);
- 溯源数据来源:每任务目录的 `log/entries.jsonl`(12 字段 schema 已含 agent/session/timestamp/type/confidence);
- 插件形态:Obsidian 自定义视图(`ItemView`)+ 边栏图标,渲染"任务菌落 + 溯源明细";
- P0 阶段不做图谱交互,只做**只读溯源面板**;图谱视图留给 Obsidian 原生 graph view 免费能力(SPEC 5.1 已声明)。

**关键决策:面板数据由"摄入管线产物"驱动,而非实时 hook 存储层。**

| 决策点 | 选择 | 理由 |
|---|---|---|
| 数据来源 | vault 文件(entries.jsonl + task.json + state.md) | 解耦、可审计、崩溃安全 |
| 渲染方式 | Obsidian ItemView 插件 | 自建最小 UI,图谱用原生能力 |
| 溯源粒度 | 记忆条目级(每条 12 字段) | SPEC 6.1 要求"能指出任一记忆条目来源" |
| 更新机制 | 手动刷新 + vault 文件监听(可选) | P0 保持简单,不做实时推送 |
| 展示语言 | 中文 UI + 原始字段双语标注 | 目标用户为中文重度多 agent 用户 |

---

## 2. 面板要回答的问题(SPEC 6.1 验收)

SPEC 6.1 的原话:

> 面板能回答:"这段记忆来自 Claude 会话 X,2024-11-03,置信度中,类型为推测"。

翻译成面板的**可验证能力清单**:

1. 列出所有任务(菌落):任务名、状态(active/dormant)、条目数、最近更新时间;
2. 选中任一任务,展示其 state.md 摘要 + 全部记忆条目;
3. 每条记忆展示:agent、session_id、timestamp、type、layer、kind、confidence、summary、payload_ref(如非空);
4. 支持按 agent / type / layer / confidence / 时间范围过滤;
5. **覆盖诚实**(SPEC 6.2):面板顶部显示"已接入数据源"清单(Codex 98 会话 / DSH 3 会话 / Edge 历史)与"未接入"标注——缺口必须显式显示;
6. 点击 payload_ref 可跳转到任务目录内对应产物文件(Obsidian 原生链接)。

---

## 3. 数据契约(面板 ↔ vault 文件)

### 3.1 面板只读三个文件,全部已有 schema

| 文件 | 路径 | 用途 | schema 来源 |
|---|---|---|---|
| 任务元数据 | `<vault>/slime-mold/tasks/<task-id>/task.json` | 任务名、生命周期状态 | CONTRACT §1 |
| 接续简报 | `<vault>/slime-mold/tasks/<task-id>/state.md` | 面板摘要区 | CONTRACT §1 |
| 记忆日志 | `<vault>/slime-mold/tasks/<task-id>/log/entries.jsonl` | 溯源明细(逐条) | CONTRACT §2(12 字段) |

无需新增任何文件或字段 → **零 schema 变更,零迁移成本**。

### 3.2 面板需要的"聚合视图"数据

面板若要显示"任务菌落总览"(所有任务 + 计数),需扫描 `<vault>/slime-mold/tasks/*/task.json`。98 个 Codex 会话 + 3 个 DSH 会话 + Edge 历史摄入后,任务数预估几十到几百,直接全量扫描 jsonl 是可接受的(每任务 jsonl 通常 < 1000 行)。

**P0 不做**:向量索引、相似任务召回(SPEC 5.5 的搜索/召回是 P1 的 task.search)。

### 3.3 数据一致性保证(依赖既有存储层)

- entries.jsonl 是 append-only(原子追加),面板读取永远看到完整已确认日志;
- 崩溃恢复由 TaskStore 负责,面板不参与写路径;
- 面板是**只读消费者**,与写者(TaskStore)无锁冲突。

### 3.4 为什么不走 MCP open()(重要设计决策)

**MCP `open()` 只返回最近 50 条(`RECENT_ENTRY_LIMIT`,见 src/task-store.ts),不适合作为完整审计面板数据源。** 面板直接读 `log/entries.jsonl` 全文(逐条渲染),绕开 50 条上限;MCP 仍用于 agent 会话的读写,面板只消费 vault 文件。二者解耦,互不干扰。

### 3.5 Dataview 结论(研究验证)

**Dataview 不会把 JSONL 行变成图谱节点**,它只能查询 markdown 属性;原生 Graph 需要由守护进程生成可重建的 Markdown 节点与 wikilink(P1 事项)。因此 P0 面板用只读 `ItemView` 直接读 `log/entries.jsonl`,不做图谱;大规模图谱(P1)可评估独立 Cytoscape/D3 `ItemView`。

---

## 4. 插件架构

### 4.1 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 插件类型 | Obsidian 自建插件(TypeScript) | 官方 API,ItemView + 边栏图标 |
| 视图 | `ItemView` + `addRibbonIcon` | 最小 UI,无第三方依赖 |
| 数据读取 | `fs/promises`(Obsidian 插件可访问 vault 外?否→用 `vault.adapter` 读 vault 内文件) | **必须用 Obsidian Vault adapter**,因为 plugin 沙箱不能直接读 vault 外路径;vault 内 slime-mold 目录通过 adapter 读取 |
| 刷新 | 手动刷新按钮 + `vault.on('modify')` 监听 slime-mold 目录 | P0 手动为主,监听为增强 |
| 跳转 | `app.workspace.openLinkText(payload_ref)` | 原生跳转任务目录产物 |

**注意(重要)**:Obsidian 插件运行在 Obsidian 的 Electron 沙箱里,不能读 vault 外任意路径;但 slime-mold 目录在 vault 内,`vault.adapter.read()` 完全可用。若将来 vault 与守护进程分离,再由守护进程提供只读 HTTP/JSON 接口(SPEC 5.1 的"本地守护进程"是 P1 形态,插件只消费其导出)。

### 4.2 插件目录结构(仓库内,非 vault 内)

```
obsidian/slime-mold-panel/
├── manifest.json          # Obsidian 插件清单(id/name/version/minAppVersion)
├── src/
│   ├── main.ts            # 插件入口:注册视图 + 边栏图标
│   ├── view.ts            # ItemView 实现 + 渲染
│   ├── store-reader.ts    # 读 task.json / state.md / entries.jsonl(vault adapter)
│   ├── types.ts           # MemoryEntry 等类型(与 src/task-schema.ts 对齐)
│   └── format.ts          # 时间/置信度/类型的本地化展示
├── esbuild.config.mjs     # Obsidian 官方构建模板
├── package.json
└── tsconfig.json
```

### 4.3 UI 布局(P0,中文)

```
┌──────────────────────────────────────────────┐
│ 黏菌 · 溯源面板                    [刷新] [设置] │
├──────────────┬───────────────────────────────┤
│ 任务菌落(左)    │ 任务详情(右)                    │
│ ▼ 周报(active) │ # 周报                         │
│    12 条 · 3 agent │ 状态:active · 最近:08-17     │
│  简历 2024(dormant)│ ── 接续简报(state.md) ──     │
│    5 条 · 1 agent │ ...                         │
│  跨境电商(active) │ ── 记忆条目(溯源) ──           │
│    9 条 · 2 agent │ [agent] [type] [conf] [时间] │
│                  │ 摘要文本...                   │
│                  │ ↳ payload_ref → 产物          │
├──────────────┴───────────────────────────────┤
│ 已接入:Codex 98 会话 · DSH 3 会话 · Edge 2024-08 │
│ ⚠ 未接入:ChatGPT 导出(待用户提供)                │
└──────────────────────────────────────────────┘
```

### 4.4 溯源条目渲染(每条记忆一行卡片)

每个条目渲染以下字段(SPEC 6.1 可回答"来源"):
- **agent 徽章**:claude-code / dsh / chatgpt / cursor(颜色区分)
- **session_id**:可复制,缩短显示(如 `c2f3…9a`)
- **timestamp**:本地化 `2024-11-03 14:22`
- **type**:decision/artifact/observation/question/fact
- **layer**:fact(绿色)/ draft(灰色)——红线:简历任务只读 fact
- **kind**:reference / state
- **confidence**:high/medium/low
- **summary**:主文本
- **payload_ref**:链接(如有)

### 4.5 覆盖诚实区(SPEC 6.2)

面板顶部固定显示:
```
已接入:Codex(98 会话)· DSH(3 会话)· Edge 历史(2024-01 ~ 2026-08)
未接入:ChatGPT 对话 · Cursor 对话 · 旧电脑迁移数据
```
"未接入"列表由 `sm-config.json`(vault 内)维护,摄入管线每次跑完更新该文件 → 面板只读展示。**禁止把"缺失"当成"没有"**(SPEC 6.2 红线)。

---

## 5. 与摄入管线的接口

摄入管线(P0 目标)输出 → vault 内 TaskStore 数据 → 面板直接可读:

```
Codex JSONL ──┐
DSH zstd ────┼→ 解析器 → 会话→任务聚合 → TaskStore(entries.jsonl + task.json + state.md) → Obsidian 面板
Edge SQLite ─┘
```

- 面板**不需要**摄入管线代码,只消费其产物(vault 文件);
- 摄入管线的"溯源面板"验收 = 面板能显示摄入后的任务 + 每条记忆的 agent/session/时间/置信度(SPEC 6.1);
- `sm-config.json` 由摄入管线写入"已接入/未接入"清单,面板只读。

---

## 6. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| Obsidian 未安装(SPEC 12.1) | 中 | 插件仓库独立开发,纯 markdown 数据先行;Obsidian 仅是可替换浏览器层 |
| 插件沙箱读不了 vault 外数据 | 低 | 数据全在 vault 内;未来守护进程提供只读接口 |
| jsonl 变大后全量扫描慢 | 低 | P0 任务量小;P1 引入 index/(向量 + 摘要索引,CONTRACT 允许) |
| Obsidian 插件 API 版本漂移 | 低 | 锁定 minAppVersion,遵循官方 esbuild 模板 |
| 溯源面板显示"自动分类"误导 | 中 | UI 只展示"任务 + 溯源",不展示分类标签(SPEC 1.2 副产品红线) |

---

## 7. 验收标准(R2 阶段)

1. [ ] 插件仓库 `obsidian/slime-mold-panel/` 落盘,typecheck 通过;
2. [ ] 手动指向任一含 slime-mold 数据的 vault,面板列出任务 + 逐条溯源;
3. [ ] 覆盖诚实区正确显示"已接入/未接入";
4. [ ] 摄入管线完成后,端到端:Codex/DSH/Edge → vault → 面板可见(与摄入管线一起验收)。

---

## 8. 待决问题(供 P1 决策)

1. 图谱视图:用 Obsidian 原生 graph view(免费)还是插件内自绘(双链图)?→ 推荐原生,零成本;
2. 面板是否需要"差异/冲突显示"(SPEC 6.3 两个 agent 矛盾结论保留双方)?→ P0 只展示时间线,冲突并排显示留 P1;
3. 是否需要守护进程提供面板数据接口(未来 vault 与守护进程分离时)?→ P1 再定;
4. 摄入管线把"会话级"还是"消息级"记忆写入 TaskStore?→ 见摄入管线设计(R3 或管线 README),面板两者都支持(entries.jsonl 每条即一行)。

---

*本报告与 SPEC 冲突处,以 SPEC 为准(SPEC 8.4 止损规则)。*
