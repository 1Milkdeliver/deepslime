W2 校验器已实现并落盘，未 commit。

交付文件：

- [校验器实现](<D:/Deepseek Harness/slime-mold/src/validate/index.ts>)
- [Node 类型声明](<D:/Deepseek Harness/slime-mold/src/validate/node-shims.d.ts>)
- [测试](<D:/Deepseek Harness/slime-mold/src/validate/__tests__/validator.test.mjs>)
- [交付摘要](<D:/Deepseek Harness/slime-mold/codex-reports/w2-summary.md>)

验证结果：

- `npm.cmd run typecheck`：通过
- 校验器测试：8/8 通过

实现涵盖严格字段/schema 校验、`schema_version: 1`、绝对路径及 `..` 拒绝、Windows/POSIX 路径处理和符号链接逃逸防护。未修改任何禁止目录或文件。