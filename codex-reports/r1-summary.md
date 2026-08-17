# R1 存储层修复总结

## 结论

W7 报告中的 3 个 critical 与 2 个 major 缺陷均已按 R1 范围修复，并新增对应回归测试。`npm run typecheck` 与 `npm test` 均通过；未创建 commit。

## C1：截断尾记录被后续写入固化

- **修复内容**：`atomicAppendJsonLine` 在追加前检查旧文件是否以换行结束。若没有，只保留最后一个完整换行及其之前的已确认字节，丢弃未确认尾部，再原子发布新记录。entries 与 checkpoints 共用该逻辑。
- **验证方式**：分别增加 entries 和 checkpoints 的“截断尾 → 成功读取/恢复 → 追加 → 新 TaskStore 重放”测试，并确认截断片段没有进入新日志。
- **状态**：完全修复。

## C2：词法路径别名绕过单写者锁

- **修复内容**：`withTaskLock` 在进入进程内队列前对任务目录执行 `realpath`；Windows 上再统一转为小写，canonical 路径作为唯一锁键。检查、生成记录和原子发布仍处于同一把锁内。
- **验证方式**：
  - 用真实任务目录与 junction 别名同时进入锁，断言最大并发写者为 1；
  - 用指向同一物理 vault 的两个 `TaskStore` 并发写入 12 条不同记录，重放后断言所有返回 ID 均存在且无丢失。
- **状态**：完全修复（进程内单写者语义）。

## C3：record 接受完整 MemoryEntry，可伪造 provenance/fact

- **修复内容**：`TaskStore.record` 改为：

  ```ts
  record(connection: AuthenticatedConnection, content: ClientContent): Promise<{ id: string }>
  ```

  存储边界调用 W4 的 `buildEntry` 生成 `id/task_id/agent/session_id/timestamp/confidence/source_scope`，不再接受调用者提供的完整 `MemoryEntry`。`buildEntry` 的运行时严格字段检查会拒绝 provenance 字段、未知字段和 `layer=fact`。MCP record 工具仍先执行 W2 `validateRecordInputForTask`，然后直接把受信 connection 与五个内容字段传给 store，并返回 store 生成的 `{id}`。
- **验证方式**：新增存储层 provenance 生成与返回 ID 测试、完整 entry/伪造 provenance 拒绝测试、直接 fact 拒绝测试，以及 MCP 到 store 的参数委托测试。原有 W2/W4 测试继续通过。
- **状态**：P0 范围完全修复；fact 的用户确认晋升工具仍按契约留待后续阶段。

## M1：rename 缺少持久化屏障

- **修复内容**：临时文件改为 `open(..., "wx")` 获取 `FileHandle`，执行 `writeFile → sync → close → rename`；rename 后打开并同步父目录。对平台明确不支持目录 fsync 的错误采用 best-effort 兼容，其他 I/O 错误继续抛出。保留 finally 临时文件清理。
- **验证方式**：加入可注入文件操作适配器测试，精确断言 `file sync` 发生在 rename 前、`directory sync` 发生在 rename 后；所有实际文件写入/恢复测试也在 Windows 环境通过。
- **状态**：按“rename 后尽可能同步父目录”的要求完全修复。

## M2：重放只校验 schema_version

- **修复内容**：entries 反序列化复用 W2 的 `validateMemoryEntry`，校验 schema_version 加完整 12 字段、精确字段集合、UUID/时间戳/枚举/常量及字段类型；随后显式核对记录 `task_id` 与当前任务 ID。
- **验证方式**：新增未知字段、缺字段、非法枚举和错误 task ID 四类磁盘日志重放拒绝测试。
- **状态**：完全修复。

## 已知 P1 与集成提示

- W7 的 minor m1（每次 record 全量读取并重写、累计 O(n²) I/O）按要求未修，记入 P1。当前实现仍优先保证原子发布与恢复正确性。
- `tests/scenario1.test.ts` 仍使用旧的单参数 `record(entry)` 兼容视图，fixture 还携带客户端不应提交的 `task_id/source_scope`。按职责边界未修改；主集成方需改为提供 `AuthenticatedConnection` 与五字段 `ClientContent`。
- `scripts/verify.mjs` 同样仍先调用 `buildEntry` 再把完整 entry 传给 store，需由主集成方按新签名调整；本 R1 未越界修改。

## 验证结果

- `npm run typecheck`：通过。
- `npm test`：28/28 通过，0 failed。

