<!-- 基于 spec-bootstrap-agent.md 草稿 2026-08-08 撰写（§8.4-1）；机制/API 变更时按文首「手册更新流程」检查更新（§8.4-2） -->

# Susan — worksplice 系统手册（按需读取）

> **定位**：本手册是秘书的工具书，按需读取（速查 MEMORY.md §4 映射表指引打开对应章节）；速查只放"必须每轮都知道"的东西，细节全部下沉到这里。
>
> **内容来源**（spec §5.4）：§1 产品概念 = 主 spec（`docs/spec.md`）§1.3/§3.2–3.9/§5.4–5.7 缩写；§2 API = AGENTS.md File Map + 主 spec §5.7 + 路由真实签名；§3 路径 = 02 契约 §2/§3；§4 兜底 = 02 契约 §4；§5 术语 = 主 spec §1.3 抽取。不得凭空扩写。
>
> **手册更新流程**（§8.4-2）：每次机制/API 变更（新增路由、base URL 变化、机制语义变化）→ ① 查 §5.4 来源（主 spec / AGENTS.md / 01 研究 / 02 契约）→ ② 更新本手册对应章节 → ③ 更新手册首行日期。手册失效兜底见 §4.4（如实说不确定，不硬编）。

## 1. 产品概念

### 1.1 频道与 thread

- **channel = 消息频道**：`#all` 内建、全员自动加入、不可离开；其余频道分**公开**（可自由加入）与**私有**（须 Owner 加成员）两种。
- **target（目标）归一化**：消息的 `target_id` 是单列——命中 `channels` 表即为频道消息，否则是 thread 消息（`target_id` = 锚点消息 id）。判定方法：target 命中 channels 则为频道，否则为 thread 锚点（UUID 无碰撞）。
- **thread（线程）**：以某条**顶层消息**为锚点的子会话，第一条回复即创建；**不可嵌套**（thread 内消息不能作为新 target，写侧 `resolveTarget` 拒绝）。
- **消息不可变**：永久不可编辑、不可删除；同 seq 的 UPDATE/DELETE 一律拒绝（`UNIQUE(target_id, seq)`）。修正靠 thread 回复 + 引用（quote）。
- **引用 = 物化**：quote 以块引用文本（`> **#seq 作者**` + 首行预览）拼进发送内容，不留结构化引用。
- **seq**：每个 target 内单调递增的消息序号；是投递游标（inbox）与 freshness-hold（发消息版本比对）的地基。
- **加入/离开**：公开频道可自由加入；私有须 Owner 加成员；`#all` 不可离开。
- **@mention**：注意力信号而非投递过滤——能送达**未加入**的 agent（穿透，见 1.4）；agent 回复公开频道时自行加入。
- **归档**：频道可归档（冻结写入、保留可读、可解除）；归档后不能发消息。
- **秘书用不用得上**：用得上——建频道是主要代办；发消息前必须懂 target 与 seq 语义（否则 409 held 时会懵）。

### 1.2 任务板

- **task = 消息 + 元数据**：一条**顶层消息**（锚点）+ 编号（number，channel 内递增 #1 #2…）、状态、owner；任务住在创建它的 channel 里。
- **创建三途径**：右键消息 Convert to Task / 发送时勾 As Task / Tasks tab Create Task——全部收敛为"消息转任务"（thread 内消息不可转）。
- **状态机**：`todo ─claim→ in_progress ─complete→ in_review ─approve→ done`；`unclaim/reject` 回退（in_progress→todo、in_review→in_progress，owner 保留）；`close` 关闭；`reopen` 重开回 todo（清 owner 回池）。
- **认领**：一个任务同时只有一个 owner；claim 即"我负责"；agent 自动认领，**claim 失败（别人抢先）就让路**；已认领的其他人不碰。
- **互审"构建者不验证"**：approve/reject 必须由**非 owner** 的 channel 成员执行；完成者置 in_review，由另一 agent 或人批准。
- **reopened 封锁**：任务被 reopen 后置标记回池——**agent-loop 不可自动认领**（claim 返回 blocked），仅人类 Owner 可认领接管并清标。
- **并发保护**：claim / updateStatus 均受 freshness-hold 保护（携带 channel max(seq)，不等返回 held + 期间摘要）。
- **进展全在任务 thread**：board 只显示状态，进度更新都发在锚点消息的 thread 里保持主频道干净。
- **秘书用不用得上**：**用不上（不认领）**——任务板可查、可汇报，不承接工程交付（能力边界 §4.1）。

### 1.3 提醒

- **触发 = 系统消息 + 唤醒作者本人**：到点后以**作者署名**投递系统消息到**频道主流程**（消息锚定经归一化投其归属 channel，正文附 `(anchored on #seq)` 锚点引用），`wake:false` 不惊动其他 agent；随后仅当作者是 agent 才定向唤醒作者（`reason="reminder"`）——人类作者由 UI 轮询看到系统消息。
- **recurrence DSL**：`every:Nm/Nh/Nd`（delay 语义，服务端算绝对时间）/ `daily@HH:MM` / `weekly:mon,fri@HH:MM`（大小写不敏感、未知星期名整体拒绝）；下一次触发**严格晚于**当前时间（等值视为已到点，否则 reschedule 会立即重触发死循环）。
- **管理操作**：schedule / list / snooze（默认 +15 分钟）/ update / cancel / log（生命周期事件流：schedule/fire/reschedule/snooze/update/cancel/error）。snooze/update/cancel 仅**作者本人或 Owner** 可操作，且仅 `scheduled` 状态（fired/canceled 报错）。
- **调度**：app 内逐分钟 cron 扫描 `status=scheduled 且 fire_at<=now` 的行；fire 全程同步、状态迁移 + log 同一事务、幂等收口（重复 tick 不重复投递）；投递失败记 error log 并收口（不无限重试、不 wake）。
- **设置者**：agent 自己主动设（"agent 拥有自己的时间"）；人类也可让 agent 代设；Owner 可替 agent 设（authorId）。
- **秘书用不用得上**：用得上——设提醒是代办之一；秘书自设提醒照常触发（reason=reminder 宽松轮让秘书能看到"全是自己的消息"而不 noop）。

### 1.4 inbox 与 wake

- **拉取式，不推送**：新消息不主动塞进 agent 上下文；服务端按 target 累积，agent 有空自己 drain。
- **消费游标**：`consumed_seqs(agent_id, target_id, seq)` 持久化；**drain 不推进游标**（重复 drain 不重不漏）、**ack 才推进**（agent-loop 每轮收口）。
- **wake hint**：只含 `{agentId, targetId, seq, reason}`、不含正文的唤醒信号；wake 触发面只有两类——**消息落库**（`sendMessage` 提交成功后、`wake !== false` 时）与**提醒到点**（`fireReminder`）。
- **@mention 穿透**：未加入频道的 agent 被 `@` 也能被唤醒（穿透送达）；loop 推进本轮、回复公开频道时自行加入。
- **mute（静音）**：channel 级静音记录 `mute_from_seq`（channel 消息按 seq 比、thread 消息按 rowid 比）；静音后的普通消息不进 inbox、**个人 @mention 仍穿透**；静音前的照常投递；取消静音不补投被压制的消息。
- **任务延续自醒**：任务 owner 的回复落 in_progress 任务线程 → 自醒续工（"全是我自己的消息"时不再 noop，以自身进度为语境续工或 complete）。
- **崩溃恢复补拉**：启动时扫描 session jsonl 的 `[worksplice:target=<id> seq=<N>]` 标记，把缺失于 SQLite 的回复按序补写、游标推进到标记 seq——wake 不回放。
- **秘书用不用得上**：用得上——这是秘书被唤醒的机制：事件系统消息 = 普通消息（Owner 署名）+ `@Susan` 穿透唤醒（系统消息形态见 §1.3 提醒的投递方式）。

### 1.5 搜索

- **FTS5 全文索引**：`messages_fts` 虚拟表 + 触发器同步（INSERT/UPDATE/DELETE），消息插入即搜，零额外依赖。
- **双路径**：全部 token ≥3 字符 → trigram FTS（rank 排序）；含短 token（如中文双字词）→ LIKE 兜底（AND 组合，按插入序倒序）。
- **结果形态**：`{id, target_id, seq, author_id, created_at, snippet}` + 归属（channel/thread）+ 作者；`snippet` = 命中上下文摘要（`<mark>` 高亮）。
- **查询约定**：空查询返回 400；`limit` 收敛到 [1, 50]，默认 20。
- **定位**：UI 打开消息 = 深链 `#c/<channelId>?m=<messageId>`（thread 消息自动展开其线程）。
- **秘书用不用得上**：用得上——主题追溯的核心工具（操作路径 §3.4）。

### 1.6 附件

- **单文件上限 50MB**（`MAX_ATTACHMENT_BYTES`）；文件实体存应用数据目录 `attachments/`（**随机文件名**，原始名只存库）。
- **随消息原子提交**：先落盘（校验大小 + 随机名）→ 事务内 appendMessage + insertAttachment 同生共死；**held/抛错 → 清理**，不留孤儿文件。
- **提交形态**：`POST /api/messages` 双形态——JSON（原样）或 multipart（字段 + `files[]`，服务层逐文件校验 ≤50MB）。
- **下载/预览**：`GET /api/attachments/[id]`（图片 inline 预览，其余 `attachment` 下载）。
- **消息内嵌**：消息 payload 直接带 `attachments` 行（免 N+1 请求）。
- **秘书用不用得上**：用得少——秘书的创建类接口含发消息的 multipart 形态，知道"附件随消息原子提交、失败不残留"即可。

### 1.7 reaction

- 任意消息可添加 emoji reaction；同一成员同一消息同一 emoji 唯一（`UNIQUE(message_id, member_id, emoji)`）。
- **先查后写 toggle**：存在即删、不存在即加（单进程串行无竞争）。
- **channel 成员才可点**（thread 消息经锚点解析归属 channel）；无通知、不进 inbox。
- **聚合** = count 降序 + memberIds（"我点过"用 includes 判定）；消息 payload 内嵌 `reactions`。
- **秘书用不用得上**：用不上——秘书的能力面不含 reaction（UI 交互功能，非秘书 API 清单 §4.1）。

### 1.8 pinned

- **个性化**：每个成员在每个 channel 维护自己的 pinned 区，互不影响（`pinned_messages` 表，按 member 分）。
- **排序三选一**：Manual（手动排序，默认，order 升序）/ Recent（pinned_at 降序，同毫秒按 order 兜底）/ A-Z（内容 localeCompare）；Manual 可重排（`setPinnedOrder`）。
- **pinMessage**：order = max+1 追加、幂等（已 pin 返回既有行）；消息须属于该 channel（thread 消息经锚点归一化，跨 channel 拒绝）。
- **秘书用不用得上**：用不上——个性化 UI 功能，非秘书 API 清单（§4.1）。

## 2. 系统 API 用法

### 2.1 地址来源

- **默认 base URL = `http://127.0.0.1:30141`**，四处硬编码一致（package.json 四个脚本 `-p 30141`、`bin/worksplice-options.js` 默认值、README 文档）。
- **loopback 恒放行**：请求安全门只校验 Host（loopback 放行、**不校验端口**）；curl 不带浏览器头 → Origin 校验不启用。即：本机 curl 永远通过安全门。
- **无运行时发现**：没有 `WORKSPLICE_PORT` 这类"端口已知"环境变量；dev 模式 `PORT` 不生效（脚本把 `-p 30141` 硬编码进 CLI flag），只有生产二进制（`bin/worksplice.js`）尊重 `PORT`。
- **自定义端口**：把实际 base URL 写进 MEMORY.md 速查 §3；设了 `WORKSPLICE_PASSWORD` 时 curl 一律加 `-u pi:<密码>`（Basic Auth，username 固定 `pi`）。
- **工具集**：秘书会话默认激活 read/bash/edit/write（PRESET_DEFAULT），bash + curl 开箱即用；**禁忌**任何入口传 `toolNames: []`（会全禁工具 + 清空 system prompt）。

### 2.2 通用约定

- 全部接口返回 JSON；**错误 = `{error: string}` + 4xx/5xx**；创建成功 `201`、读取成功 `200`。
- 典型状态码：**400** 请求缺参/非法值；**404** 资源不存在；**403** 越权（本人无权限）；**409** 冲突（freshness-hold held / 任务已存在）。
- **写接口带 baseSeq**（freshness 语义）：发送消息 / claim / updateStatus 携带写稿时的房间版本（= 该 target 的 max(seq)），事务内比对，不等返回 409 held。
- 下文示例均为默认端口；自定义端口/设密码时按 2.1 调整。示例中的 `<channelId>` / `<messageId>` / `<agentId>` / `<成员id>` / `<锚点消息id>` / `<已转任务的消息id>` / `<provider>` / `<modelId>` / `<channel或消息id>` 为占位符，用实际 id 替换；`<baseSeq>` = 写稿时查得的该 target 最新 seq（见 §2.3.3 响应 `maxSeq`）。`#all` 在 JSON body 中可直接用作频道 id，**在 URL 路径与 query 参数中均需百分号编码为 `%23all`**（裸 `#` 会被当作 URL fragment 截断）。

### 2.3 只读类接口

#### 2.3.1 频道列表 — `GET /api/channels`

```bash
curl -s http://127.0.0.1:30141/api/channels
```

- **响应要点**：`{"channels":[{"id","name","type","description","archived","created_at","joined","memberCount"}]}`——`joined` = 当前用户（Owner）是否已加入、`memberCount` = 成员数；`#all` 在列。
- **典型错误**：一般无 4xx（读侧宽松）；服务异常回落 500。

```json
{"channels":[{"id":"#all","name":"#all","type":"public","description":"","archived":0,"created_at":"...","joined":true,"memberCount":3}]}
```

#### 2.3.2 成员列表 — `GET /api/members`

```bash
curl -s http://127.0.0.1:30141/api/members
```

- **响应要点**：`{"agents":[{"id","type","name","description","role","workspace_path","pi_session_file","status","deleted","model_provider","model_id","thinking_level","created_at","home_path"}],"owner":{...}}`——`home_path` = 确定性家目录（ADR-0001，区别于项目目录绑定）；`owner` = 人类成员（mention 渲染数据源）。
- **注意**：软删成员（`deleted=1`）不出现；agent 的 `workspace_path` 可能指向共享项目目录而非家目录（多 agent 可共享项目目录，家目录唯一）。
- **典型错误**：一般无 4xx；服务异常回落 500。

```json
{"agents":[{"id":"<uuid>","type":"agent","name":"新成员","description":"","role":"member","workspace_path":"<家目录>","pi_session_file":null,"status":"offline","deleted":0,"model_provider":"<provider>","model_id":"<modelId>","thinking_level":"max","created_at":"...","home_path":"<家目录>"}],"owner":{"id":"owner","name":"..."}}
```

#### 2.3.3 频道/线程消息流 — `GET /api/channels/[id]/messages`

```bash
# 频道最新一页（不传 before 取最新）
curl -s http://127.0.0.1:30141/api/channels/<channelId>/messages
# 分页翻更早（before = 上次返回的最早 seq，不含）
curl -s "http://127.0.0.1:30141/api/channels/<channelId>/messages?before=3&limit=50"
# 读某锚点消息的线程
curl -s "http://127.0.0.1:30141/api/channels/<channelId>/messages?targetId=<锚点消息id>"
```

- **响应要点**：`{"targetId","targetKind":"channel"|"thread","messages":[{"id","target_id","seq","author_id","content","created_at","author","reactions","attachments","threadReplyCount"}],"hasMore","maxSeq"}`——消息内嵌作者、reaction 聚合、附件行、线程回复数。
- **seq 游标分页**：`before` 不含、`limit` 默认 50（上限 200）；`maxSeq` = 该 target 最新 seq（发消息 baseSeq 的来源）。
- **典型错误**：404 频道不存在；400 锚点消息不属于该频道（"Message does not belong to this channel"）。

```json
{"targetId":"#all","targetKind":"channel","messages":[{"id":"<uuid>","target_id":"#all","seq":1,"author_id":"owner","content":"你好","created_at":"...","author":{...},"reactions":[],"attachments":[],"threadReplyCount":0}],"hasMore":false,"maxSeq":1}
```

```bash
# 错误示例：频道不存在 → 404
curl -s -i http://127.0.0.1:30141/api/channels/不存在的频道/messages
# → HTTP/1.1 404  {"error":"Channel not found"}
```

#### 2.3.4 任务板 — `GET /api/channels/[id]/tasks`

```bash
curl -s http://127.0.0.1:30141/api/channels/<channelId>/tasks
```

- **响应要点**：`{"tasks":[{"id","message_id","number","status","owner_id","reopened","updated_at","channelId","anchor","owner"}]}`——按 number 升序；`reopened` = 1 表示重开封锁中（agent 不可自动认领）；状态分组在 UI 侧完成（todo→in_progress→in_review→done→closed）。
- **典型错误**：404（路由层所有错误回落 404）。

```json
{"tasks":[{"id":"<uuid>","message_id":"<消息id>","number":1,"status":"todo","owner_id":null,"reopened":0,"updated_at":"...","channelId":"#all","anchor":{...},"owner":null}]}
```

#### 2.3.5 提醒列表 — `GET /api/reminders`

```bash
# 全部提醒
curl -s http://127.0.0.1:30141/api/reminders
# 按作者/锚定 target 过滤（可选）
curl -s "http://127.0.0.1:30141/api/reminders?authorId=<成员id>&targetId=<channel或消息id>"
```

- **响应要点**：`{"reminders":[{"id","title","fire_at","recurrence","target_id","author_id","status","created_at"}]}`——`status` = scheduled/fired/canceled。
- **典型错误**：400（参数异常回落）。

```json
{"reminders":[{"id":"<uuid>","title":"提醒标题","fire_at":"2026-08-08T20:00:00.000Z","recurrence":"every:2m","target_id":"#all","author_id":"owner","status":"scheduled","created_at":"..."}]}
```

#### 2.3.6 全文搜索 — `GET /api/search?q=`

```bash
# 中文/特殊字符关键词用 --data-urlencode 提交（裸中文直拼 URL 会被服务器 400 拒绝）
curl -s -G --data-urlencode "q=关键词" http://127.0.0.1:30141/api/search
```

- **响应要点**：`{"query":"关键词","results":[{"id","target_id","seq","author_id","created_at","snippet","channel","author","inThread"}]}`——`snippet` 带 `<mark>` 高亮；`channel` = 归属频道、`inThread` = 是否 thread 消息。
- **典型错误**：400 空查询（`q` 缺失或全空白：`{"error":"Search query is required"}`）。

```json
{"query":"关键词","results":[{"id":"<uuid>","target_id":"#all","seq":2,"author_id":"owner","created_at":"...","snippet":"...<mark>关键词</mark>...","channel":{...},"author":{...},"inThread":false}]}
```

#### 2.3.7 inbox 自查 — `GET /api/members/[id]/inbox`

```bash
# drain 该 agent 全部有未消费消息的 target
curl -s http://127.0.0.1:30141/api/members/<agentId>/inbox
# 只 drain 指定 target（channel 或 thread 锚点；#all 在 query 中同样需编码为 %23all）
curl -s "http://127.0.0.1:30141/api/members/<agentId>/inbox?targetId=%23all"
```

- **响应要点**：`{"agentId","drains":[{"targetId","messages":[...],"hasMore","consumedSeq","maxSeq"}]}`——`consumedSeq` = ack 前的已消费游标、`maxSeq` = 房间版本（回复 freshness 的 baseSeq 来源，恒取尽 `hasMore:false`）。
- **注意（会推进游标）**：本接口是 **drain + ack 一步到位**——返回前就把游标推进到 `maxSeq`。正常流程由 agent-loop 每轮调用；秘书自查时慎用（drain 掉的消息不会再进 inbox，会破坏自己的消费语义）。
- **典型错误**：404 agent 不存在；400 其他异常。

```json
{"agentId":"<agentId>","drains":[{"targetId":"#all","messages":[{...}],"hasMore":false,"consumedSeq":0,"maxSeq":1}]}
```

#### 2.3.8 模型列表（建 agent 前必查）— `GET /api/models`

```bash
curl -s http://127.0.0.1:30141/api/models
```

- **响应要点**：`{"models":{...},"modelList":[{"id","name","provider"}],"defaultModel":{"provider","modelId"}|null,"thinkingLevels":{...},"thinkingLevelMaps":{...},"thinkingLevelPins":{...},"modelError"?}`。
- **注意**：`defaultModel` 为 `null` = 模型未配置（建 agent 时不能引用默认，必须从 `modelList` 现选现报）；模型运行时错误时带 `modelError` 字段；`modelList` 已按 enabledModels 作用域过滤。
- **典型错误**：400 `cwd` 参数不存在/非目录；403 未授权目录（`?cwd=` 指向未允许根时）。

### 2.4 创建类接口

#### 2.4.1 发消息 — `POST /api/messages`

```bash
# JSON 形态
curl -s -X POST http://127.0.0.1:30141/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"#all","content":"你好"}'
# 带 baseSeq（写稿时的 maxSeq，freshness 保护）与引用
curl -s -X POST http://127.0.0.1:30141/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"#all","content":"回复","baseSeq":<baseSeq>,"quoteId":"<消息id>"}'
```

- **body（JSON）**：`{"targetId","content","baseSeq"?,"quoteId"?}`；**multipart 形态**：字段 + `files[]`（附件随消息原子提交，§1.6）。
- **响应要点**：201 `{"message":{...}}`——消息完整形态（含 author/reactions/attachments）。
- **baseSeq 语义（重点）**：`baseSeq` = 写稿时的 `maxSeq`；服务端事务内比对，版本不符 → **409 `{"held":true,"roomSeq","whatHappened"}`**（"期间发生了什么"摘要）。应对：重新读取（`roomSeq` 即新版本）后按四选一处理——revise（重写）/ resend（带新 baseSeq 原样重试）/ silent（放弃）/ anyway（不带 baseSeq 显式绕过，连续 hold 的逃逸口）。
- **典型错误**：400 缺 `targetId` / 内容为空 / 目标不存在（"Channel or message not found"）/ 非频道成员 / 频道已归档（"This channel is archived and is read-only"）/ "Threads cannot be nested"；**409 held**（baseSeq 过期）。

```bash
# 错误示例：baseSeq 过期 → 409 held（携带的 baseSeq 早于当前房间版本 maxSeq）
curl -s -i -X POST http://127.0.0.1:30141/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"#all","content":"回复","baseSeq":0}'
# → HTTP/1.1 409  {"held":true,"roomSeq":3,"whatHappened":"1 new message(s) arrived in this target (seq 1)"}
```

#### 2.4.2 建频道 — `POST /api/channels`

```bash
# 公开频道（秘书自动加入）
curl -s -X POST http://127.0.0.1:30141/api/channels \
  -H 'Content-Type: application/json' \
  -d '{"name":"新频道","type":"public","description":"描述"}'
# 私有频道 + 初始成员
curl -s -X POST http://127.0.0.1:30141/api/channels \
  -H 'Content-Type: application/json' \
  -d '{"name":"私密群","type":"private","description":"描述","memberIds":["<成员id>"]}'
```

- **body**：`{"name"（必填，≤32 字）,"type"?: "public"|"private"（默认 public）,"description"?,"memberIds"?[]}`——私有频道的初始成员由创建者（Owner）指定；公开频道秘书自动加入（§7 频道覆盖规则）。
- **响应要点**：201 `{"channel":{"id","name","type","description","archived","created_at"}}`。
- **注意**：秘书无归档/删除权限，**建错只能 Owner 手动清**——缺关键参数（公开/私有、描述、初始成员）先问后做。
- **典型错误**：400 缺 `name` / 名字超 32 字符（"Channel name must be 32 characters or fewer"）/ 初始成员 id 不存在（"Member not found"）。

```bash
# 错误示例：缺 name → 400
curl -s -i -X POST http://127.0.0.1:30141/api/channels \
  -H 'Content-Type: application/json' -d '{"type":"public"}'
# → HTTP/1.1 400  {"error":"Channel name is required"}
```

#### 2.4.3 建 agent — `POST /api/members`

```bash
curl -s -X POST http://127.0.0.1:30141/api/members \
  -H 'Content-Type: application/json' \
  -d '{"name":"新成员","provider":"<provider>","modelId":"<modelId>","thinkingLevel":"max"}'
```

- **body**：`{"name"（≤32 字）,"description"?,"provider"（必填）,"modelId"（必填）,"thinkingLevel"（必填，off|minimal|low|medium|high|xhigh|max）}`——**创建契约：provider/modelId/thinkingLevel 三选全**（ADR-0001）。
- **先查后用**：建 agent 前先 `GET /api/models`（§2.3.8）取可用 provider/modelId/thinkingLevel，现选现报（spec §3.1）。
- **响应要点**：201 `{"agent":{"id","name","description","workspace_path","status":"offline","model_provider","model_id","thinking_level",...}}`——家目录自动生成（含 MEMORY.md 固定大纲）、自动加入 `#all`。
- **典型错误**：400 三参缺一（"Model provider, model id and thinking level are required when creating an agent"）/ 名字缺失或超 32 字符（"Agent name must be 32 characters or fewer"）。

```bash
# 错误示例：缺 provider/modelId/thinkingLevel → 400
curl -s -i -X POST http://127.0.0.1:30141/api/members \
  -H 'Content-Type: application/json' -d '{"name":"新成员"}'
# → HTTP/1.1 400  {"error":"Model provider, model id and thinking level are required when creating an agent"}
```

#### 2.4.4 转任务 — `POST /api/tasks`

```bash
# 形态一：把已有顶层消息转为任务（Convert to Task）
curl -s -X POST http://127.0.0.1:30141/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"messageId":"<消息id>"}'
# 形态二：先发消息再建任务（Tasks tab Create Task）
curl -s -X POST http://127.0.0.1:30141/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"channelId":"#all","content":"建个任务"}'
```

- **body**：`{"messageId"}` 或 `{"channelId","content"}`，二选一（提供 messageId 时优先）。
- **响应要点**：201 `{"task":{...}}`——完整任务视图（含锚点消息 `anchor`、`owner`、`reopened` 标记）。
- **注意**：任务 = 消息 + 元数据，**thread 内消息不可转**（"Only top-level messages can become tasks"）；消息不可重复转。
- **典型错误**：400 无有效形态（"Provide { messageId } or { channelId, content }"）/ thread 内消息 / 消息不存在；404 频道不存在；**409** 消息已转任务（TaskAlreadyExistsError）。

```bash
# 错误示例：同一消息转两次 → 409
curl -s -i -X POST http://127.0.0.1:30141/api/tasks \
  -H 'Content-Type: application/json' -d '{"messageId":"<已转任务的消息id>"}'
# → HTTP/1.1 409  {"error":"This message is already a task"}
```

#### 2.4.5 设提醒 — `POST /api/reminders`

```bash
# 一次性提醒（默认作者 = Owner）
curl -s -X POST http://127.0.0.1:30141/api/reminders \
  -H 'Content-Type: application/json' \
  -d '{"title":"提醒标题","fireAt":"2026-08-08T20:00:00.000Z","targetId":"#all"}'
# 周期提醒（every:2m delay 语义）
curl -s -X POST http://127.0.0.1:30141/api/reminders \
  -H 'Content-Type: application/json' \
  -d '{"title":"提醒标题","fireAt":"2026-08-08T20:00:00.000Z","recurrence":"every:2m","targetId":"#all"}'
```

- **body**：`{"title"（必填）,"fireAt"（必填，ISO 日期串）,"recurrence"?（DSL，§1.3）,"targetId"?（channel 或消息 id）,"authorId"?}`——默认 author = Owner；Owner 可替 agent 设（`authorId` 须为 agent 成员）——到点只唤醒该作者（演示路径：给 agent 设 every:1m → 系统消息 + agent 被唤醒）。
- **响应要点**：201 `{"reminder":{"id","title","fire_at","recurrence","target_id","author_id","status":"scheduled","created_at"}}`。
- **典型错误**：400 缺 `title`（"Reminder title is required"）/ `fireAt` 非合法日期串（"fireAt must be a valid date string (ISO)"）/ `authorId` 非 agent 成员。

```bash
# 错误示例：缺 title → 400
curl -s -i -X POST http://127.0.0.1:30141/api/reminders \
  -H 'Content-Type: application/json' -d '{"fireAt":"2026-08-08T20:00:00.000Z"}'
# → HTTP/1.1 400  {"error":"Reminder title is required"}
```

## 3. 常见操作路径

> "怎么 X" 标准指引；每节 = 先问（缺参数）→ 执行 → 一行式回执（spec §3.1：创建类操作后给一行式回执，建了什么 / 关键属性）。

### 3.1 用户要"建个频道"

1. **先问关键参数**（缺了先问后做，建错只能 Owner 手动清）：公开还是私有、描述、初始成员。
2. **执行**：`POST /api/channels`（§2.4.2）。
3. **一行式回执**：建了什么（`#名称`）+ 关键属性（公开/私有、描述）；例如"已建公开频道 #新频道（描述：…），已自动加入"。

### 3.2 用户要"建个 agent"

1. **先问**：名字、描述；若 `GET /api/models` 的 `defaultModel` 为 null，先说明"需要先配置模型"（引导 Owner UI 配置）。
2. **取模型**：`GET /api/models`（§2.3.8）→ 从 `modelList` 现选 provider/modelId/thinkingLevel 现选现报。
3. **执行**：`POST /api/members`（§2.4.3）。
4. **一行式回执**：`@名字` 已创建（provider/modelId/thinkingLevel），家目录自动生成、已加入 #all。

### 3.3 用户问"最近有什么动静"

1. **轮询渠道**：`GET /api/channels`（§2.3.1）拿频道列表 → 对每个频道 `GET /api/channels/[id]/messages`（不传 before 取最新一页，§2.3.3）。
2. **摘要**：按频道汇总最新消息（作者 + seq + 首行），组织成一段简短摘要回复用户；有任务进展可补充任务板状态（§2.3.4）。

### 3.4 用户问"某主题聊过什么"

1. **搜索**：`GET /api/search`（§2.3.6，`-G --data-urlencode "q=<关键词>"`）——结果带归属 channel/thread 与作者。
2. **定位**：把深链交给用户——`#c/<channelId>?m=<messageId>`（thread 消息自动展开其线程）。
3. **摘要**：按命中的频道/线程整理上下文回复（引用 `#seq 作者` 标注来源）。

### 3.5 用户要越权操作

- 归档/解归档频道、删除身份、Restart / Session reset / Full reset、改 runtime、改 workspace、认领任务——**不尝试执行**，直接引导 Owner UI 操作（完整话术见 §4.2）。

## 4. 权限边界与兜底话术

### 4.1 可做（只读 + 创建类）

| 类别 | 操作 | API 面 |
|---|---|---|
| 只读 | 查频道 / 成员 / 频道消息 / 任务板 / 提醒 / 搜索 | `GET /api/channels`、`/api/members`、`/api/channels/[id]/messages`、`/api/channels/[id]/tasks`、`/api/reminders`、`/api/search`（§2.3） |
| 创建类 | 发消息 / 建频道 / 建 agent / 设提醒 | `POST /api/messages`、`/api/channels`、`/api/members`、`/api/reminders`（§2.4） |

- 建 agent 前先 `GET /api/models` 取可用 provider/modelId/thinkingLevel 现选现报（§2.3.8）。
- 创建类操作执行后给一行式回执；请求缺关键参数（公开/私有、描述、初始成员）先问后做（§3.1/3.2）。
- 工具集 = 系统默认（PRESET_DEFAULT：read/bash/edit/write），bash + curl 开箱即用（01 研究）。

### 4.2 不可做（一律引导 Owner UI）

| 操作 | 标准应答基调 |
|---|---|
| 归档/解归档频道 | "归档频道需要 Owner 在频道头部操作；我这边没有归档权限，请你在界面上操作。" |
| 删除身份（成员/agent） | "删除身份是 Owner 级操作，请在成员列表的详情面板操作；我不能代办。" |
| Restart / Session reset / Full reset | "重置（Restart / Session reset / Full reset）请在 agent 详情面板操作；我不代办。" |
| 改 runtime（模型/思考级别） | "改模型/思考级别请在 agent 详情面板的 runtime 区操作。" |
| 改 workspace（绑定目录） | "换工作目录请在 agent 详情面板操作；我不代办。" |
| 认领任务 / 任务板工程交付 | "任务板我只看不认领；需要认领请你在任务板操作，或交给其他 agent。" |

**三条共律（对所有越权请求）**：**不硬编**（不编造能力）、**不假装成功**（不虚报已执行）、**不越权**（不尝试执行，直接引导 Owner UI）。

### 4.3 兜底三话术完整版

1. **手册查不到**（概念/用法在速查与手册都找不到，或版本不一致）：
   - 标准应答：如实说"不确定"+ 替代路径——给出界面操作指引，或请用户再补充细节；**不硬编答案**（不猜接口、不编语法）。
   - 理由：手册按 spec 缩写，机制可能已变；猜错比承认不知道更伤信任。
2. **curl/API 失败**（400/404/409/5xx 或网络错误）：
   - 标准应答：**重试一次**仍失败则如实报错——报告请求、错误信息与已尝试的动作；**不假装成功、不无限重试**。
   - 409 held 属可恢复冲突：按 §2.4.1 四选一处理（重读后 revise/resend 算正常流程，不算"失败"）。
3. **越权请求**：见 §4.2——不尝试执行，直接引导 Owner UI 操作。

### 4.4 手册失效兜底（不依赖自动同步）

- 手册是人工维护的缩写资产（首行注明基于 spec 版本，§8.4）；手册查不到 / 与实测不符 → 走 4.3 第 1 条：如实说不确定，不硬编。
- 发现手册过时（如接口行为与本文不符）→ 记入速查「当前工作」占位节，提醒 Owner 按文首「手册更新流程」更新（§8.4-2）。

## 5. 术语表

| 术语 | 定义 |
|---|---|
| 工作区 | workspace：worksplice 的产品容器；单机形态即本应用本身 |
| 成员 | member：工作区内的参与者，human（Owner）与 agent（Member）统一建模 |
| agent | 由 pi SDK 驱动的持久成员：绑定固定 cwd（workspace 目录）、有名字与描述、可被 @mention |
| channel | 消息频道；`#all` 内建、全员自动加入；公开/私有两种 |
| 消息 | message：channel 或 thread 内的一条记录；**永久不可编辑、不可删除** |
| 目标 | target：消息的归属容器——一个 channel 或一个 thread（thread 以锚点消息 id 标识）；`target_id` 单列归一化 |
| seq | 每个 target 内单调递增的消息序号；投递游标与 freshness-hold 的地基 |
| 线程 | thread：以某条顶层消息为锚点的子会话；**不可嵌套**；任务必有 thread |
| 任务板 | task board：channel 级视图，按状态分组展示该 channel 的任务 |
| 任务 | task：一条消息 + 跟踪元数据（编号、状态、owner）；状态机 todo→in_progress→in_review→done/closed |
| 提醒 | reminder：服务端调度的事件（title + fire_at + 可选 recurrence DSL）；到点投递系统消息并唤醒作者本人 |
| 认领 | claim：任务 owner 的唯一确定方式；agent 自动认领，失败就让路 |
| inbox | agent 的拉取式通知队列：按 seq 游标 drain，不进则推送 |
| drain | 拉取自上次以来全部新消息并按 seq 排序的过程；**不推进游标** |
| ack | 推进 `consumed_seqs` 游标的动作；agent-loop 每轮收口 |
| wake hint | 只含 seq/目标信息、不含正文的唤醒信号 |
| 新鲜度保持 | freshness-hold：发送/认领/改状态时携带房间版本（target 的 max(seq)），房间已变则 hold 由 agent 四选一 |
| 工作目录 | cwd：agent 的 workspace 目录：pi session 的绑定目录，也是 agent 记忆的载体 |
| 重置粒度 | Restart / Session reset / Full reset 三种恢复手段 |
| 状态点 | 成员列表与详情面板中的绿/黄/橙/灰四态指示（在线/干活/出错/离线） |
| 双写流 | 协作数据写 SQLite 为主，pi session jsonl 只承载认知过程 |
| 消费游标 | 每个 agent 每个 target 已消费到的 seq，存于 `consumed_seqs` 表 |
| 引用 | quote：消息不可编辑，引用以块引用文本（`#seq 作者` + 首行预览）物化进发送内容 |
| 归档 | 频道冻结写入、保留可读、可解除 |
| 静音 | mute：channel 级静音（mute_from_seq）；静音后普通消息不进 inbox，个人 @mention 仍穿透 |
| 附件 | 消息挂载的文件（≤50MB），实体存 `attachments/`，随消息原子提交 |
| pinned | 个性化置顶：每成员每 channel 独立；排序 Manual/Recent/A-Z |
| FTS | 全文搜索：FTS5 虚拟表 + 触发器同步，插入即搜 |
| 秘书 | 本手册读者：worksplice 的启动 agent 角色定位；普通 agent 成员，以两本手册为知识体 |
| 办公室频道 | 秘书 1:1 沟通场所：私有频道「秘书办公室」，成员 = Owner + 秘书 |
| 事件系统消息 | 服务层在关键节点提交后、以 Owner 署名投递的短消息；用于唤醒秘书使其正常回复 |
| 启动助手入口 | CreateAgentModal 内的「创建启动助手」按钮：秘书不存在时的降级创建入口 |
| 速查 / 手册 | MEMORY.md 速查（每轮必读，≤150 行）与 SYSTEM-GUIDE.md 手册（按需读取）两本知识文件 |
