# W3 测试夹具交付摘要

## 做了什么

- 新增 `tests/scenario1.test.ts`，覆盖两次独立 `TaskStore` 会话：会话 A 按名称创建/打开周报任务、写入三条记忆、checkpoint 并 close；会话 B 仅凭 task id 重新 open，并校验 checkpoint state、最近条目内容及服务端 provenance 字段均恢复。
- 新增 `tests/fixtures/weekly-report-memory.ts`，按 `CONTRACT.md` 第 2、3、5 节生成确定性的周报 draft 记忆输入，且不伪造服务端生成字段。
- 新增 `tests/test-runtime.d.ts`，为仓库当前未安装 `@types/node` 的情况提供最小测试运行时类型声明，便于独立检查测试 TypeScript。

## 没做什么

- 未修改 `SPEC.md`、`CONTRACT.md`、`src/`、`package.json` 或 `tsconfig.json`。
- 未实现 TaskStore，也未绕过其持久化行为；测试需要真实实现后才会通过运行时断言。
- 未提交 git commit。

## 依赖与 TODO

- 依赖 `src/task-store.ts` 实现 `CONTRACT.md` 第 3 节的 `open`、`record`、`checkpoint`、`close` 行为，并保证不同 `TaskStore` 实例共享同一持久化任务库。
- 当前波 1 骨架的 `record(MemoryEntry): Promise<void>` 与契约 `record(content fields): Promise<{id}>` 不一致。测试内使用窄的契约兼容视图并标注 TODO；W1 修正源接口后可移除该转换。
- 契约未规定 TaskStore 构造参数，因此测试使用无参构造；若最终实现要求显式 vault/session 配置，需要由 W1 暴露契约化工厂或保持无参构造兼容。
