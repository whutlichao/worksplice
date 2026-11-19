# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

两类，权重并重（本轮由产品所有者确认，不是由数据确认的——见 Evidence 的缺口）：

- **作者本人（房间的人类 Owner，日常高频使用者）**：在同一台机器上对着同一个仓库跑多个 pi 会话，把浏览器当作共享房间与任务面的操作台。要的是密度、切换成本低、状态一眼可见，长时间盯着不累。
- **首次试装的开发者**：从 `npx worksplice` 或演示模式进来，之前不知道这套语义。要的是从装完到「真的跑出一轮 agent 协作」路径短，并且不靠读文档去猜。

Agent 不是界面的使用者，而是同一房间里的另一个成员：界面上一切「agent 视角」都是给人类看的投影。

## Product Purpose

把同一台机器上多个 pi 编码会话放进同一个本地房间，并补上让房间不出错的三件事：**谁读到哪、谁能写、谁来验收**。

成功的样子是：一轮真实的 agent 协作在房间里发生（频道里出现 agent 的消息、任务真的走了状态），同时没有发生静默覆盖，也没有作者给自己盖章。

## Positioning

多 agent 共用一个仓库之前必须成立的前提，而不是「一次跑更多」或「点对点传消息」：

- **唤醒不带正文**：提示只有 `{agentId, targetId, seq}`，正文由成员自己回房间里读，所以一次无关的唤醒代价很低。
- **inbox 是持久游标，不是队列**：读不推进游标，ack 才推进；「我已经看过什么」在重启后依然成立。
- **并发写带 baseSeq**：房间先变了就 hold 这次写，作者选择修订 / 重发 / 保持沉默 / 显式绕过，而不是默默覆盖。
- **完成不是作者说了算**：任务走状态机，状态变更只由人类 Owner 或当前全局首席裁决；拖拽是服务端裁决的转移，不做乐观移动。

与并行终端管理器（回答「怎么同时跑更多」）和点对点消息层（回答「发现与传输」）处在不同层。

## Operating Context

- 单机部署：默认只监听 loopback（`127.0.0.1:30142`）；可选 `WORKSPLICE_PASSWORD` 开 Basic Auth、`WORKSPLICE_ALLOWED_HOSTS` 放行可信反代主机名；数据落在一个 SQLite 文件（数据目录 `~/.worksplice`）。
- 人类的操作面是一个三栏 shell：工作区栏 / 频道主流 / 上下文详情坞，外加弹层与命令面板。频道流、任务板、线程、提醒、搜索、agent 详情、文件浏览、模型 / 技能 / 插件配置都在同一个 shell 里。
- agent 由 agent-loop 驱动消费消息并回复，一轮有预算上限（room turn budget）与模型成本约束——「这次唤醒值不值」是真实存在的日常判断。
- 任务板是评审面：claim → 完成请求 → approve / reject → close / reopen；reopened 任务只有状态权威能接管。
- 界面双语（`en` / `zh-CN`），语言可在界面切换；落库与进模型上下文的产品内容恒为英文。
- 有移动布局（PWA 可安装），断点 1080 / 900 / 640。
- pi 配置根与模型 provider **在应用界面里**检测与配置（`/api/pi-env`、`/api/models-config`，界面是 `PiEnvNotice` / `ModelsConfig`）。

## Capabilities and Constraints

已确认的能力面：会话浏览（只读 `.jsonl`）、实时对话（SSE）、频道与 DM、任务板与完成请求、线程、提醒、inbox 游标唤醒、全局搜索、文件预览、模型 / 技能 / 插件配置、演示数据（`npm run seed:demo`）。

约束：

- **本地单机**：只监听 loopback、单 SQLite 文件；不做账号体系、云同步、多租户权限。远程访问靠可信反向代理 + Basic Auth。
- **底座是内嵌的 pi SDK**（`@earendil-works/pi-*` 作为 npm 依赖）：用户不需要自己安装或预先配置 pi，模型 provider 可以在应用界面上配置；但会话文件、配置、模型、技能都按 pi 的形态存在，worksplice 不自带 agent 运行时。
- **未决**：是否开放 pi 以外的 coding agent 底座 / adapter。当前实现只支持 pi；所有者本轮的回答澄清的是「用户不需要自己装 pi」，并未裁决 adapter 边界，因此这条保持未决，界面工作不得把它当作已定的硬前提，也不得假定它已解除。
- **技术形态**：Next.js 16 App Router + React 19；样式是手写 CSS + 设计系统 token（Tailwind 已移除，`ws-*` 只作骨架钩子）；图标只用 lucide（lucide-react），除 reaction 持久化数据外不新增 emoji。
- **视觉层已有入库裁决**（ADR-0014 形态、ADR-0015 配色）：本文件不重述其取值、不重新裁决；视觉世界的取舍由 new-work 负责。

## Brand Commitments

- 名称 `worksplice`（小写），MIT，仓库 `whutlichao/worksplice`，npm 包名 `worksplice`。
- 一句话定位（中英已定稿，见 `docs/launch-plan.md`）：pi 一次只给你一个会话；worksplice 把几个会话放进同一个本地房间，并补上让房间不出错的三件事。
- 一条必须保留的诚实说明：pi 的路线图里有 **pi server**，会覆盖一部分；worksplice 是今天就能用、本地、一个 SQLite 文件、从头到尾可读的那个版本；如果官方版本让它变得多余，那是好事。
- 已入库的视觉承诺：ADR-0014（modern-minimal 形态：小圆角 6/8/12/16、发丝边框、柔和阴影几何、首字头像 tile、三栏骨架、断点 1080/900/640）+ ADR-0015（马卡龙暖奶霜配色，每个色相族四档 fill / soft / deep / graphic）。运行时真源是 `worksplice-design-system/`（`colors_and_type.css`、`tokens.css`、`DESIGN.md`、`SKILL.md`）。
- 声音：克制的工程师口吻。不写「AI 编排平台」式的营销话术；承认重叠、限制与失败模式。
- 语言承诺：单档亮色主题，无深色主题、无主题开关（ADR-0014 / 0015 明写）。

## Evidence on Hand

- 真实界面截图：`docs/screenshots/`（channel、task-board、search、agent-panel，各含 `zh-CN` 版）、`docs/screenshots/social-preview.png`。
- 演示数据：`npm run seed:demo`、`scripts/build-demo-db.mjs`（发布包里带 `demo/`）。
- 设计系统与原型：`worksplice-design-system/`，含 1,865 行自包含原型 `worksplice-app.html` 与 `context/provenance.md`（逐值记录出处与保真度）。
- 决策、术语与机制说明：`docs/adr/0001`–`0021`、`GLOSSARY.md`、`docs/architecture.md`、`docs/traps.md`、`docs/launch-plan.md`。
- 可运行的机制证据：`lib/**/*.test.mjs`、`app/**/*.test.mjs`、`components/**/*.test.mjs`、`hooks/**/*.test.mjs`（含对比度契约 `app/globals.contrast.test.mjs` 与内容语言守卫）。
- **缺（不得编造）**：外部使用者反馈为零。GitHub 上 40 个 issue 与 200 个 PR 全部由作者本人提交，4 star、0 fork，没有外部反馈入库。因此任何对外材料都不得写用户证言、采纳率、第三方评价、团队规模或「已被 X 使用」。

## Product Principles

1. **机制在界面上可见，不靠记忆**：读到哪、谁能写、谁验收，各自有可看的状态，而不是等用户想起来。
2. **唤醒便宜、重读昂贵**：界面不奖励「重读全部」，用游标与差量表达「你错过了什么」。
3. **冲突要显形，不许静默**：被 hold 的写必须看得见、可操作（修订 / 重发 / 保持沉默 / 显式绕过）；覆盖是人的选择，不是默认。
4. **本地、单机、可读到底**：一个 SQLite 文件、loopback、无账号；可审阅性优先于托管的便利。
5. **裁决权在人**：机器可以提议，状态变更与验收留在人类 Owner（与当前全局首席）手上。

## Accessibility & Inclusion

- **可机械验证的对比度契约**（已有测试）：正文与界面文案 ≥4.5:1，图形边界（焦点环 / 状态点 / 边界）≥3:1；不得以「好看」为由放宽。
- 键盘可达：弹层开合与关闭后焦点归位、焦点环可见、不靠鼠标才能完成的动作。
- 触控目标最小 44px（`--tap-min`）；移动布局是真实使用场景，不是缩水版。
- 尊重 `prefers-reduced-motion`（现有动画处已降级）；不新增不可关闭的持续动效。
- 双语 `en` / `zh-CN` 同为受支持语言：界面文案必须走 i18n，不得硬编码任一语言。
