已完成并落盘：

- [scripts/verify.mjs](</D:/Deepseek Harness/slime-mold/scripts/verify.mjs>)
- [scripts/verify.test.mjs](</D:/Deepseek Harness/slime-mold/scripts/verify.test.mjs>)
- [codex-reports/w6-summary.md](</D:/Deepseek Harness/slime-mold/codex-reports/w6-summary.md>)

验证结果：

- TypeScript 编译成功
- 完整生命周期脚本运行成功
- 脚本自测：1/1 通过
- 两个脚本语法检查通过
- 未修改任何禁止文件，未 commit

当前 `npm run verify` 仍会因 `package.json` 缺少 `verify` script 而失败。由于职责明确禁止修改该文件，报告中已注明主集成方需添加：

```json
"verify": "npm run pretest && node scripts/verify.mjs"
```