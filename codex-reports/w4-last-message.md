W4 Provenance 已实现并落盘，未 commit。

交付文件：

- [实现文件](/D:/Deepseek%20Harness/slime-mold/src/prov/index.ts)
- [测试文件](/D:/Deepseek%20Harness/slime-mold/src/prov/__tests__/build-entry.test.mjs)
- [交付报告](/D:/Deepseek%20Harness/slime-mold/codex-reports/w4-summary.md)

实现包括严格拒绝客户端 provenance/未知字段、服务端生成 UUID 和 UTC 时间戳、从认证连接注入来源信息，以及拒绝 `layer=fact` 直接写入。

验证结果：

- `npm run typecheck`：通过
- 专项测试：3/3 通过

当前环境没有 `git` 命令，因此无法执行 `git status/diff`；已通过文件枚举确认交付文件范围。