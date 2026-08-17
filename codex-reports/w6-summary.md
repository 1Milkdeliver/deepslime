# W6 集成验证总结

## 做了什么

- 新增 `scripts/verify.mjs`，在系统临时目录初始化契约规定的任务目录，并创建 `TaskStore`。
- 用会话 A 完成 open、record、checkpoint、close；用独立的会话 B `TaskStore` 实例按明确 task id 重开。
- 验证 dormant 生命周期状态、checkpoint state、记录内容及会话来源完整恢复。
- 每一步打印 `[ok]` 结果；断言或 I/O 失败会被顶层捕获并设置非零退出码。
- 新增 `scripts/verify.test.mjs`，验证闭环返回值和逐步输出。

## 没做什么

- 未修改 `SPEC.md`、`CONTRACT.md`、`src/`、`tests/`、`package.json` 或 `tsconfig.json`。
- 未提交 Git commit。
- 未在脚本中补造 `TaskStore.create()`：当前实现没有创建 API，因此脚本按 CONTRACT.md 目录结构初始化任务，再调用现有公开 API。

## 依赖什么

- Node.js 22。
- 由 TypeScript 编译生成的 `.test-dist/task-store.js` 与 `.test-dist/prov/index.js`；可先运行 `npm run pretest` 生成。
- 当前 `package.json` 没有 `verify` script，且 W6 禁止修改该文件。主集成方需加入 `"verify": "npm run pretest && node scripts/verify.mjs"`，之后才能以 `npm run verify` 调用；当前可直接执行 `npm run pretest` 后再执行 `node scripts/verify.mjs`。
