# 04 — 秘书初始化流程

**What to build:** 秘书身份创建后的就绪流程（spec §6.2、交付清单 §8.1-4），自动创建与手动入口共用：① 身份与家目录创建（走既有 createAgent 契约：provider/modelId/thinkingLevel 必选，家目录 + 固定大纲 MEMORY.md 模板）② 手册重写——MEMORY.md 整体重写为速查结构（保留"当前工作"节名）、SYSTEM-GUIDE.md 首次落盘（内容读自 02/03 交付的资产）③ 频道覆盖——加入全部现存频道（公开 + 私有，静默，不触发欢迎事件）④ 办公室频道「秘书办公室」私有频道幂等创建（成员 = Owner + 秘书，name 全等判定复用不重建）⑤ 以 Owner 署名向办公室频道投欢迎事件（`@Susan 欢迎入职——这是你的办公室频道`）→ 秘书被唤醒后正常回复欢迎语（≤2 句，节点 3）。铁律：不以秘书署名触发。

**Blocked by:** 01 — 事件系统消息投递；02 — MEMORY.md 速查全文；03 — SYSTEM-GUIDE.md 手册全文

**Status:** resolved

- [x] 秘书身份创建后自动执行五步，全部为既有服务层能力组合（零机制改动，签名不破坏）
- [x] 手册重写生效：MEMORY.md 为速查结构（含"当前工作"节名）、SYSTEM-GUIDE.md 落盘（读自内容资产）
- [x] 全部现存频道（公开 + 私有）静默加入、不触发欢迎事件（配合 01 的排除规则）
- [x] 办公室频道幂等：重跑不重复建、已存在即复用
- [x] 欢迎事件以 Owner 署名投递、秘书被唤醒并正常回复 ≤2 句（不以秘书署名触发）
- [x] 初始化失败不半途留下残缺秘书（错误路径可重跑，幂等）

## Answer

`lib/raft/secretary-init.ts` 新增 `initSecretaryFlow()`（服务层，自动创建 05 与启动助手 06 共用），`lib/raft/event-messages.ts` 新增 `notifySecretaryWelcome()` + `SECRETARY_WELCOME_CONTENT`（复用私有 `deliverEventMessage`：Owner 署名 + wake:false + 定向唤醒）。

**五步**：① 无存活 Susan 时走 `createAgent` 契约创建（provider/modelId/thinkingLevel 可选、null 继承全局默认；判定 = 名字全等 + 存活，软删不重建，05 自带"软删也算已存在"前置、06 重建走 createAgent + 本流程）；② 手册内容**先读后写**（资产缺失 → 动状态前抛错），MEMORY.md 整体重写为速查（"当前工作"节名保留）+ SYSTEM-GUIDE.md 首次落盘，逐字节 = 02/03 资产（默认路径 repo 内 `.scratch/bootstrap-agent-build/manual/`，`SECRETARY_MANUAL_DIR` 可覆盖）；③ 全部现存频道（公开 + 私有）经 `joinChannel(actor=Owner)` 静默加入（01 排除规则天然静默）；④ 办公室频道「秘书办公室」私有、name 全等复用——直接走 DB 原语而非 `createChannel`（后者投"新频道已建立"报到事件，与节点 3 欢迎事件双重唤醒），Owner 成员恒补齐、秘书被移出时静默修复；⑤ 欢迎事件幂等门控：身份新建 / 办公室新建 / 办公室尚无消息（部分失败补跑窗口）才投递，重跑不刷欢迎语。

**配套**：`lib/raft/secretary-init.test.mjs` 7 条（完整初始化五步 / 重跑幂等不重复建频道不刷欢迎语 / 软删重建复用办公室频道唤醒新秘书 / 重建后重跑不重复欢迎 / 秘书被移出办公室静默修复 / 资产缺失先抛错零状态变更 / 资产 fixture 存在）。类型检查通过（tsc --noEmit）、eslint 0 错误 0 警告；相邻 01 相关测试（event-messages/channels/members 45 条）全绿。
