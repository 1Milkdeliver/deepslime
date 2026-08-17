# Slime Mold 并行开发流水线(Codex 多会话)

> 目的:用多个 Codex 会话并行开发,加快 P0 编码与验证速度。
> 纪律:并行不=乱跑。所有机制都在防"多写者冲突"和"验证失效"。

## 一、核心机制

### 1. 波次制(按依赖关系分波)

```
波 1(互不依赖,同时启动):
  W1 存储层    src/store/    append-only 日志 + state.md 投影 + 原子替换 + 崩溃恢复 + 幂等写入
  W2 校验器    src/validate/ payload_ref 安全检查 + 字段校验 + 拒绝非法输入
  W3 测试夹具  tests/       场景一测试(跨会话周报恢复)+ 测试语料生成器
  W4 Provenance src/prov/   服务端生成来源(修 Critical 1)

波 2(依赖波 1 接口,可先用 mock 并行):
  W5 MCP 工具层 src/mcp/    七工具映射存储接口
  W6 集成验证   scripts/verify.mjs  最小闭环端到端脚本
  W7 交叉审查   —           Codex 独立审查 W1 代码(新鲜视角)
```

### 2. 文件所有权(防冲突)

- 每个会话一个**专属目录**,prompt 中明确声明;
- **禁止修改** SPEC.md、CONTRACT.md、其他会话目录、.git 相关;
- 冲突信号:git status 出现别人目录的文件 → 该会话立即停止并报告。

### 3. 契约文件(CONTRACT.md)

- 从 SPEC 提取接口定义(5.2 目录结构、5.3 工具签名、5.4 schema),做成精简版;
- 每个会话的 prompt 只引用 CONTRACT.md 对应章节,**不重读整个 SPEC**;
- CONTRACT.md 由主会话维护,与 SPEC 同步,是唯一接口事实源。

### 4. 测试先行(验证不靠主会话逐行读)

- 每个模块交付前必须:① `npm run typecheck` 通过;② 专属测试 `npm test -- <dir>` 通过;
- 主会话只跑测试看红绿,不逐行审查低风险模块;
- 高风险模块(存储一致性 W1、Provenance W4)主会话**逐行审查**。

### 5. 波次隔离(单点失败不阻塞全局)

- 某模块 2 轮不过 → 标记 BLOCKED,隔离;其他波继续;
- BLOCKED 模块不阻塞集成:集成用该模块的最小 mock 替代,标注未验证。

## 二、Codex 会话指令包模板

```
你是 slime-mold 项目 <模块> 开发者。严格按 CONTRACT.md 第 <X> 节实现。

职责边界:
- 只读写你的专属目录 <dir>(不存在则创建);
- 禁止修改:SPEC.md、CONTRACT.md、其他目录、git 配置;
- 你的代码必须:① npm run typecheck 通过 ② <dir> 下测试通过;
- 测试优先:先写测试定义验收,再实现;
- 产出落盘到 codex-reports/<module>/,不 commit;
- 你无法访问主会话的架构讨论,唯一依据是 CONTRACT.md 和仓库现有代码。

交付物:
- 实现文件(你目录下)
- 测试文件(你目录下)
- codex-reports/<module>/summary.md(做了什么/没做什么/依赖什么)
```

## 三、主会话节奏(每波结束)

1. 收各模块产出 → 跑 `npm run typecheck && npm test` 全量;
2. 高风险模块逐行审查,低风险抽查;
3. 集成脚本跑最小闭环(开→记录→checkpoint→关→重开→接续);
4. 汇总到 codex-reports/kanban.md(每个模块状态:✅/⚠️/❌/BLOCKED);
5. 全绿 → 合并 commit → 启动下一波;有红 → 只重跑该模块的下一轮。

## 四、验证加速点

- **并行度**:每波 3-4 个 Codex 会话(太多争抢额度且审查不过来);
- **prompt 复用**:同模板,只换模块名/目录/契约章节,生成快;
- **增量验证**:每轮只跑受影响模块测试,不跑全量(全量留波末);
- **契约先行**:CONTRACT.md 定死接口,波 2 可对 mock 开发,与波 1 完全并行。

## 五、与本仓库其他文档的关系

- SPEC.md — 架构权威(主会话维护);
- CONTRACT.md — 接口契约(主会话从 SPEC 提取维护,Codex 唯一读它);
- CODEX-GUIDE.md — Codex 调用方式与踩坑记录;
- 本文件 — 并行编排流程。
