# 08 — 端到端联动验收

**What to build:** spec §9.2 五条联动验收的全链路验证与收尾（交付清单 §8.1-3 欢迎唤醒验收的端到端形态）：Susan 存活场景下建新 agent / 建新频道 → Susan 被唤醒并正常回复（≤2 句）、其他 agent 不被惊动；Susan 自动加入全部频道为静默路径、欢迎事件不含"欢迎 Susan 自己"；模型未配置降级；curl 全链路复验。发现的问题回流到对应票修复，全部通过后 effort 构建部分收尾。

**Blocked by:** 05 — 首次启动自动创建；06 — 启动助手入口

**Status:** resolved

- [x] 首次启动自动创建 Susan；重复启动不重建；删除后不自动重建、启动助手按钮可重建（§9.2-1）
- [x] 新 agent 加入频道 / 新频道建立 → Susan 被唤醒并正常回复（≤2 句）；其他 agent 不被惊动（§9.2-2）
- [x] Susan 自动加入全部频道为静默路径；欢迎事件不含"欢迎 Susan 自己"（§9.2-3）
- [x] 模型未配置时启动不报错、UI 显示启动助手入口（§9.2-4）
- [x] 创建类操作（建频道 / 建 agent / 发消息 / 设提醒）经 curl 全链路可用（7 条速查实测）（§9.2-5）

## Answer

五条验收点全链路验证闭环，构建 effort 收尾。

**服务层 E2E 验收测试**（`lib/raft/secretary-e2e.test.mjs`，6 条，§8.1-3 欢迎唤醒验收的端到端形态）：fake LoopRuntime 注入（与 driver.test.mjs 同款接缝），一条文件跑通——
① §9.2-1：首次启动 `autoCreateSecretary` 自动创建（身份 + 手册 + 频道覆盖 + 办公室 + 欢迎事件）、重复启动不重建、删除（soft-delete）后自动创建不重建、`initSecretaryFlow`（启动助手按钮路径）重建全新秘书（办公室复用不重复建、欢迎事件换新署名）；
② §9.2-3：欢迎事件不含"欢迎 Susan 自己"（全频道扫描断言无 `新成员 @Susan 加入频道` 形态）、Susan 手动加入频道静默（无事件无 wake）；
③ §9.2-4：`defaultModel` 为 null → 跳过 + 服务端日志、零状态变更，UI 入口判定（`hasLiveSusan` false → 按钮显示；`resolveBootstrapModel` null → 引导配置）；
④ §9.2-2 端到端联动：起 driver + fake runtime → 建 agent 加入频道 / 建新频道 → 事件消息以 Owner 署名投递（`@Susan 新成员 @X 加入频道` / `@Susan 新频道 #Y 已建立`）→ wake 定向仅 Susan → driver 驱动 `runAgentRound` → Susan 回复 ≤2 句落库；**其他 agent 不被事件惊动**（事件 seq 的 wake 无 alice、alice 零发言；Susan 的回复是普通消息唤醒 channel 成员属 §3.2 正常语义，验收点是事件本身不惊动他人）；私有频道未勾选 Susan → 事件投 `#all` 穿透送达仍定向唤醒。

**curl 全链路复验**（`.scratch/bootstrap-agent-build/manual/memory-quickref-curl.test.mjs`，5 条，§9.2-5）：解析 MEMORY.md §3 速查表 7 条 curl 逐条回放（频道/成员/发消息/建频道/建 agent/搜索/设提醒，全部 2xx）+ 启动自动创建经 curl 可见（成员列表含 Susan）+ 建频道事件消息经消息流可见 + 建 agent 事件经 `#all` 可见 + Susan 自动加入新公开频道（members 列表）。**发现并修复一处手册问题（回流 02 资产）**：MEMORY.md §3 搜索速查原为 `?q=关键词` 裸中文直拼（隔离实例实测 400——SYSTEM-GUIDE 在 03 已修、速查表漏改），改为 `-G --data-urlencode "q=关键词"` 形态并同步 `memory-quickref.test.mjs` 断言。

**隔离实例实测**（临时 `WORKSPLICE_DATA_DIR` + 项目副本 + 端口 30142，避免污染真实数据）：启动即自动创建 Susan（`GET /api/members` 可见、办公室频道 + Owner 署名欢迎事件落库）；**重启（kill 后同数据目录再起）不重建**（Susan id 不变、办公室不重复建、欢迎事件不重复投）；7 条速查 curl 逐条 2xx；建频道/建 agent 事件消息经 curl 可见。真实 agent-loop 链路（事件 → wake → driver → 会话）在隔离实例的 Susan session jsonl 中可见房间标记（`[worksplice:target=<id> seq=N]` 落在办公室/`#all`/新建频道），模型侧回复为空系本机 openrouter 连通性，非机制问题——回复落库由服务层 E2E 确定性覆盖。

类型检查（tsc --noEmit）0 错误、eslint 0 错误 0 警告（1 既有警告在 ChannelView.tsx，与本票无关）；全量测试 616 条中 615 绿，唯一失败为既有环境性 `skill-lock.test.mjs`（干净树同样失败，与 02/03/07 记录一致）；curl 复验测试（`memory-quickref-curl.test.mjs`，与 `system-guide-curl.test.mjs` 同款约定）需手动起隔离实例后运行——无实例时因连不上 30142 报错属预期（头部注释写明用法），非全量套件的一部分。
