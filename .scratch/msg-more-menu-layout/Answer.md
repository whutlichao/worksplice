# Answer：`···` 二级菜单（消息动作栏）布局收口

## 结果

消息 hover 动作栏里的 `···` 二级菜单恢复成规矩的竖排列表：每项一行、图标在文字左侧、左缘对齐、
项与项不重叠；面板完整包住全部 N 项、四边内边距均匀、宽度容得下最长标签且不换行、不溢出视口。
改动只落在本仓扩展层：`app/globals.css` 的 `.msg-tools` 段落新增一条菜单项规则，
`components/ChannelView.tsx` 的 `MessageMoreMenu` 去内联几何、挂专属 class。

## 根因与实现

`app/globals.css` 的 `.msg-tools button` 是从上游 `worksplice-design-system/ui_kits/app/app.css`
逐字 port 的**图标键**几何（`width:26px; height:24px; display:grid; place-items:center`）。
它是**后代**选择器，票 16 把菜单嵌进 `.msg-tools > span > div[role="menu"]` 之后，连带命中菜单项。
浏览器实测（`evidence/probe-before.log`）逐条对上用户的截图：

| 现象 | 实测（改前） | 成因 |
| --- | --- | --- |
| 「添加回应」图标单独占一行压在文字上方 | 项高 24px、`svg.top` 与文字 `span.top` 差 **21px**、`svg.left > span.left` | `display:grid` + `place-items:center` 把「图标 + 文字」排成两行并居中 |
| 各菜单项互相重叠 | 项 `scrollHeight > clientHeight`（两行内容塞进写死的 24px，溢出可见） | `height:24px` 写死 |
| 最后一项掉在面板外 | 面板 `scrollHeight 95 > clientHeight 84` | 面板高度按 N×24px 算，装不下真实内容 |
| 长标签贴边 | 左边距只有 `.btn-sm` 的 9px、无 `nowrap` 契约 | 菜单项没有自己的内边距/字号策略 |

修法（Chromium 的层叠规则当判据，不靠猜）：port 的两条规则**声明体一字未动**（本仓只叠扩展层），
改为给菜单项一条**更高特异度**的本仓局部规则 `.msg-tools .msg-more-menu-item` —— (0,2,0) 打得过
`.msg-tools button` 的 (0,1,1)（`.btn` / `.btn-sm` 的 (0,1,0) 打不过，这正是「加了 class 也没修好」的原因）。
规则把泄漏的几何收回：`display:flex; align-items:center; justify-content:flex-start;
width:100%; height:auto; padding:5px 8px; gap:8px; white-space:nowrap; text-align:left`。

组件侧删掉与之打架的内联 `itemStyle`（内联 `width:100%` / `justify-content:flex-start` 按内联胜出、
port 的 `display:grid` / `height:24px` 按特异度胜出，两套几何并存就是重叠的直接成因），
按钮改为 `className="btn btn-ghost btn-sm msg-more-menu-item"`；面板宽度补 `width:"max-content"`
与 `minWidth:190` 共存——触发器只有 26px 宽，纯 `minWidth` 会把绝对定位的收缩宽度钉死，
nowrap 的长标签只能溢出面板。

## 红→绿

反馈回路（`diagnosing-bugs` 阶段 1）是**真实浏览器几何探针**，不是「跑通不报错」：
`.scratch/msg-more-menu-layout/probe-before.ego.mjs`（ego-browser 驱动真实 Chromium）打开频道、
hover 一条消息、点 `···`，逐条断言票面 5 条要求，`verdict` 非 GREEN 时退出码 1。

- **红**：`evidence/probe-before.log`（改动前）→ `RED`，13 条失败：项高 24 < 26、图标与文字 top 差 21px、
  图标不在文字左侧、面板 `scrollHeight 95 > clientHeight 84`、每项内容溢出自身盒子。
- **绿**：`evidence/probe-after.log`（改动后）→ `GREEN`，`failures: []`：项高 28、top 差 −2.5px、
  图标在文字左侧、面板 `scrollHeight 96 = clientHeight 96`、最后一项 298.18 ≤ 面板内边距线 299.18、
  无换行、无溢出。另跑 4 项形态（含「转为任务」，`evidence/probe-after-4-items.log`）同样 `GREEN`：
  面板 128px 高、`scrollHeight 126 = clientHeight 126`、最后一项 320.03 ≤ 321.03。

截图（同一频道、同一条消息、同一位置）：`evidence/before.png`（图标各占一行、项压在一起、面板截断）
→ `evidence/after.png`（一行一项、图标在左、面板完整包住）。

隔离实例：`WORKSPLICE_DATA_DIR=/tmp/ws-more-menu-w1/data node scripts/seed-demo.mjs` + `next dev -p 30177`，
全程未触碰 `~/.worksplice`（用户 dev server 的 30142 未被动过）。

落盘回归测试（先红后绿，红在隔离基线 worktree 上取证）：

- `evidence/tests-red.log`：把**只含新增测试**的两份测试文件放到 base commit `155f883` 的独立 worktree 上跑
  `node --test components/ChannelView.test.mjs components/message-stream.test.mjs app/globals.test.mjs`
  → `tests 96 / pass 94 / fail 2`，两条新测试红：`缺少规则 .msg-tools .msg-more-menu-item`、
  `菜单项需要专属 class…：<button … class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;…">`。
- `evidence/tests-green.log`：改动后同一条命令 → `tests 96 / pass 96 / fail 0`。

两条测试锁住的事实：① port 的 `.msg-tools button` 声明体仍与上游逐字一致（泄漏源不被偷偷改写）；
② `.msg-tools .msg-more-menu-item` 的特异度真的大于 `.msg-tools button`（测试里算了特异度三元组，
不是断言字符串）；③ 渲染出的每个 `[role="menuitem"]` 都带专属 class 且不再内联 `width` / `justify-content` / `gap`。

## 质量门禁

| 检查 | base `155f883` | 本票 head `d75c07a` | 结论 |
| --- | --- | --- | --- |
| `node_modules/.bin/tsc --noEmit` | exit 0（`evidence/tsc-baseline.log`） | exit 0（`evidence/tsc.log`） | 0 新增 |
| `npm run lint` | 0 errors / 1 warning（`evidence/lint-baseline.log`） | 0 errors / 1 warning（`evidence/lint.log`） | 0 新增；同一条既有 `hooks/useI18n.tsx:61 react-hooks/exhaustive-deps` |
| `npm test` 全量 | `tests 1610 / pass 1609 / fail 1`（`evidence/tests-baseline-full.log`） | `tests 1612 / pass 1611 / fail 1`（`evidence/tests-full.log`） | +2 为本票新增测试；**无新增失败** |

基线口径：`evidence/tests-baseline-full.log` 与 `evidence/lint-baseline.log`、`evidence/tsc-baseline.log`
均在 base commit `155f883adc6481ae3f7038df305fffdd448d1809` 的独立 `git worktree` 上取得（node_modules 用软链复用），
取证后已 `git worktree remove`。唯一失败是既有环境相关用例
`lib/model-listing.test.mjs:50 lite path returns a working runtime without loading extensions`
—— 它在 base commit 上同样失败（读本机模型配置，与本票无关），本票未触碰该文件。

## 交付物

- 分支：`msg-more-menu-layout`
- 实现提交：`d75c07a fix(msg-menu): 收口 ··· 二级菜单项几何，不再吃动作栏图标键样式`
- 改动文件：`app/globals.css`、`components/ChannelView.tsx`、`components/message-stream.test.mjs`、
  `components/ChannelView.test.mjs`
- 本票证据与探针：`.scratch/msg-more-menu-layout/`（Answer / pr-body / probe-*.ego.mjs / evidence/*）
- PR：**#205** https://github.com/whutlichao/worksplice/pull/205（body 落在 `.scratch/msg-more-menu-layout/pr-body.md`）
- 提交：`d75c07a`（修复 + 回归测试）、`144b04a`（Answer / 探针 / 证据）、本条（回填 PR 号）
- `git status --porcelain` 为空；分支已推 `origin/msg-more-menu-layout`

## review

按票面省略双轴 `code-review`：改动面可圈定（单组件菜单 markup + `app/globals.css` 一条本仓扩展规则 +
两份组件测试），不触达数据层 / 协作域 / 路由 / 共享类型 / 构建配置，也没有其他模块依赖这段样式；
`git diff --stat` 确认改动仅落在 Ownership 的 4 个文件（+111 / −10）。

## 遗留 / 观察（不在本票改）

1. **`moreOpen` 未参与揭示钩子**：`.ws-message-actions-open` 只跟 `reactOpen` 走，`moreOpen` 没接进去。
   目前没观察到可见缺陷——菜单开在行内，指针移到菜单上仍是行 hover；键盘打开时 `useEffect` 会聚焦首项，
   `.msg:focus-within` 继续揭示外壳。属于「两条揭示路径不完全对称」，登记待后续票统一。
2. **菜单项左边距 9px → 8px**：`.btn-sm` 的 `padding: 0 9px` 被本仓规则覆盖成 `5px 8px`。视觉无差别，
   但几何来源从此单点（CSS），若将来要统一按钮内边距需一起看。
3. **已转任务的消息只有 3 项**：`canConvertToTask` 门控让它没有「转为任务」；证据里 3 项与 4 项两种形态都验过。
4. 本票未跑 `next build`（仓库纪律：dev 期间禁跑）、未写 `~/.worksplice`、依赖只用 `bun install --frozen-lockfile`。
