# 09 — 首发就绪门槛与排期（含 25-star 里程碑与失败判据）

**Type:** grilling
**Blocked by:** 02, 03, 04, 05, 06, 07, 11, 12, 13
**Status:** resolved

**输入（来自已关闭的 [07 渠道顺序](./07-channel-sequence.md)）**：日历锚点 **D-day = 2026-10-16（暂定，本票钉死）**，备料窗口 = **D-7 → D-3**；D-3 之后紧接着是静默提清单（D-3）、留档帖（D-2）。本票的排期表必须与这条前向时间线一致，并把「Release + `--demo` + README 改写」排进 D-7 → D-3。

**输入（来自已关闭的 [05 实测证据](./05-evidence-run.md)）**：检查单必须包含一条**revise 路径的真实可用性**判据——要么重跑 05-B 拿到 `[worksplice:revision]` 标记且该轮 `round_logs=replied`，要么叙事已按 [票 11](./11-revise-defect-decision.md) 的结论改写（不再主张 revise）。

**输入（来自已关闭的 [11 revise 缺陷决策](./11-revise-defect-decision.md)）**：该判据已定为**硬项**——[PR #67](https://github.com/whutlichao/worksplice/pull/67) 已合并（✅ 2026-10-03，`5f74cad`）**且** 在 D-day 的 Release 构建里重跑证据 B 拿到 `[worksplice:revision]`（建议跑 2–3 次，免费模型有随机性）。「合并了」不等于「发布的构建里是好的」。

**输入（来自已关闭的 [12 npm 提前](./12-npm-first-wave.md) 与 [13 pi 官方距离](./13-pi-official-distance.md)）**：检查单要加上——③ `npm publish` 完成且 `npx worksplice` 在干净环境实测可用（README 首行据此写）；④ pi Discussions 的留档帖已改成**纯技术留档、零请求**版本；⑤ 首发长帖含**pi server 的分工那一句**（放在诚实说明段）；⑥ 触达清单只走对方仓库与私聊（**不得出现任何发往 `earendil-works/pi` 的 issue/PR**）。

## Question

Q9 定的门槛是「Release + 三分钟路径 + 录屏 + 对比表 + 实测证据文（约两周）」。要把它变成一张可勾选的检查单，并回答四个问题：

1. **硬门槛逐项的可验收判据**：每一项怎么算「就绪」——例如「一行安装在干净机器上跑通」而不是「我觉得差不多了」。
2. **两周备料的排期**：哪天做什么；**feature freeze（Q12）从哪天开始、到哪天结束**（当前 main 上 30 天 175 个 commit，冻结这件事需要有明确起止）。
3. **25-star 里程碑**：`kaushikb11/awesome-llm-agents` 的门槛是 25 stars，达到即提交。它挂在哪一周复盘、若未达到怎么办（是继续连载，还是转 Plan B）。
4. **失败判据**：首发后第几天、看到什么信号就算「这一发没打中」，触发 map 里「首发零回响的 Plan B」那条雾。

**产出**：一张可勾选的首发检查单 + 备料排期表 + 里程碑与失败判据。

## Answer

2026-10-03 谈定。**D-day 钉死为 2026-10-16（周五）**；备料窗口 D-7（10-09）→ D-1（10-15）。

### 1. 首发检查单（每条都是可验收判据，不是感觉）

**A · 产品与分发**

- [ ] **A1 `--demo` 可用**：在**无 pi 配置、无模型 key** 的干净环境跑 `npx worksplice --demo`，启动后频道列表出现 4 个频道、任务板出现 14 个任务（判据来源：票 04 的实测）。演示模式**不得**触发 agent 轮次或自动建秘书（否则会改演示现场、并且在用户机器上烧 token）。→ **✅ 已提 [PR #68](https://github.com/whutlichao/worksplice/pull/68)**（真实 HOME 下实测 `round_logs=0`、`~/.worksplice` 未被触碰）
- [ ] **A2 Release 资产**：`v0.1.0` tag + GitHub Release，资产 = `npm pack` 产物（5.7MB）；`npx --yes <资产 URL>` 在干净目录实测可用。→ **✅ 2026-10-03 完成**（[v0.1.0](https://github.com/whutlichao/worksplice/releases/tag/v0.1.0)；资产在干净目录装起来跑出 4 频道/40 消息/14 任务/`round_logs=0`）
- [ ] **A3 npm 发布**：`npx worksplice` 在干净环境实测可用；**不加 `pi-package` 关键词**（票 12）。→ **✅ 2026-10-03 完成**（`worksplice@0.1.0`，`npx --yes worksplice@0.1.0 --demo` 实测通过）
- [ ] **A4 revise 硬项**：在 **Release 构建**里重跑证据 B **2–3 次**，拿到 `[worksplice:revision]` 且该轮 `round_logs=replied`（票 11；「合并了」不算数）。 → **✅ 2026-10-03 完成**（Release 资产装出来的那份跑 4 次，4 次出 revise prompt，3 次确认 `round_logs=replied(base_seq=2)`；房间可读出「草稿未落库、改稿回复在 #3」）
- [ ] **A5 README 中英双改**（两版章节结构必须仍对齐）：首段换票 02 的定位句；Quick Start 首行 = `npx worksplice`；demo 段改成 `--demo`；「用演示数据试试」末尾加票 06 的邀请语。→ **✅ 已提 [PR #70](https://github.com/whutlichao/worksplice/pull/70)**（层级序列与条目数已逐项对齐；待 `npm publish` 与 #68 就绪后再合）
- [x] **A6 反馈入口**：`.github/ISSUE_TEMPLATE/tried-it.md` 就位 + `feedback` 标签已建。→ **✅ [PR #69](https://github.com/whutlichao/worksplice/pull/69)**，标签已创建（`#0e8a16`）
- [ ] **A7 对比表**：票 02 的 5 行匿名维度表成为 README 的一节（或独立卡片图）。→ **✅ 已随 [PR #70](https://github.com/whutlichao/worksplice/pull/70) 成为 README 的「与其他工具的关系」一节**（卡片图仍可另做，用于 Discord 长帖）
- [ ] **A8 90 秒录屏**：按票 03 的 10 镜分镜、纯字幕；第 5–8 镜为真跑；另补 3 张静态截图。
- [ ] **A9 实测证据文**：含「坏了 → 定位 → 修好 → 回归测试」全过程（骨架见票 05 §5）。→ **✅ 已提 [PR #72](https://github.com/whutlichao/worksplice/pull/72)**（《A Held Write That Never Got Revised》+ 三个复现脚本入库）

**B · 文案**

- [ ] **B1 首发长帖**：痛点开场 → 三条语义 → 录屏 → 一行安装 → 设计长文链接 → **pi server 分工那一句**（放诚实说明段，票 13）。→ **✅ 已提 [PR #71](https://github.com/whutlichao/worksplice/pull/71)**（主帖 1590 + 续帖 1329 字符，卡在 Discord 2000 上限内）
- [ ] **B2 Discussions 留档帖**：纯技术、零请求、不 @ 任何人（票 13）。→ **✅ 同上 PR**（已删掉「Happy to answer questions」类邀请）
- [ ] **B3 两个 Awesome 清单的提交文案**：按各自模板（`awesome-ai-agents` 走 issue 表单）。→ **✅ 已提 [PR #73](https://github.com/whutlichao/worksplice/pull/73)**（含一个判断：第二个清单**不建议直接提 PR**——它的每个条目都嵌着维护者自家产品的推广块与 CTA，改成开 issue 提供内容）

**C · 触达与反馈**

- [ ] **C1 名单就位**：优先 12 人 + 每人一句切入点（[research/outreach-list.md](../research/outreach-list.md)）；话术三段式；**纪律：只走对方仓库与私聊**。
- [ ] **C2 陪跑承诺兑现准备**：预留出前 3 个人的陪跑时间。

**D · 纪律**

- [ ] **D1 feature freeze 生效**：10-06 → 10-19，只修 bug + 做推广资产。
- [ ] **D2 红线自查**：**没有任何发往 `earendil-works/pi` 的 issue/PR**。

### 2. 备料与发布排期（本地日期，CST）

| 日期 | 动作 | 谁能做 |
| --- | --- | --- |
| 10-03 → 10-08 | pi Discord 潜水：确认频道与自荐规则、答 2–3 个问题 | 只有作者 |
| 10-06（一） | **feature freeze 开始** | — |
| 10-09（D-7 五） | A1 `--demo`、A5 README、A6 模板与标签 | 我可代做（PR） |
| 10-10（D-6 六） | A2 Release + `npm pack` 资产；**A3 `npm publish`** | 只有作者（npm 2FA） |
| 10-11（D-5 日） | **A4** 在 Release 构建里重跑证据 B ×2–3 | 我可代做 |
| 10-12（D-4 一） | A8 录屏（预留 3 次重跑）+ 补静态图 | 只有作者 |
| 10-13（D-3 二） | B3 静默提两个 Awesome 清单 | 作者（需你的账号） |
| 10-14（D-2 三） | B2 留档帖；A9 证据文定稿 | 你发帖 / 我可代写 |
| 10-15（D-1 四） | A7 对比表成品；B1 长帖定稿 | 我起草，你定稿 |
| **10-16（D-day 五）22:00 CST** | **pi Discord 主帖**（= 10:00 美东 / 16:00 中欧；**此时间点无一手数据，属启发式，可改**） | 只有你 |
| 10-18（D+2 日） | HelloGitHub 提交（赶 10-28 期） | 你 |
| 10-19（一） | **freeze 结束**（整两周）；10-19→10-24 之间发 V2EX `/go/create` | 你 |
| 第 2–6 周 | 每周一篇连载（票 08 定）+ 一对一触达 | 混合 |

### 3. 里程碑与失败判据

| 代号 | 时间 | 触发条件 | 触发后做什么 |
| --- | --- | --- | --- |
| **M1** | D+14（10-30） | star ≥ 25 | 立刻提交 `kaushikb11/awesome-llm-agents`（其硬门槛） |
| **M2** | D+7（10-23） | 反馈数 ≥ 1 | 未达标则**立刻**启动名单一对一触达 |
| **F1** | D+2（10-18 末） | Discord 主帖 **48h 零实质回应** | 启动私聊名单（票 07 已定） |
| **F2** | D+21（11-06） | 反馈数 < 3 | **停连载产出**，把全部精力切到一对一触达（内容只改写已有，不新增） |
| **F3** | D+42（11-27） | 反馈数仍 < 3 | 判定「这轮没打中」→ 回地图开新一轮（改定位或换受众），**不再加大投入** |

### 4. 分工与授权（HITL 确认）

作者已授权：**备料期里可代做的项目现在就开工、逐项提 PR**（`--demo`、README 改写、`tried-it` 模板、Release 构建与 A4 重跑、证据文与帖子草稿）；只有作者能做的三项：**npm 2FA 发布、进 Discord 潜水与发帖、录屏**。

### 5. 未决与风险

- **首发时刻（22:00 CST）无一手数据**：Discord 没有历史帖子数据可查，这是按大西洋两岸作息推的启发式；若首发当天观察不理想，可在 D+3 用不同时段补发一条更新帖。
- **A4 依赖免费模型的随机性**：2–3 次重跑里若一次都没拿到 `[worksplice:revision]`，按票 11 的兜底——改叙事，不再主张 revise。
- **Discord 盲区**：名单覆盖不到 Discord 里的多 agent 用户（票 06 已记录）；10-03→10-08 的潜水是唯一的补课机会。
