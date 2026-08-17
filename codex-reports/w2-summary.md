# W2 校验器交付摘要

## 做了什么

- 在 `src/validate/index.ts` 实现两层严格校验：
  - `validateRecordInput`：只接受客户端可提交的 `type/layer/kind/summary/payload_ref` 五个字段，拒绝未知或缺失字段、错误类型和非法枚举，并按 CONTRACT 第 5 节拒绝客户端直接写 `layer=fact`。
  - `validateMemoryEntry`：校验完整持久化条目的 13 个字段（MemoryEntry 12 字段加 `schema_version`），要求 `schema_version === 1`，并校验 UUID、ISO8601 UTC 时间、枚举以及 `source_scope=personal`。
- 实现 `validatePayloadRef`：允许 `null`；拒绝空字符串、NUL、POSIX/Windows 绝对路径、任一分隔符风格的 `..`；通过任务目录和最近已存在祖先的 `realpath` 检查拒绝符号链接逃逸。允许尚未创建的目标文件，但其已存在祖先必须位于真实任务目录内。
- 提供 `validateRecordInputForTask` 和 `validateMemoryEntryForTask` 组合入口，避免调用方遗漏路径安全校验。
- 在 `src/validate/__tests__/validator.test.mjs` 写了测试，覆盖严格字段、字段类型/枚举、schema 版本、身份与 provenance、绝对路径、两种分隔符的遍历、符号链接逃逸、安全/未创建目标及组合入口。

## 没做什么

- 未修改或接入 `task-schema.ts`、store、provenance 或其他模块；由对应模块调用本校验器。
- 未添加 npm 测试脚本或依赖，因为 `package.json` 属于禁止修改范围。测试直接使用 Node 24 内置 test runner。
- 未实现日志写入、锁、幂等或崩溃恢复；这些不属于 W2 校验器职责。

## 依赖什么

- 仅依赖 Node 内置 `node:fs/promises`、`node:path`；无新增第三方运行时依赖。
- 路径安全检查要求传入的任务目录已经存在。引用目标本身可以尚不存在。
- 校验与随后文件操作之间仍应由调用方保持同一安全边界；调用方不应绕过校验结果重新解析不可信路径。

## 验证结果

- `npm.cmd run typecheck`：通过。
- `node --test src/validate/__tests__/validator.test.mjs`：8/8 通过。
