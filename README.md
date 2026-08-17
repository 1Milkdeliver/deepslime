# 黏菌 (Slime Mold)

> 会话可弃,记忆永存 — Task-scoped persistent memory for cross-agent workflows.

黏菌是一个以"任务"为中心、跨 agent、跨会话、跨时间的持久记忆系统:随时开启新的会话/新的 agent,自动接上这个任务的过往记忆;随时丢弃会话,记忆不丢。

- **单位**:任务(agent/会话/软件/文件夹都是任务的刻面)
- **双记忆**:陈述记忆(产物/事实/决策)+ 程序记忆(流程/skill/工具日志)
- **生命周期**:开→附着→记录→关→萎缩→相似苏醒→接续
- **浏览器层**:Obsidian vault(图谱视图 = 任务菌落地图)
- **协议层**:MCP(任何 agent 可读写)

## 快速开始

*(P0 开发中,尚未发布)*

## 文档

- [`SPEC.md`](SPEC.md) — 架构设计文档(权威事实源)

## 开发

- 架构/核心逻辑:主会话(DSH)
- 编码/评审:Codex CLI 协同
- 版本控制:GitHub(MIT)

## 许可

MIT License
