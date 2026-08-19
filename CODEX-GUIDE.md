# Codex 协同开发手册

本文件记录如何在本项目中使用 Codex CLI 协同开发/评审,以及踩过的坑。

## 调用方式(已验证)

```powershell
# 正确:prompt 通过 stdin 传入,自然关闭 EOF;必须带 -s workspace-write 才能落盘
$prompt = @'
(任务描述)
'@
$prompt | codex exec -C "D:\Deepseek Harness\deepslime" -s workspace-write --json -o "codex-reports/last-message.md"
```

## 已踩的坑(2026-08-17)

### 坑 1:prompt 作为命令行参数 + 管道截断 → Codex 挂起等 stdin

- **现象**:`codex exec "prompt" 2>&1 | Select-Object -First 30` — Codex 只发出开场白,不执行任何命令,不产生任何产出文件,exit 0;
- **原因**:Codex 检测到 stdin 被管道占用,进入"继续读 stdin"模式;`Select-Object -First 30` 截断管道导致输入不完整/悬挂;
- **修正**:prompt 通过管道喂 stdin(自然 EOF),输出用 `-o` 落盘,不在管道上截断。

### 坑 2:默认 sandbox 只读 → 产出无法落盘

- **现象**:Codex 完整执行了任务(读 SPEC、竞品调研、内容就绪),但写文件被拒,日志:`writing is blocked by read-only sandbox; rejected by user approval settings`;所有目标文件未被创建(exit 0,无产出);
- **原因**:`codex exec` 默认 sandbox 是 `read-only`,`apply_patch` 写文件被权限策略拒绝;
- **修正**:必须显式传 `-s workspace-write`(允许写工作区目录)。注意不要用 `danger-full-access`(无必要且危险)。

## 协同纪律(SPEC 8.2)

1. **Codex 不共享本会话架构讨论**——唯一依据是 SPEC.md 和仓库内容;
2. 产出必须落盘到文件,不经对话传递;
3. Codex 产出必须经主会话审查后才进 main;
4. 指令不精确导致产出偏差时,改 SPEC/指令重试,不在主会话重写。
