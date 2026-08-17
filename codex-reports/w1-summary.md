# W1 存储层交付摘要

## 做了什么

- 实现 `TaskStore.open/record/checkpoint/close`：支持按明确 task ID 或精确名称打开、读取最近 50 条日志、持久化条目、保存检查点和关闭任务。
- 日志采用 `log/entries.jsonl`，磁盘条目带 `schema_version: 1`；每次提交通过同目录临时文件加 rename 原子发布。
- `record` 以条目 `id` 幂等，并以进程级、按任务划分的异步锁保证同一任务单写者；锁由所有 `TaskStore` 实例共享。
- `checkpoint` 先追加提交到 `log/checkpoints.jsonl`，再原子替换 `state.md`。`open` 会重放最新检查点并修复缺失或陈旧的 `state.md`。
- `close` 原子更新 `task.json` 的 `status` 为 `dormant`，保留其他元数据、状态和日志。
- 对 task ID、严格 12 字段条目、P0 `source_scope` 和 `payload_ref` 做存储边界防御；`payload_ref` 拒绝绝对路径、`.`/`..` 段及经符号链接/目录联接逃逸任务目录。
- 在 `src/store/__tests__/task-store.test.mjs` 添加 6 个验收测试，覆盖打开、并发幂等、JSONL schema 版本、路径逃逸、崩溃恢复、截断尾部和关闭不删数据。

## 没做什么

- 未实现服务端认证和 provenance 生成；存储层接收已补全的 `MemoryEntry`，保持仓库原有 `TaskStore.record(MemoryEntry): Promise<void>` 边界。
- 未实现 P1 的 `handoff/search/reattach`，未实现向量索引。
- 未创建任务；`open` 只打开已经存在且有 `task.json` 的任务。
- 未修改 `SPEC.md`、`CONTRACT.md`、`src/task-schema.ts`、`src/validate/`、`src/prov/`、仓库级 `tests/`、`package.json` 或 `tsconfig.json`。

## 依赖与约定

- 构造方式为 `new TaskStore(vaultRoot)`；任务根目录解析为 `<vaultRoot>/slime-mold/tasks`。省略参数时使用当前工作目录。
- `task.json` 至少应可解析为 JSON 对象；名称查找读取其 `name`，关闭写入其 `status`。
- provenance（`id/agent/session_id/timestamp/confidence`）应由上层已认证服务注入后再调用存储层。
- 仅依赖 Node.js 内置模块和现有 TypeScript，无新增 npm 依赖。

## 验证结果

- `npm run typecheck`：通过。
- 编译测试目标后执行 `node --test src/store/__tests__/task-store.test.mjs`：6/6 通过。
