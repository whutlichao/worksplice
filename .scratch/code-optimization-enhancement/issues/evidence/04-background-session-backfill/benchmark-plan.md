# Ticket 04 合成基准计划（测量前登记）

- 输入完全合成；每个样本独立临时 SQLite 数据库与 workspace，运行后删除；固定 UTF-8 JSONL 内容模板，不读取用户 session/数据库。
- 基线代码：`01369c574c6284dee6d6db54b3685c42451aa0de` 的临时 worktree；候选：本票 worktree。两侧同一脚本、同一机器、同一 Node/Bun 依赖。
- 每个 workload 先 1 次预热，再采集 30 个样本；按 workload 分别汇总中位数、P90、MAD 与原始样本。规模：
  - small：2 agents / 2 session files / 64 KiB 每文件 / 20 marker rounds 每文件；
  - medium（预定决策规模）：8 agents / 8 files / 256 KiB 每文件 / 64 rounds 每文件；
  - large：12 agents / 12 files / 512 KiB 每文件 / 128 rounds 每文件。
- 主要比较项：`createAgentLoop.start()` 同步返回时间（driver/cron ready 的可观察代理）；从 start 到全部预期回复/游标恢复完成的时间；扫描分批 yield 次数、首/末 yield 相对时间。旧版同步 start 在回到事件循环前完成恢复，故 baseline 的 scan 和 start 阻塞时间分别取同一次 `start()` 区间，yield=0。
- 屏障/恢复子试验：small workload，每侧 warmup 1 次 + 30 次。baseline 记录同步启动占用（wake 已可调度但事件循环未恢复的 `start()` 区间）与 ready 时已完成恢复；候选把一次合成 read gate 延迟固定 3 ms，期间发送 agent/target wake，记录实际键等待和 gate 放开后的恢复时间。原始样本标注两种实现语义，避免把人工 gate 延迟误称为代码性能。
- 不预设百分比收益。medium 为主要判据：只有 start-to-ready 与其 P90 的改善方向稳定，且 median 改善超过两侧 `3 × max(MAD)` 的测量噪声，才 go；否则 no-go。small/large 同时报结果，不能用平均值掩盖回归。
- 原始数据写入 `baseline-raw.jsonl`、`candidate-raw.jsonl`、`baseline-barrier-raw.jsonl`、`candidate-barrier-raw.jsonl`；统计与环境写入 `benchmark-summary.json` / Answer。执行脚本：本目录 `benchmark.mjs`；命令与完整输入规模亦写入 Answer。
