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

## 波 3(待启动)

| 模块 | 内容 | 状态 |
|---|---|---|
| open 创建语义 | open 支持不存在任务时创建(场景一"会话 A 创建"缺口) | ⏳ |
| 指标评测 | 接续时间/误加载率/重回成功率 | ⏳ |
