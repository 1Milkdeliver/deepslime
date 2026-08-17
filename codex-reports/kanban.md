# Slime Mold 开发看板

> 主会话维护。每波结束更新。状态:✅ 完成 / ⚠️ 待审查 / ❌ 失败 / 🔄 进行中 / ⏳ 待启动

## 波 1(2026-08-17,并行 4 会话)

| 模块 | 内容 | 目录 | 状态 | 备注 |
|---|---|---|---|---|
| W1 存储层 | append-only 日志 + state.md + 原子替换 + 崩溃恢复 + 幂等 | src/store/ + task-store.ts | 🔄 进行中 | 测试已写,实现中 |
| W2 校验器 | payload_ref 安全 + 严格校验 + schema_version | src/validate/ | ✅ 验收通过 | 测试 8/8,含符号链接逃逸防护 |
| W3 测试夹具 | 场景一跨会话周报恢复 + 语料生成器 | tests/ | ✅ 已落盘,⚠️ 待验收 | typecheck 通过,含 Provenance 断言 |
| W4 Provenance | 服务端来源注入(修 Critical 1) | src/prov/ | ✅ 验收通过 | 测试 3/3,伪造字段拒绝+fact 直写拒绝 |

**抽查结论(主会话)**:W2/W3/W4 质量合格,接口经 CONTRACT 对齐互相咬合。W1 完成后全量验收。

## 波 2(待启动)

| 模块 | 内容 | 目录 | 状态 |
|---|---|---|---|
| W5 MCP 工具层 | 七工具映射存储接口 | src/mcp/ | ⏳ |
| W6 集成验证 | 最小闭环端到端脚本 | scripts/verify.mjs | ⏳ |
| W7 交叉审查 | Codex 独立审 W1 | — | ⏳ |
