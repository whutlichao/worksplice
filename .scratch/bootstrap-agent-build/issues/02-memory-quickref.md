# 02 — MEMORY.md 速查全文

**What to build:** 秘书家目录的 MEMORY.md 速查内容资产（spec §5.2、交付清单 §8.3-1）：5 章、≤150 行、每轮必读。身份与开口规则（被动为主 + 三处主动节点 ≤2 句 + 语言跟随用户）/ 能力边界硬性清单（可做只读+创建类、不可做引导 Owner UI、不认领任务、缺参数先问后做、兜底三话术速记）/ 操作速查（base URL 声明 + 7 条一行式 curl，全部实测可用，建 agent 前先取 provider/modelId）/ SYSTEM-GUIDE 读取指引映射表 / 当前工作占位节（节名保留，与 ADR-0001 固定大纲兼容）。首行注明"基于 spec-bootstrap-agent.md 草稿 2026-08-08 撰写"（§8.4-1，spec 原文含"草稿"二字，本条 What to build 初稿漏写，Answer 已按 spec 校正）。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 5 章齐全、结构符合 spec §5.2，篇幅 ≤150 行
- [x] 7 条 curl 命令对运行中的 worksplice 逐条实测可用（含建 agent 前 `GET /api/models` 提示）
- [x] 兜底三话术速记与能力边界硬性清单在内
- [x] base URL 声明（默认 127.0.0.1:30141、自定义端口改此文件、设密码加 `-u pi:<密码>`）
- [x] 首行来源注明（§8.4-1）

## Answer

内容资产交付于 `.scratch/bootstrap-agent-build/manual/MEMORY.md`（70 行，5 章齐全，结构符合 spec §5.2；首行注明"基于 spec-bootstrap-agent.md 2026-08-08 撰写"）。

**curl 实测**：在隔离实例（临时 `WORKSPLICE_DATA_DIR` + 端口 30142，避免污染真实数据）上逐条实测，并从资产文件按原文抽取逐条回放验证全部通过——频道列表 / 成员列表 / 发消息 / 建频道 / 建 agent（含 provider/modelId/thinkingLevel 必填契约）/ 搜索（FTS，中文双字走 LIKE 兜底路径）/ 设提醒（fireAt + recurrence every:2m）；另验证 409 held（过期 baseSeq）与 404 语义。建 agent 前先 `GET /api/models` 的提示已写入 §3。

**配套**：`manual/memory-quickref.test.mjs` 结构性测试 9 条（篇幅 ≤150 / 5 章齐全 / 当前工作节名保留 / base URL 声明 / 7 条 curl / models 提示 / 兜底三话术与不可做清单 / SYSTEM-GUIDE 映射表），防止后续票（03/04）误改资产契约。运行：`node --test .scratch/bootstrap-agent-build/manual/memory-quickref.test.mjs`。

类型检查通过（tsc --noEmit）；全量测试 486 条中 485 通过，唯一失败为既有的环境相关 `skill-lock.test.mjs`（在干净树上同样失败，与本票无关）。
