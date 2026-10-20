# 01 — 看板创建任务后频道消息流看不到任务创建事件

## Parent

用户现场反馈（#showcase，2026-10-20）：用「Tasks tab → Create Task」建 Task #2 后，频道主序列看不到
「Task #N created — <preview>」这条静态提示。coordinator 只读核查确认 live 库里 seq 12（锚点）与
seq 13（事件消息）都在，要求先复现、再定位；有真实失败才修。

## What to build

复现并定位「任务创建事件消息在频道消息流不可见」；确认三途径（看板 Create Task / 右键 Convert to Task /
发送勾 As Task）后事件消息都能以静态 note 呈现在频道主序列，且刷新后仍在、不可 hover/点击转任务。
隔离环境无法复现时不猜测性改代码，交 coordinator 与用户确认下一步。

## Blocked by

None

Status: resolved
Type: task

## Acceptance criteria

- [x] 隔离环境起 dev server（自选端口 + `WORKSPLICE_DATA_DIR` 指向 live DB 只读副本），场景 A（live 数据
      回放 #showcase）确认 `GET /api/channels/<id>/messages` 与 DOM 中都出现 seq 13 的「任务 #2 已创建」note。
- [x] 场景 B（干净频道看板 Create Task）：`POST /api/tasks` 响应、`GET messages` 含事件消息、不刷新时
      消息流 DOM 在 ≤1 个轮询周期内出现静态 note、刷新后仍在 —— **四项全部成立**。
- [x] 场景 C（右键 Convert to Task、发送勾「作为任务」）：同样四项成立（纯轮询路径 ≤1 个周期内出现）。
- [x] note 为静态呈现：`role="note"`，无 button/a、无 hover 动作、不可转任务。
- [x] 基线复核：在用户实际运行时范围内的 pre-#190 worktree（`21878b9`）上重放同一份 live 数据，note 同样渲染。
- [x] `node_modules/.bin/tsc --noEmit` exit 0；`npm run lint` 0 error（1 个既存 `hooks/useI18n.tsx:61` warning）；
      `npm test` 1551 tests / 1550 pass / 1 fail（唯一失败为环境相关的 `lib/model-listing.test.mjs`，基线同样失败）。
- [x] 结论 + 证据落本 Answer（**未复现失败 ⇒ 无红→绿改动，无代码变更**）。

## Answer

**结论：HEAD（`09a9a58`）与用户运行时范围内的基线（`21878b9`）都无法复现「事件消息看不到」。**
三途径的事件消息都按既有语义落库、返回、并在频道主序列以静态 note 渲染；刷新后仍在；note 不可交互。
因此本票不改代码 —— 没有真实失败可供修，按票据约定「不猜测性改代码」。

### 排查路径

隔离纪律：`WORKSPLICE_DATA_DIR` 指向 `cp ~/.worksplice/worksplice.db*` 出来的副本，
`WORKSPLICE_DEMO=1` 关闭 agent-loop（避免真实模型调用与 token 消耗）；live 数据目录全程未写
（未连 live 服务：打开频道会 POST `/read` 写 `channel_reads`）。

1. **服务端事实**：`GET /api/channels/814f48c1-…/messages?limit=50` 返回 15 条，含 seq 13
   `Task #2 created — 分析中国A股走势`；content 的破折号是 U+2014，与
   `components/ChannelView.tsx` 的 `parseTaskCreationEvent` 正则逐字匹配；事件消息不是任何任务的锚点，
   因此不会被「锚点渲染」分支接管。
2. **场景 A（live 回放）**：DOM 有两条 note（`任务 #1 已创建…` / `任务 #2 已创建 分析中国A股走势`），
   计算样式 `display:flex` / `visibility:visible` / `opacity:1`，尺寸 880×32；刷新后仍在。
   但**页面加载时滚动停在底部，该 note 距视口 2303px** —— seq 14（2224 字）与 seq 15（1898 字）两条长回复
   把它顶出视野，往上滚即可见。
3. **场景 B（干净频道 + 看板）**：`POST /api/tasks` → 201；`GET messages` → seq 3 事件消息；
   切回「消息」tab 后 note 立即在 DOM；300ms/1200ms/3000ms/5500ms 四个采样点稳定存在，0 个可交互子元素。
4. **场景 C（另两条入口）**：外部客户端 `POST /api/tasks`（只能经 3s 轮询到达）与右键「转为任务」
   都在 ≤1 个轮询周期内出现；发送勾「作为任务」在 Enter 后 129ms 出现。刷新后仍在。
5. **基线复核**：live DB 里 MattDev 对 seq 13 的回复落在**频道**（seq 14），而 HEAD 的
   `resolveTaskReplyRoute`（PR #190）对「最新一条是 Owner 创建事件」的路由是 claim/thread
   ⇒ 用户当时的服务端是 pre-#190。在 `21878b9` worktree 上重放同一份数据，note 同样正常渲染
   ⇒ **「版本偏旧」不足以解释症状**。
6. **已排除的隐藏条件**：`notifyTaskCreated` 的静默跳过（频道归档 / Owner 非成员）在 #showcase 不成立
   （archived=0、`channel_members` 含 `owner`）；`previewLine()` 取首行 + 80 字截断不会把换行带进事件正文
   （正则不会漏配）；消息流渲染没有 filter/slice 丢弃事件消息；样式层没有对 `.ws-task-created-event` 的
   覆盖定义。

### 唯一与症状相符的解释

note 是刻意**低强调**的静态条（米色底 + muted 字、无图标、无作者/时间），并且在 agent 长回复到达后
被顶到视野之外（实测 2303px）。live 证据显示用户 07:45 打开过频道（`channel_reads`）与 task#2 线程
（`task_thread_reads`），此时 seq 14/15 早已把 note 推离首屏。

### 未探索（受约束，非疏漏）

- 未在隔离环境开启 agent-loop：会真实调用模型（需凭证/付费），按行为规则由 coordinator 决定，未擅自执行。
- 未连 live 服务：打开频道会写 `channel_reads`，违反「不写 live 数据」。

### 下一步建议（需 coordinator / 用户裁决，本票不擅自扩 scope）

- **A**：结票为「HEAD 不可复现」，本票据 + 证据即为交付。
- **B**：要用户现场（跑的是 `npm run dev` 还是 `worksplice` CLI / 打包构建、是否刷新过、截图）。
- **C**：认定「note 视觉过弱 / 易被长回复顶出首屏」是可发现性缺陷，另开 spec 授权后做 UX 改动。

### 验证

- 隔离 dev server（端口 30311，HEAD）+ 基线 dev server（端口 30312，`21878b9`），ego-browser 驱动。
- 证据目录：`$TMPDIR/wsagent/evidence/`（`notes.md` 全文、`scenarioA-note.png`、`scenarioB.png`、
  `scenarioC-convert.png`、`scenarioC-astask.png`、`baseline-pre190.png`、`api-showcase-messages.json`）。
- `node_modules/.bin/tsc --noEmit` → exit 0。
- `npm run lint` → 0 error，1 warning（`hooks/useI18n.tsx:61`，改动前既有）。
- `npm test` → tests 1551 / pass 1550 / fail 1；失败项 `lib/model-listing.test.mjs` 读真实
  `~/.pi/agent/models.json`（本机配置了 deepseek 模型），与本票无关且基线同口径失败。
- `git status --porcelain` 在跑门禁时为**空**（本票无代码改动）。

### Review

- Standards：无代码改动，无需双轴代码评审；本票据遵守 `.scratch/*/issues/` 既有格式（Parent / What to build /
  Blocked by / Status / Type / Acceptance criteria / Answer）。
- Spec：与票面一致 —— 「先复现、再定位；有真实失败才修」，未改 schema / seed / live 数据，
  未改 wake 策略与任务认领/线程路由语义，未引入依赖、未跑 `next build`。

### Delivery

- Commit: `049a6df`（`docs(board-task-created-event): 三场景复现全绿…`）+ 本 Answer 回填
- Branch: `board-task-created-event`
- PR: https://github.com/whutlichao/worksplice/pull/195
- PR body: `.scratch/board-task-created-event/pr-body.md`
