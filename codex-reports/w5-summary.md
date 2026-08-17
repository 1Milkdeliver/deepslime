# W5 MCP 工具层交付摘要

## 做了什么

- 在 `src/mcp/index.ts` 实现 SDK 无关、类型安全的 4 个工具定义：`open`、`record`、`checkpoint`、`close`。
- 每个定义均提供工具名称、严格 JSON 输入 schema 和异步处理函数。
- `record` 按顺序调用 W2 的 `validateRecordInputForTask`、W4 的 `buildEntry`，再调用真实 `TaskStore.record`，并返回服务端生成的 `{ id }`。
- `open`、`checkpoint`、`close` 对工具输入执行严格对象校验（拒绝未知/缺失字段），再映射到对应 `TaskStore` 方法。
- 在 `src/mcp/__tests__/tools.test.mjs` 使用真实 `TaskStore` 和临时 vault 覆盖四工具行为、schema 形状、provenance 注入、W2 路径校验及严格字段拒绝。

## 没做什么

- 未引入或绑定任何具体 MCP SDK，也未增加外部依赖。
- 未实现 P1 的 `handoff`、`search`、`reattach`。
- 未修改职责边界外的源码、测试、配置或契约文件。
- 未提交 git commit。

## 依赖什么

- W1：`TaskStore` 及其 `open`、`record`、`checkpoint`、`close` 方法。
- W2：`ValidationError`、`validateRecordInputForTask`。
- W4：`AuthenticatedConnection`、`buildEntry`。
- Node.js 内置模块与仓库现有 TypeScript 工具链。

## 验证结果

- `npm.cmd run typecheck`：通过。
- `npm.cmd test`：通过，21/21（其中 W5 测试 4/4）。

备注：当前 Windows PowerShell 执行策略阻止 `npm.ps1`，因此使用同一 npm 安装提供的 `npm.cmd` 执行等价命令。
