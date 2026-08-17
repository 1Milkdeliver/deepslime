# W9 指标评测脚本交付

## 做了什么

- 新增 `scripts/bench.mjs`，使用真实 `TaskStore` 和系统临时目录生成 3 个任务，每个任务写入 10 条记忆。
- 接续时间比：对每个任务分别在空记忆和 10 条记忆状态下执行 20 次 `open({id})`，汇总 60 个样本的 mean/median/min/max；同时记录序列化上下文字符数、UTF-8 字节数，并按 `ceil(characters / 4)` 估算 token 数。
- 误加载率：用 6 个近似但不相关名称执行 `open({name})`。P0 对新名称会创建空任务，因此“拒绝”定义为没有召回 3 个已有任务中的任何一个，并校验返回的 state/entries 为空；另用 3 个精确名称作为正向对照。
- 重回成功率：使用新的 `TaskStore` 实例模拟歪题后 reattach，以 `open({id})` 恢复并逐项校验完整 state 和全部 10 条 entries。
- 新增 `scripts/bench.test.mjs`，验证数据规模、三项输出和阈值判定。
- 所有临时任务数据均在 `finally` 中删除；运行错误、数据不完整或 SPEC 数值阈值失败时，命令退出码非零。

## 一次实测结果

运行环境：Node.js v24.18.0，Windows，60 个 `open` 样本/条件。

| 指标 | 结果 |
|---|---:|
| 无记忆 open 平均耗时 | 2.574 ms |
| 有记忆 open 平均耗时 | 3.843 ms |
| 存储层耗时差 / 比率 | +1.269 ms / 1.493x |
| 无记忆上下文 | 37 chars / 10 estimated tokens |
| 有记忆上下文 | 4054 chars / 1014 estimated tokens |
| 误加载率 | 0/6 = 0%（目标 < 5%） |
| 重回成功率 | 3/3 = 100%（目标 > 90%） |

接续时间的 SPEC 目标是端到端“产出有效接续”的耗时下降。本脚本按 W9/P0 职责只实测存储层，并仅以加载上下文大小模拟 LLM 输入，因此不对该定性目标作通过/失败断言。上述数据说明本次加载 10 条记忆带来约 1.3 ms 存储开销；不能单独用于声称端到端 LLM 接续已加速。

## 依赖与运行

- 无新增外部依赖；脚本仅使用 Node.js 内置模块和项目 `TaskStore`。
- 与现有 `scripts/verify.mjs` 一致，运行时从 `.test-dist/task-store.js` 加载编译产物。源码变化后先执行 `npm run pretest`（PowerShell 策略受限时可用 `npm.cmd run pretest`）。
- 直接运行：`node scripts/bench.mjs`
- 脚本测试：`node --test scripts/bench.test.mjs`
- 未修改 `package.json`，因此未新增 `npm run bench` 命令。
