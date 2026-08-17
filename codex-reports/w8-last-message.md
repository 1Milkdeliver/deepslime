W8 “open 创建语义”已实现并落盘，未提交 commit。

主要变更：

- [src/task-store.ts](</D:/Deepseek Harness/slime-mold/src/task-store.ts>)
  - 按 name 不存在时创建 UUID 任务。
  - 初始化 `task.json`、空 `state.md`、空 `log/`。
  - 按 name 重开保持精确匹配、重名报错。
  - 按 id 不存在保持报错语义。
  - 使用 canonical tasks-root 锁、任务锁及原子写入。

- [task-store.test.mjs](</D:/Deepseek Harness/slime-mold/src/store/__tests__/task-store.test.mjs>)
  - 新增要求的四类测试。

- [w8-summary.md](</D:/Deepseek Harness/slime-mold/codex-reports/w8-summary.md>)
  - 已记录完成内容、未修改范围、依赖及简化建议。

验证结果：

- `npm run typecheck`：通过
- `npm test`：32/32 通过
- `npm run verify`：通过

`verify/scenario1` 现在都可简化为直接使用 `open({ name })` 创建任务；根据职责边界，本次未修改它们。