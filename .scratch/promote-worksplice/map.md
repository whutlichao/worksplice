# worksplice 推广地图

**Map** · 建图日期 2026-10-02 · 追踪器约定见 `docs/agents/issue-tracker.md`

## Destination

一份**可执行的推广计划**：把「两周备料 → pi Discord 首发 → 4–6 周连载」的每一步定到执行者无需再做任何决策——首发消息面、90 秒录屏脚本、一行安装路径、实测证据、渠道顺序与日历、触达名单与话术、就绪门槛与排期、反馈度量与 25-star 里程碑。

执行本身不在本图内（见 Notes「终点形态」）。

## Notes

**领域**：开源项目推广（pi 生态 → 开发者社区）。不是产品功能规划，也不是长期增长运营。

**本图已定的框架**（charting 访谈 2026-10-02 定；所有票以此为前提，不再重开）：

| 维度 | 定论 | 出处 |
| --- | --- | --- |
| 终点形态 | 只做规划：交出可执行计划，执行交给后续 session 或作者本人 | Q1 |
| 第一受众 | pi 生态的用户与扩展作者 | Q2 |
| 首发主渠道 | **pi Discord**（17,638 成员 / 3,465 在线）；pi Discussions 只做「可被搜索到的留档落点」 | Q17 |
| 范围含 | 首个 GitHub Release、一行安装路径、无 pi 演示模式（`--demo`，列第二波） | Q3 / Q7 / Q16 |
| 验收指标 | **≥3–5 个真实用户装上并给回反馈**；25 star 是 `kaushikb11/awesome-llm-agents` 的门槛，作为里程碑 | Q4 |
| 节奏 | 约 2 周备料 + 4–6 周连载 | Q5 / Q14 |
| 连载主轴 | 问题场景做骨架、机制做里子 | Q11 |
| 身份 | 纯个人开发者、第一人称（沿用 `whutlichao` 账号） | Q8 |
| 资源 | 0 预算；推广期两周 feature freeze（只修 bug + 做推广资产） | Q12 / Q13 |
| 首发不投 | HN（等 `--demo` 可用后再投） | Q18 |

**事实底座**：[research/landscape.md](./research/landscape.md)（454 行、96 个一手来源 URL、2026-10-02 实测）。任何票的结论都要挂在这份事实的具体条目上，不写建议性套话。最吃重的三条：

- pi Discussions 只启用了 `General` 一个类目，同类展示帖历史最佳 **1 条评论**；人流在 Discord。
- 12 个同类高星项目里 **10/12 有「一行安装」、0/12 有在线 demo**；「从源码跑」正面违反 Show HN 官方规则。
- 官方自家同类协作层 `earendil-works/pi-chat` 停在 **404 star、停滞 4 个月**——品类需求真实，采纳很难。

**每个 session 该读什么**：需要外部事实 → `research`；要把决策谈清楚 → `grilling` + `domain-modeling`；要把模糊讨论变成可反应的具体物 → `prototype`。

## Decisions so far

<!-- 每个已关闭的票一行：gist + 链接，细节只在票里 -->

- [01 landscape 调研：渠道与入场券的外部事实](./issues/01-landscape-research.md)：人流在 pi Discord（17,638 人）而非 Discussions（同类帖最佳 1 评论）；入场券是「一行安装」（同类 10/12）而非发帖；HN 默认 1 分且「从源码跑」违规；立刻够格的收录位只有 2 个，HelloGitHub 无 star 门槛。
- [02 首发消息面](./issues/02-launch-message.md)：定位句 =「pi 一次只给你一个会话；worksplice 把几个会话放进同一个本地房间，并补上谁读到哪 / 谁能写 / 谁来验收」；主打场景 = 并发写裁决（开场借任务板）；对比口径 = 分层点名（agent-chat + 泛类并行管理器，不点 pi-chat）+ 匿名维度对照表 5 行。
- [04 一行安装与无 pi 演示模式](./issues/04-one-line-install.md)：`--demo` 在无 pi／无 key 的机器上**实测可行**（Ready in 99–114ms，演示现场完整）；首发一行安装 = Release 挂 `npm pack` 产物（实测 5.7MB 包、URL 安装 15.7s、`npx --yes <URL>` 走通、无需发布 registry）；`npm exec github:` 被证伪；现在就出 `v0.1.0`。
- [07 渠道顺序与发布日历](./issues/07-channel-sequence.md)：锚点 **D-day = 2026-10-16**；D-3 静默提两个 Awesome 清单、D-2 发 Discussions 留档帖、**D-day 只打 pi Discord 自包含长帖**、D+2 投 HelloGitHub（赶 10-28 期）、D+2~D+7 发 V2EX `/go/create`、第 2–6 周掘金 1–2 篇技术文；Discord 48h 零实质回应即触发私聊 Plan B；作者无任何现成受众阵地。
- [05 实测证据](./issues/05-evidence-run.md)：**hold 成立（协议 + 真实运行双重证明），但 revise 分支在生产接线下失败**——revise prompt 在 `prompt_done` 后立刻发出，pi SDK 报 `Agent is already processing`，4 次运行全复现；互审（构建者不验证）已确定性证明；证据包与「可公开性判定」（`part-b-session.jsonl` 必须脱敏）落在 [evidence/](../evidence/README.md)。
- [11 revise 缺陷决策](./issues/11-revise-defect-decision.md)：**保留 revise 并把它「坏了 → 修好」的全过程写进内容**；修复**已合并进 main**（[PR #67](https://github.com/whutlichao/worksplice/pull/67) → `5f74cad`，`waitForSessionIdle` + 两条回归测试，40/40 绿）并端到端验证（重跑拿到 `[worksplice:revision]`、`round_logs=replied`）；票 09 硬项剩下一半「Release 构建里重跑」。
- [03 录屏分镜](./issues/03-screencast-script.md)：**90 秒 / 10 镜 / 纯字幕 / 16:9** 的分镜与「照着就能录」的 recipe 已定稿；关键约束是 **hold 在 UI 里不可见**（成功 revise 的轮次结论与普通回复同为 `replied`），所以核心 60 秒靠「她回复的正文」＋「会话文件里的 revise prompt 原文」立住；`part-b-session.jsonl` 不得入镜（含本机路径）。
- [06 真实用户](./issues/06-real-users.md)：判定标准两条线（**反馈数**（含「装不上」）验收 / **有效用户数**讲故事，star 不算）；反馈入口 = 一个**故意做短**的 `tried-it` issue 模板 + 中英 README 在「用演示数据试试」末尾的邀请（**不开 Discussions**）；触达 = 先展示、愿为前 3 人陪跑；**23 人名单（优先 12 人，nicobailon / tristone13th / Hyselens-Helektra 居首）**落在 [research/outreach-list.md](../research/outreach-list.md)，附 6 条有原文的纪律（⛔ 绝不去 pi tracker 发 issue/PR；✅ 走对方仓库；⚠️ Show & tell 非获客渠道）。
- [12 npm 提前到首发](./issues/12-npm-first-wave.md)：**首发就 `npm publish`，但不加 `pi-package` 关键词**。核实推翻了立票前提——官方画廊的收录条件就是该关键词（pi 文档原文），而 worksplice 不是 pi 定制包，加了也只会让用户 `pi install` 后发现装不出东西；**画廊收录不作收益**。收益回到实打实的：README 首行变 `npx worksplice` + npm 搜索；Release 资产照旧并存。
- [13 与 pi 官方的距离](./issues/13-pi-official-distance.md)：① **主动交代 pi server**（一句话放长帖的「诚实说明」段，不放开场）；② D-2 的 Discussions 帖**保留但改成纯技术留档、零请求**；③ 触达纪律**写死**为「只走对方仓库与私聊，绝不去 pi tracker」（封号条款是账号级、不可逆）。
- [09 首发就绪门槛与排期](./issues/09-readiness-gate.md)：**D-day 钉死 2026-10-16（周五）**，备料 D-7（10-09）→ D-1（10-15）；**9 条产品/分发硬项**（含「`--demo` 不得触发 agent 轮次」「Release 构建里重跑出 `[worksplice:revision]`」）＋ 3 条文案 ＋ 2 条触达 ＋ freeze（10-06 → 10-19）；里程碑 M1（D+14 star≥25 → 提 awesome-llm-agents）/M2（D+7 反馈≥1）与失败判据 F1（48h 零回应→私聊）/F2（D+21 反馈<3→停连载全力一对一）/F3（D+42 仍<3→判定没打中，回地图开新一轮）；**作者已授权备料期可代做项开工提 PR**。
- [08 连载选题表](./issues/08-series-outline.md)：**5 周**弧线（W1 首发 → W2 失败报告 → W3 唤醒/游标 → W4 hold 深挖 → W5 互审＋成本收尾）；每篇 = **仓库长文 + Discord 短帖引流**（Discord 单条 2000 字符放不下长文）；**掘金改写 W2 与 W4**；§6 深模块与同行对比不单独成篇；分工 = 我画三张图并拆写 W3–W5，作者导出真实 token/成本数字供 W5；与 F2 联动（触发则 W5 不新增产出）。
- [10 汇编《推广计划》](./issues/10-plan-assembly.md)：**决定放两份**——[`docs/launch-plan.md`](../../docs/launch-plan.md)（公开安全版，tracked）＋ [`plan-private.md`](./plan-private.md)（触达名单与逐人判断、真实期望量级、F1 动作序列；不进版本库），用对账规则防止两份正文漂移。**v1 已交付**，三处 `⏳` 待作者完成 A2/A3/A8 后改状态定稿。

---

**地图状态（2026-10-03）：13 张票全部关闭，前沿为空——路已经铺到可以照着走。** 剩下的全是执行：作者的四项待办（Release / npm 发布 / 录屏 / 进 Discord 潜水）与备料检查单里的 `⏳`；执行进度以 [`docs/launch-plan.md`](../../docs/launch-plan.md) §4 的检查单为准，不再回这张图。

## Not yet specified

<!-- 在范围内、但还说不成一张票的雾；随前沿推进再毕业 -->

- **HN 的投递时机**：Q18 只定了「首发不投」，等 `--demo` 落地后才有可投的形态；投哪个标题、什么时间发，现在无法定形。
- **Reddit**：landscape 拿不到一手数据（官方 JSON 403），是否投、投哪个版，需要先拿到规则或先实测一次。
- **首发零回响的 Plan B（48h 之后）**：票 07 只钉了触发条件（Discord 主帖 48h 零实质回应 → 启动票 06 的私聊名单）；若私聊也无效，是换渠道重发、改叙事重发，还是转纯文档自传，取决于首发结果。

## Out of scope

<!-- 超出目的地的工作；永不毕业 -->

- 长期社区运营、贡献者体系、自建 Discord/论坛（超出「打进首批真实用户」这个目的地）
- 为进入 pi 官方画廊而补做一个**真正的 pi package**（扩展/skill）——那是产品活，本图只负责把**现在这个**东西推出去（[票 12](./issues/12-npm-first-wave.md) 已把这条排除在首发收益之外）
- 从零经营新的社交阵地（X、小红书、公众号、B 站等）——作者无任何现成受众，从零涨粉不属于本目的地
- 商业化、托管服务、账号体系（README 已明确不做）
- 支持 pi 以外的 agent 运行时（受众已定为 pi 生态）
- GitHub Trending 优化（官方从未公开算法，见 landscape「渠道效率证据」第 4 节）
- 少数派 / 即刻 / 小红书 / 微信公众号（本轮无任何一手规则或真实转化数据；若日后拿到规则再作为新 effort）
