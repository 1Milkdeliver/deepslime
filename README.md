# 🦠 DeepSlime — 会话可弃,记忆永存

> **DeepSlime** 是一个以"任务"为中心、跨 agent、跨会话、跨时间的**持久任务记忆系统**。
> 你随时开新会话、换任何 agent,它自动接上这个任务的过往记忆;你随时丢弃会话,记忆不丢。

<p align="center">
  <a href="https://github.com/1Milkdeliver/deepslime/stargazers"><img src="https://img.shields.io/github/stars/1Milkdeliver/deepslime" alt="Stars"/></a>
  <a href="https://github.com/1Milkdeliver/deepslime/network/members"><img src="https://img.shields.io/github/forks/1Milkdeliver/deepslime" alt="Forks"/></a>
  <a href="https://github.com/1Milkdeliver/deepslime/blob/main/LICENSE"><img src="https://img.shields.io/github/license/1Milkdeliver/deepslime" alt="License"/></a>
</p>

---

## 🎯 它解决什么问题

重度多 agent 用户(同时用 **DSH / Claude Code / Codex / ChatGPT / Cursor**)最大的痛:

> **"我忘了哪个 agent、哪个会话、哪个对话做了哪件事。"**

每次开新会话都要重新解释一遍背景;换一个 agent 就断了上下文;翻聊天记录找到死。DeepSlime 把**任务记忆**从会话中抽离出来,成为唯一持久层——会话只是壳,任务才是记忆的锚点。

## 🌟 核心承诺

| 承诺 | 说明 |
|---|---|
| **会话可弃,记忆永存** | 身份和状态不在会话里,在任务记忆里。随便开、随便关、随便换 agent |
| **任务为主键** | 记忆按任务组织(agent/会话/文件/URL 都是任务的"刻面",不是平行分类轴) |
| **溯源可审计** | 每条记忆必带 {agent, session, timestamp, type, confidence},能回答"这段记忆来自哪" |
| **覆盖诚实** | 召回时同步展示来源与**缺口**——"我记得我抓到的",不假装"我记得一切" |
| **本地优先** | 个人记忆数据永远留在本地,vault 是纯 markdown,随时可被人读懂 |

## 🚀 快速开始

### 1. 摄入历史会话(一次性)

```bash
# 把 Codex / DSH / Edge 浏览历史的会话聚合成"任务"写入 vault
node scripts/ingest.mjs \
  --vault <vault-root> \
  --codex "C:/Users/Huawei/.codex/sessions" \
  --dsh "C:/Users/Huawei/.dsh/sessions/<workspace>" \
  --edge "<Edge User Data>/Default/History" \
  --agent dsh --session "ingest-2026-08-17" --key "ingest-2026-08-17"
```

### 2. 新会话随时接续(加载协议)

```bash
# 看有哪些任务(菌落总览)
node scripts/list-tasks.mjs --vault <vault-root>

# 加载任务记忆(两级加载:先摘要,后展开)
node scripts/load-task.mjs --vault <vault-root> --name "<任务名>" --brief   # 摘要,几十 token
node scripts/load-task.mjs --vault <vault-root> --name "<任务名>"           # 接续简报 + 最近记忆
node scripts/load-task.mjs --vault <vault-root> --id <uuid>                # 按明确 id 加载

# 会话中随时记录一条记忆
node scripts/record-note.mjs --vault <vault-root> --name "<任务名>" \
  --agent dsh --session "<会话id>" --type observation --summary "一句话摘要"
```

### 3. (可选)Obsidian 图谱

仓库自带 Obsidian 溯源面板插件(`obsidian/deepslime-panel/`),把 vault 作为文件夹打开即可看到任务菌落图谱 + 逐条溯源。**不需要 Obsidian 也能用**——加载协议是 CLI。

## 🧠 核心概念

```
任务原型(周报)     ← 模板/格式偏好/反馈史       每次必加载,量小稳定
任务实例(2024-11周) ← 历次产物/当时用的agent/来源 按需检索 top-k
片段(对话记录)     ← 压缩后的事件摘要           只在回溯时展开
```

- **双记忆**:陈述记忆(事实/产物/决策/报告)+ 程序记忆(流程/skill/工具调用序列)
- **生命周期**:`开 → 附着 → 记录 → 关 → 萎缩 → 相似苏醒 → 接续`
- **两级加载 + 可见加载**:第一级只加载摘要(几十 token),确认后再展开细节——防误加载(SPEC 5.5)
- **压缩非破坏性**:原始日志归档,摘要只是投影,永不删数据

## 🔍 与 DeepChat 的对比

DeepSlime 与 [DeepChat](https://github.com/ThinkInAIXYZ/deepchat)(开源本地优先 Agent 桌面客户端)是**同生态不同层**的项目:

| 维度 | **DeepSlime(本仓库)** | **DeepChat** |
|---|---|---|
| 本质 | **任务记忆层**(记忆体/服务) | **Agent 桌面客户端**(执行层/UI) |
| 记忆单位 | **任务**(跨 agent 共享) | **会话**(Tape 记录单个会话过程) |
| 跨 agent 接续 | ✅ 设计核心:Codex/DSH/Cursor 共享任务记忆 | ⚠️ 会话绑定单客户端,Tape 可恢复但非跨 agent |
| 定位 | 后台服务 + MCP + 加载协议 | 前端桌面应用 + 多提供商 + 远程控制 |
| 存储 | 纯 markdown vault,人可读、git 可 diff | 本地应用数据(加密接口) |
| 溯源 | 每条记忆带 {agent/session/时间/置信度} | Trace 预览(请求序号/模型/上下文/token) |
| 浏览器层 | Obsidian(可选,可随时替换) | 自建 Electron 界面 |
| 覆盖诚实 | ✅ 显式列出"未接入"缺口 | 无此概念 |
| 与 agent 关系 | **不是 agent**,只提供记忆,不与 agent 竞争 | 是 agent 客户端 |

### DeepChat 的强项(我们不做的)
- 丰富的聊天 UI(Markdown/Artifacts/多 Tab/分支重试)
- 多模型提供商 + Ollama 本地部署
- MCP/Skills/ACP 集成、远程控制(Telegram/飞书等 IM)
- Tape 哲学的**会话过程可恢复**(请求级 trace、token 预算)

### DeepSlime 的差异化(DeepChat 没有的)
1. **任务级跨 agent 记忆**:DeepChat 的 Tape 是"单个会话的可恢复记录",DeepSlime 是"跨 agent/跨会话的任务记忆菌落"——换 agent 记忆不丢;
2. **加载协议 CLI**:`list-tasks / load-task / record-note` 三个命令,任何 agent 都能接续,不依赖桌面 UI;
3. **覆盖诚实区**:显式标注"哪些数据源已接入、哪些缺口"——记忆系统信任的基石;
4. **溯源即安全**:每条记忆可追溯到 agent/会话/时间/置信度,防幻觉传染;
5. **存储零绑定**:纯 markdown vault,Obsidian 可随时替换,数据零迁移成本。

**一句话**:DeepChat 是"更好的 agent 客户端",DeepSlime 是"agent 们的共同记忆层"——它们可以共存:DeepChat 的会话由 DeepSlime 摄入,变成跨 agent 可检索的任务记忆。

## 🏗️ 架构

```
本地守护进程(常驻,唯一主人)
  ├── 任务区域存储:纯 markdown vault(sm-vault/)
  │     └── tasks/<task-id>/{task.json, state.md, log/entries.jsonl}
  ├── 摄入管线:Codex/DSH/Edge 会话 → 聚合"会话→任务" → 写入 TaskStore
  ├── 加载协议:list-tasks / load-task / record-note(CLI,任何 agent 可用)
  ├── MCP 服务(协议层,任何 agent 读写)
  └── 浏览器层:Obsidian(可选,图谱 = 任务菌落)
```

### 记忆条目 schema(12 字段)

```json
{
  "id": "uuid", "task_id": "uuid",
  "agent": "claude-code|dsh|chatgpt|cursor",
  "session_id": "...", "timestamp": "ISO8601",
  "type": "decision|artifact|observation|question|fact",
  "layer": "fact|draft",
  "kind": "reference|state",
  "summary": "一句话摘要",
  "payload_ref": "路径或为空",
  "confidence": "high|medium|low",
  "source_scope": "personal"
}
```

## 🗂️ 项目结构

```
deepslime/
├── src/
│   ├── task-store.ts        # 任务存储核心(open/record/checkpoint/close)
│   ├── task-schema.ts       # 记忆条目类型
│   ├── store/               # 原子日志/锁/路径安全
│   ├── validate/            # 严格校验(payload_ref 防逃逸)
│   ├── prov/                # provenance 服务端注入
│   ├── mcp/                 # MCP 工具层
│   └── ingest/              # 摄入管线(Codex/DSH/Edge 解析器 + 聚合 + 写入)
├── scripts/
│   ├── ingest.mjs           # 三源摄入 CLI
│   ├── list-tasks.mjs       # 加载协议:任务清单
│   ├── load-task.mjs        # 加载协议:记忆加载(两级)
│   ├── record-note.mjs      # 加载协议:随时记录
│   ├── emit-graph.mjs       # Obsidian 图谱节点生成
│   └── verify.mjs           # 最小闭环验证
├── obsidian/deepslime-panel/# Obsidian 溯源面板插件(可选)
├── vault/                   # 记忆 vault(个人数据,不提交)
├── SPEC.md                  # 架构权威文档
└── CONTRACT.md              # 接口契约
```

## 📈 评测指标

| 指标 | 目标 | 当前(P0 存储层) |
|---|---|---|
| 接续时间 | 显著下降 | 有记忆 ~1014 tokens vs 无记忆 ~10 tokens(存储层 1.003×) |
| 误加载率 | < 5% | **0%**(6/6) |
| 重回成功率 | > 90% | **100%**(3/3) |
| 记忆复用率 | 持续上升 | P1 后测 |
| 溯源透明度 | ≈ 100% | 每条记忆 12 字段完整溯源 |

## 🧪 测试

```bash
npm test          # 40/40(存储层 32 + 摄入管线 8)
npm run verify    # 最小闭环:create→record→checkpoint→close→reopen→resume
```

## 📄 文档

- [`SPEC.md`](SPEC.md) — 架构设计文档(权威事实源)
- [`CONTRACT.md`](CONTRACT.md) — 接口契约(Codex 协同开发依据)
- [`src/ingest/README.md`](src/ingest/README.md) — 摄入管线 + 加载协议用法
- [`codex-reports/kanban.md`](codex-reports/kanban.md) — 开发看板

## 📜 许可

MIT License。开源的是代码,不是数据——个人记忆永远留在本地。

---

*会话可弃,记忆永存。* 🦠
