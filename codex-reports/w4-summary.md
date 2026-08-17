# W4 Provenance 交付摘要

## 做了什么

- 在 `src/prov/index.ts` 实现 `buildEntry(connection, clientContent): MemoryEntry`。
- 客户端只允许提交 `type`、`layer`、`kind`、`summary`、`payload_ref` 五个内容字段。
- `id`、`agent`、`session_id`、`timestamp`、`confidence` 均由服务端控制：身份、会话、任务和置信度来自已认证连接，UUID 与 UTC 时间戳在构建条目时生成。
- `source_scope` 按 P0 固定为 `personal`。
- 严格拒绝客户端提交 provenance 字段及其他未知字段。
- P0 只允许 `layer=draft`；客户端直接提交 `layer=fact` 时返回 `FACT_LAYER_FORBIDDEN`。
- 在 `src/prov/__tests__/build-entry.test.mjs` 添加测试，覆盖 provenance 伪造、服务端时间戳/完整注入及 fact 直写拒绝。

## 没做什么

- 未实现 fact 的确认/晋升工具；P0 仅拒绝客户端直接写 fact。
- 未实现 `payload_ref` 的任务目录边界校验；该职责属于 CONTRACT.md 指定的 W2 校验模块。
- 未实现日志持久化、幂等或任务存储逻辑。
- 未修改 schema、store、validate、tests、构建配置或包配置。

## 依赖什么

- 依赖 `src/task-schema.ts` 提供 `MemoryEntry` 及相关联合类型。
- 依赖调用方只传入已经完成认证并绑定 `agent`、`sessionId`、`taskId`、`confidence` 的连接；本模块不负责身份认证。
- 后续写入链路仍需调用 W2 的内容与 `payload_ref` 校验。

## 验证结果

- `npm run typecheck`：通过。
- `node --test src/prov/__tests__/build-entry.test.mjs`：3/3 通过。
