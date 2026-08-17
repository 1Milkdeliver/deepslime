# Slime Mold 接口契约(Codex 唯一依据)

> 由主会话从 SPEC.md 提取维护。Codex 会话只读本文件 + 自己目录,不读 SPEC.md。
> 版本:v0.3(与 SPEC 同步)

## 1. 目录结构(SPEC 5.2)

```
<vault>/
├── slime-mold/
│   ├── tasks/<task-id>/
│   │   ├── task.json        # 身份+生命周期元数据
│   │   ├── state.md         # 接续简报(唯一真相源)
│   │   ├── log/             # append-only 记忆条目(JSONL)
│   │   ├── artifacts/       # 产物文件
│   │   └── index/           # 检索索引(P0 可省略)
│   ├── skills/              # 程序记忆(P0 可省略)
│   └── sm-config.json       # 守护进程配置
```

## 2. 记忆条目 schema(SPEC 5.4,12 字段)

```ts
interface MemoryEntry {
  id: string;              // uuid,服务端生成
  task_id: string;         // uuid
  agent: string;           // 稳定客户端 ID(服务端注入,禁止客户端自报)
  session_id: string;      // 服务端注入
  timestamp: string;       // ISO8601 UTC,服务端生成
  type: "decision" | "artifact" | "observation" | "question" | "fact";
  layer: "fact" | "draft"; // fact 需用户确认后晋升(P0:仅 draft 可写,fact 需 confirm 工具)
  kind: "reference" | "state";
  summary: string;         // 一句话摘要
  payload_ref: string | null;  // 必须为任务目录内相对路径,禁止绝对路径/../
  confidence: "high" | "medium" | "low";  // 服务端生成
  source_scope: "personal";  // P0 恒为 personal
}
```

## 3. 工具签名(SPEC 5.3,P0 只做 4 个)

| 工具 | 签名 | 语义 |
|---|---|---|
| `open` | `open(task: {id} \| {name}) → {taskId, state, recentEntries}` | 加载 state.md + 最近条目;只按明确 ID/名称,不自动召回相似任务 |
| `record` | `record(entry: Omit<MemoryEntry, "id"\|"agent"\|"session_id"\|"timestamp"\|"confidence">) → {id}` | 服务端注入 provenance;幂等:同 id 不重复 |
| `checkpoint` | `checkpoint(taskId, state: {content}) → void` | 原子更新 state.md(唯一真相源) |
| `close` | `close(taskId) → void` | 只改生命周期状态为 dormant,不删数据 |

推迟到 P1:`handoff`、`search`(向量)、`reattach`(意图检测)。

## 4. 写入一致性要求(修 Critical 2)

- 日志:append-only JSONL,每次写入原子(写临时文件 + rename);
- 幂等:record 同 id 不产生重复条目;
- 崩溃恢复:启动时重放日志重建 state.md/索引,不丢已确认日志;
- 单写者:同一任务同一时刻仅一个写者(进程内锁)。

## 5. Provenance 要求(修 Critical 1)

- `agent`/`session_id`/`timestamp`/`confidence` 由服务端从已认证连接生成;
- 客户端只提交内容字段(type/layer/kind/summary/payload_ref);
- `layer=fact` 禁止客户端直接写入,需用户确认后晋升(P0 可只实现 draft)。

## 6. 校验规则(修 Major 3, W2 模块)

- `payload_ref`:必须解析到任务目录内,拒绝绝对路径、`..`、符号链接逃逸;
- 未知字段:拒绝(严格 schema);
- schema 版本:条目带 `schema_version: 1`(为演进预留)。

## 7. P0 验收门(SPEC 8.4 + Codex 评审)

1. 写入过程被终止,重启不丢已确认日志,可重建 state.md;
2. 同幂等键重复 record 不重复;非法 payload_ref 被拒;
3. 新会话用明确 task ID 恢复,用户能从每条摘要定位原始来源;
4. 简历查询结果全部来自用户确认的事实;未接入时间段明确列为缺口。
