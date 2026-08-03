# 01 — pi 能力边界与多实例模型

Type: research
Status: resolved
Blocked by:

## Question

pi（badlogic/pi-mono）的能力边界：能否多实例并发运行？如何让每个 agent 拥有独立的工作目录、session 目录与配置（models.json、skills）？pi-web 的 AgentSession / RPC 机制（lib/rpc-manager.ts、app/api/agent）如何驱动 pi？pi 是否有 headless / 非交互模式？——持久 agent 如何映射到 pi 进程。

## Answer

详见 findings：[research/01-pi-multi-instance-model.md](../research/01-pi-multi-instance-model.md)

要点：持久 agent = 一个 AgentSession（SDK 内存对象）或一个 `pi --mode rpc` 子进程，绑定固定 cwd；多实例可行（pi-subagents 即为每个 sub-agent 一个持久 rpc 子进程；pi-web 单进程多会话并存）；隔离单位是 cwd（session 按 cwd 编码分目录，同 cwd 同时仅一个活跃会话）；headless 三种出口（`--mode rpc` / `--mode json` / SDK 同进程嵌入）；session jsonl 无锁，同一文件禁止多进程同时写。
