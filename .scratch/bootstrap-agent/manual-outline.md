# 秘书手册大纲草稿（MEMORY.md 速查 + SYSTEM-GUIDE.md 手册）

> 状态：**已确认**（ticket 03 收口：D 节三点全部拍板）——供 spec 起草（ticket 04）并入"知识体系"章节。
> 依据：map 已锁决策（知识源=速查+详查、能力边界、开口规则、行为契约 02）、research 01（bash/curl 可用、base URL、API 安全门）、route 层真实签名（已逐一对读 app/api）。
> 篇幅目标：速查 ≤150 行（agent 每轮都读，越短越不消耗 token）；手册**完整缩写**（~25 行/概念，预算放宽至 ~700 行，按需读取）——Owner 已确认（03-3）。

---

## A. MEMORY.md 速查（每轮必读）

**定位**：agent 每轮 prompt 都进上下文（`runAgentRound` 会话 cwd = 家目录，pi 自动读 MEMORY.md）。只放"必须每轮都知道"的东西，其余一律下沉到 SYSTEM-GUIDE.md。

**章节结构（5 章，预计 ~120 行）**：

1. **身份与开口规则**（~15 行）
   - 名字/一句定位（"秘书"：普通 agent 成员，服务 Owner）
   - 开口规则：被动为主（被 @ 才答）+ 三处主动节点（新 agent 加入频道欢迎 / 新频道建立报到 / 办公室频道欢迎语），均一次 ≤2 句
   - 对话语言跟随用户，歧义回落简体中文
2. **能力边界（硬性）**（~20 行）
   - 可以：只读查询（频道/成员/消息/任务/提醒/搜索）+ 创建类（建频道/建 agent/发消息/设提醒）+ 汇报回执
   - 不可以（一律引导 Owner UI）：归档/删除/重置/改 runtime/改 workspace/认领任务
   - 缺关键参数先问后做；创建类完成后一行式回执
   - 兜底三话术速记（不硬编 / 不越权 / 失败如实报错——详见 SYSTEM-GUIDE.md §4）
3. **操作速查**（~35 行，一行式 curl）
   - base URL 声明：`http://127.0.0.1:30141`（自定义端口改此文件；设了 WORKSPLICE_PASSWORD 时加 `-u pi:<密码>`）
   - 查询：频道列表 / 成员列表 / 频道消息 / 任务板 / 提醒 / 搜索
   - 创建：发消息 / 建频道 / 建 agent（含先查 `GET /api/models` 取 provider/modelId 的提示）/ 设提醒
4. **SYSTEM-GUIDE.md 读取指引**（~8 行）
   - 映射表：遇到"概念不懂"→ 手册 §1；"API 不会调"→ §2；"怎么 X"→ §3；"权限/越权"→ §4
5. **当前工作 / 工作流程 / Skill 使用**（~10 行，与 ADR-0001 固定大纲兼容）
   - 占位骨架：当前任务进展、惯例流程（见下方"待确认 1"）、不依赖 Skill

## B. SYSTEM-GUIDE.md 手册（按需读取）

**定位**：秘书的"工具书"，不常读、内容厚。cwd 家目录内，按 §A 映射指引按需打开。

**章节结构（5 章，预计 ~450 行）**：

1. **产品概念**（~150 行，来源 = docs/spec.md §1.3/§3/§5 缩写，**完整缩写** ~25 行/概念，Owner 已确认 03-3）
   - 频道与 thread：target 归一化、thread 不可嵌套、消息不可变
   - 任务板：状态机（todo→in_progress→in_review→done）+ reopened 封锁（不可自动认领）
   - 提醒：recurrence DSL（every:Nm/daily@/weekly:）与"唤醒作者本人"语义
   - inbox 与 wake：拉取式游标、@mention 穿透、静音（mute）语义
   - 搜索：FTS 全文、结果带 channel/thread 归属
   - 附件 / reaction / pinned：随消息原子提交、个性化 pinned
   - **秘书视角标注**：每节附"秘书用不用得上"一行（如任务板只看不认领）
2. **系统 API 用法**（~150 行，来源 = AGENTS.md File Map + 01 结论 + 真实路由签名）
   - 地址来源：默认 127.0.0.1:30141 四处硬编码一致、loopback 恒放行、无运行时发现（01 结论）
   - 只读类：GET channels / members / channels/[id]/messages / channels/[id]/tasks / reminders / search / members/[id]/inbox
   - 创建类：POST messages（JSON + multipart 双形态、baseSeq 语义与 409 held）/ channels / members（provider/modelId/thinkingLevel 必填）/ tasks / reminders
   - 每接口：curl 示例 + 响应要点 + 典型错误（400/404/409 held）
3. **常见操作路径**（~80 行，"怎么 X" 标准指引）
   - 用户问"怎么建个频道/agent" → 秘书代办 + 回执；缺参数先问
   - 用户问"最近有什么动静" → 轮询渠道 + 摘要
   - 用户问"某主题聊过什么" → 搜索 + 定位
   - 用户要越权操作 → 兜底话术（§4）
4. **权限边界与兜底话术**（~50 行，来源 = 02 契约）
   - 越权清单与标准应答（引导 Owner UI）
   - 兜底三话术完整版：查不到 / curl 失败（重试一次仍败即如实报错）/ 越权请求
5. **术语表**（~50 行，来源 = docs/spec.md §1.3 抽取 + 秘书语境补充）
   - channel / thread / seq / inbox / freshness-hold / target / 任务板 / 提醒 / pinned / FTS……

## C. 内容来源与篇幅预算

| 章节 | 直接引用/缩写来源 | 新写来源 |
|---|---|---|
| 速查 §1 身份/开口 | 02 契约 §1、§5 | — |
| 速查 §2 能力边界 | map 决策 10/11/14 | 02 契约 §4 压缩 |
| 速查 §3 操作速查 | 01 结论（base URL、安全门、bash） | route 真实签名（已核对） |
| 手册 §1 概念 | docs/spec.md §1.3/§3.2–3.9/§5.4–5.7 | 秘书视角标注 |
| 手册 §2 API | AGENTS.md File Map + docs/spec.md §5.7 | curl 示例 |
| 手册 §3 路径 | — | 02 契约 §2、§3 |
| 手册 §4 兜底 | — | 02 契约 §4 |
| 手册 §5 术语 | docs/spec.md §1.3 | 秘书语境词条 |

预算：速查 ≤150 行 / 手册完整缩写 ~700 行 / 合计 ~850 行（Owner 已确认深版，03-3）。若手册继续超，先砍 §3 操作路径（路径可精简为表格）再砍 §5 术语。

## D. 待确认点（已全部拍板，03 收口）

1. **MEMORY.md 与 ADR-0001 固定大纲的关系**：**整体重写为速查结构**（Owner 确认，03-1）——创建后重写 MEMORY.md，保留"当前工作"节名以兼容既有工具；构建 effort 交付清单按此写。创建时 `buildMemoryTemplate` 先落固定大纲、随后秘书初始化流程覆盖（顺序细节归 spec 起草定）。
2. **速查 §3 的 curl 集**：7 条（频道列表 / 成员列表 / 发消息 / 建频道 / 建 agent / 搜索 / 设提醒），建 agent 的 provider/modelId 从 `GET /api/models` 现取；**够用**（Owner 确认，03-2），不加 inbox 自检。
3. **手册 §1 概念章的深度**：**完整缩写**（~25 行/概念，Owner 确认，03-3）；预算相应放宽（见上）。
