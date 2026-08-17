# W8 open 创建语义交付总结

## 做了什么

- 修改 `TaskStore.open`：
  - 按 `name` 精确查找已有任务；唯一匹配时重开原任务，多个精确匹配时继续报重名歧义错误。
  - 按 `name` 找不到任务时生成 UUID，并创建符合 CONTRACT 第 1 节的任务目录：`task.json`、空 `state.md`、空 `log/`。
  - 新建的 `task.json` 写入 `{ id, name, status: "active" }`。
  - 按 `id` 打开不存在的任务时继续报错，并返回明确的 `Task not found: <id>` 错误，而不是底层 `realpath` 的 `ENOENT`。
- 创建流程复用 `atomicReplace` 写入文件，并在 canonical tasks-root 锁内完成按名“查找或创建”；新任务目录初始化也使用任务锁。这保留了 R1 的原子写入、canonical 路径和进程内单写者保证，并避免同进程并发按同一新名称创建重复任务。
- 在 `src/store/__tests__/task-store.test.mjs` 新增回归测试，覆盖：
  1. 按 name 创建新任务及目录结构；
  2. 按 name 重开已有任务；
  3. 按 id 打开不存在任务报错；
  4. 创建后立即 `record` / `checkpoint` 并可重开恢复。

## 没做什么

- 未修改 `SPEC.md`、`CONTRACT.md`、`src/task-schema.ts`、`src/validate/`、`src/prov/`、`src/mcp/`、`tests/`、`scripts/`、`package.json` 或 `tsconfig.json`。
- 未修改现有手动预建任务的验证流程；该路径仍然合法且已通过验证。
- 未提交 git commit。

## 依赖什么

- UUID 由 Node.js `node:crypto.randomUUID()` 生成。
- 原子文件发布继续依赖 `src/store/files.ts` 的 `atomicReplace`。
- 并发串行化和 canonical 路径继续依赖 `src/store/lock.ts` 的 `withTaskLock`。
- `record`、checkpoint journal、恢复与 provenance 继续复用现有实现。

## 验证结果

- `npm run typecheck`：通过。
- `npm test`：32/32 通过。
- `npm run verify`：通过，证明现有手动创建路径保持兼容。

`scripts/verify.mjs` 和 `tests/scenario1.test.ts` 现在可简化为直接使用 `open({ name })` 创建任务；本次根据职责边界没有修改它们。
