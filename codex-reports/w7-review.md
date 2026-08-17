# W7 交叉审查：W1 存储层

## 结论摘要

**是否可合并：否。** 当前实现存在 3 个 critical：可恢复的截断日志会在下一次写入时被固化为永久损坏；同一物理任务可通过路径别名获得不同锁键，进而发生重复或丢失已确认日志；`record` 存储边界允许调用者直接写入 `fact` 及自报 provenance，无法满足 P0 的“只使用用户确认事实”验收门。另有 2 个 major 和 1 个 minor。

审查依据仅为 `CONTRACT.md` 与仓库代码。审查范围为 `src/task-store.ts`、`src/store/files.ts`、`src/store/log.ts`、`src/store/lock.ts`、`src/store/paths.ts`；测试仅用于核验覆盖情况。

## Critical

### C1. 容忍的截断尾记录会被下一次写入提升为中间损坏，之后整个日志无法重放

- **位置：** `src/store/files.ts:29-32`、`src/store/files.ts:35-49`
- **理由：** `parseJsonLines` 会忽略最后一条未终止且不可解析的记录，因而一次 `open`/`readEntries` 可以成功恢复既有已确认记录；但 `atomicAppendJsonLine` 随后原样读取包含该截断尾部的旧文本，只补一个换行再追加新记录。原截断内容于是从“可忽略的最后尾部”变成“已终止的中间行”，下一次读取会在 `parseJsonLines` 抛出损坏错误。checkpoint 日志走同一 helper，也有相同问题。这直接破坏 CONTRACT 4 的崩溃恢复和 CONTRACT 7.1 的“重启不丢已确认日志、可重建 state.md”。现有测试 `src/store/__tests__/task-store.test.mjs:99-113` 只验证截断尾部可以读取，没有覆盖“恢复后再写、再重启”。
- **修复建议：** 在任何新写入前先规范化日志：若旧文件没有以换行结束，只保留最后一个完整换行之前的已确认字节，再追加新 JSON 行；或在专门恢复步骤中用临时文件 + rename 原子清除未确认尾部。为 entries 和 checkpoints 分别增加“截断尾部 → 成功读取 → 追加 → 新实例重放”的回归测试，并加入真实子进程在两个写阶段被终止的故障注入测试。

### C2. 锁使用词法路径作键，同一物理任务的路径别名可绕过单写者约束

- **位置：** `src/task-store.ts:31-32`、`src/task-store.ts:53-61`、`src/store/lock.ts:1-18`
- **理由：** `withTaskLock` 仅按传入字符串区分队列；`TaskStore` 的锁键来自 `resolve(vaultRoot, ...)`，没有 `realpath`/平台规范化。同一目录可通过 junction/symlink、Windows 路径大小写或其他等价别名构造出不同字符串键。两个 `TaskStore` 随后会同时通过幂等检查。由于追加又是“读整个旧文件 + 替换”，一种交错会把同一 id 追加两次，另一种交错会让两个不同 id 的最后一次 rename 覆盖前一次结果，导致已成功返回的记录丢失。这同时违反 CONTRACT 4 的幂等、单写者和不丢已确认日志要求，以及 CONTRACT 7.1/7.2。
- **修复建议：** 锁前取得任务目录的 canonical `realpath`，并在 Windows 上使用稳定的大小写规范作为唯一锁键；最好在 `TaskStore` 初始化时 canonicalize vault 根目录。把“检查 id + 生成新日志内容 + 发布”保留在同一 canonical 锁内。增加两个指向同一 vault 的路径别名并发测试，分别覆盖相同 id 和不同 id。

### C3. 存储边界接受调用者提供的完整 MemoryEntry，允许未确认 fact 和伪造 provenance 落盘

- **位置：** `src/task-store.ts:50-61`、`src/task-store.ts:162-187`
- **理由：** `record` 接受完整 `MemoryEntry`，校验明确允许 `layer === "fact"`，并直接保存调用者提供的 `id`、`agent`、`session_id`、`timestamp`、`confidence`。因此该类本身没有“用户确认后晋升”的可信边界，任意调用者都可把 draft 伪装成已确认 fact。CONTRACT 7.4 要求查询结果全部来自用户确认事实；当前存储层无法区分真正确认与自报字段。仓库场景测试还通过类型断言绕过了签名不匹配（`tests/scenario1.test.ts:19-31`），不是实现符合合同的证据。
- **修复建议：** 将公开 `record` 改为只接收合同允许的内容字段，由受信服务端上下文生成 id/provenance 并返回 `{ id }`；P0 下拒绝普通 `record` 的 `layer=fact`。如需晋升 fact，提供独立的、携带用户确认凭据或确认事件的受信路径，并把确认事件写入可审计日志。

## Major

### M1. rename 提供发布原子性，但没有持久化屏障，不能保证系统崩溃后保留已确认写入

- **位置：** `src/store/files.ts:14-22`
- **理由：** 临时文件位于目标同目录，`writeFile` 后 `rename` 的结构能保证观察者看到旧版或新版，这一点正确；但实现没有对临时文件执行 `fsync`/`FileHandle.sync()`，rename 后也没有同步父目录。Promise 成功只说明数据进入操作系统缓存，不等于内容和目录项已经稳定落盘。掉电或内核崩溃时，调用者已收到成功的日志仍可能消失，和 CONTRACT 4/7.1 的“不丢已确认日志”承诺不一致。
- **修复建议：** 使用 `open(..., "wx")` 获取句柄，写完后 `sync` 再关闭；rename 后在平台支持时同步父目录。明确“成功响应”的 durability 边界，并用可故障注入的文件系统适配层测试 write/sync/rename/dir-sync 各阶段。

### M2. 重放时只验证 schema_version，磁盘日志的其余字段未经严格校验

- **位置：** `src/store/log.ts:14-17`、`src/store/log.ts:48-52`
- **理由：** 写入路径的 `assertMemoryEntry` 有 12 字段校验，但 `parseStoredEntry` 只检查对象和 `schema_version === 1`，随后直接类型断言。包含未知字段、缺字段、非法枚举、错误 task_id 或不安全 payload_ref 的磁盘记录都会进入 `recentEntries`。这不符合严格 schema 的完整性预期，也会让恢复结果不再可信；日志一旦被旧版本、手工操作或局部损坏改变，读取边界无法阻止坏数据传播。
- **修复建议：** 在 `log.ts` 的反序列化边界完整验证 12 个业务字段、精确字段集合、task_id 与当前任务的一致性及 schema_version；复用一个无副作用的统一 schema validator，避免写入和重放规则漂移。对未知字段、缺字段、非法枚举和错误任务 id 增加恢复测试。

## Minor

### m1. 每次 record 对整个日志至少读取两次并整体重写，长期运行会呈平方级 I/O

- **位置：** `src/task-store.ts:58-61`、`src/store/files.ts:29-32`
- **理由：** `record` 为幂等检查解析整个 entries 日志，`atomicAppendJsonLine` 又读取一次原始日志并重写全部内容。随着“永存”日志增长，累计写入成本为 O(n²)，内存峰值也随日志线性增长；写入窗口越长，故障与锁等待风险越高。
- **修复建议：** 维护可从日志重建的 id 索引/集合，避免每次全量解析；采用不会覆盖历史段的分段不可变日志，再通过原子 manifest/段发布完成提交。若 P0 暂不分段，至少避免双重读取并设定可观测的大小阈值。

## CONTRACT 逐项核对

### 第 4 节：写入一致性

| 条款 | 结果 | 说明 |
|---|---|---|
| append-only JSONL；临时文件 + rename 原子发布 | **部分满足** | 同目录临时文件 + rename 的发布结构正确；逻辑上只追加，但每次替换整个文件，且缺少持久化屏障（M1）。 |
| 同 id record 不重复 | **不满足** | 单一规范路径下串行检查有效；路径别名可绕过锁并触发竞态（C2）。 |
| 启动重放日志重建 state.md/索引，不丢已确认日志 | **不满足** | `open` 会用最后一个 checkpoint 修复 state.md，日志先于投影的顺序正确；但截断尾部在下一写入后会破坏重放（C1），确认写入也没有 crash-durability 保证（M1）。未见索引重建，P0 目录说明允许省略索引。 |
| 同任务进程内单写者 | **不满足** | 所有 `TaskStore` 正常写路径均进入锁，但锁键不是物理任务的规范身份（C2）。 |

### 第 7 节：P0 验收门

| 验收项 | 结果 | 说明 |
|---|---|---|
| 1. 写入被终止后不丢已确认日志，可重建 state.md | **不通过** | C1、M1；现有 checkpoint 测试只模拟成功写完后 state.md 变旧，没有终止写入进程。 |
| 2. 重复 record 不重复；非法 payload_ref 被拒 | **部分通过** | `paths.ts:17-40` 能拒绝绝对路径、`.`/`..` 与当前已存在祖先的 symlink/junction 逃逸；常规并发测试通过，但 C2 仍可破坏幂等。 |
| 3. 新会话按明确 task ID 恢复；摘要可定位来源 | **在 W1 范围内基本通过** | `open({id})` 返回 checkpoint 状态与最近条目；已保存的 summary/payload_ref 会原样返回。语义上“每条摘要必可定位来源”未由存储层强制，但合同允许 `payload_ref=null`，应由上层 provenance/校验补足。 |
| 4. 查询仅使用用户确认事实；时间缺口明确 | **不通过** | 存储边界可直接写 fact（C3）；时间段缺口/简历查询不在本次 W1 文件中实现。 |

## 路径安全与写路径补充

- `assertSafePayloadRef` 的词法 containment 和“最近存在祖先 realpath”策略对当前时点的 symlink/junction 逃逸处理较完整。
- payload_ref 是持久化字符串，未来真正打开该路径的读取方仍必须再次做 canonical containment 校验，避免验证后目录被替换形成 TOCTOU；本存储层当前不解引用 payload，因此不单列为缺陷。
- `record`、`checkpoint`、`close` 以及会修复投影的 `open` 都由 `withTaskLock` 包围；问题不是遗漏正常写路径，而是锁身份可被别名拆分（C2）。

## 验证记录

- `npm.cmd run typecheck`：通过。
- `node --test src/store/__tests__/task-store.test.mjs`：6/6 通过。该命令使用仓库现有 `.test-dist`；由于只读约束未重新生成构建产物，因此测试结果仅作辅助，静态源码审查结论优先。
- 未修改任何源码，未 commit；唯一新增文件为本报告。
