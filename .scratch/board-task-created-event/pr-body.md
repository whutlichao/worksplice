## Summary

诊断票，**零代码改动**：把「看板创建任务后频道消息流看不到任务创建事件」在隔离环境里逐场景复现，
三途径全部通过；交付票据与证据，不猜测性改代码。

```text
.scratch/board-task-created-event/
├── issues/01-board-task-created-event.md   # 票据 + Answer（排查路径、排除项、下一步选项）
└── pr-body.md                              # 本 PR body
```

排查落点（全部复核为「正常」）：

```text
createTask (lib/domain/collab/tasks.ts)
  notifyTaskCreated (event-messages.ts)
    sendMessage(wake:true)                 → 落库 seq N（三途径共同收敛点）
GET /api/channels/<id>/messages            → 返回含事件消息的最新页
useChannelData.loadLatest / 3s 轮询合并     → 消息进入 messages 状态
ChannelView.messages.map → parseTaskCreationEvent → TaskCreationEventRow (role="note")
```

## Evidence

- **Before（隔离 dev server + live DB 只读副本，ego-browser）：** 场景 A 回放 `#showcase` →
  `div.ws-task-created-event[role=note]` 两条（`任务 #1 已创建…` / `任务 #2 已创建 分析中国A股走势`），
  `display:flex` / `opacity:1` / 880×32，刷新后仍在，0 个可交互子元素。
  **After（同一份数据的几何测量）：** note 距视口 `top: -2303px`——seq 14（2224 字）与 seq 15（1898 字）
  两条 agent 长回复把它顶出首屏；滚上去即见（`scenarioA-note.png`）。这是唯一与症状相符的解释，
  不是渲染缺失。
- **场景 B（干净频道 / 看板 Create Task）：** `POST /api/tasks` → 201；`GET messages` → seq 3
  `Task #1 created — …`；切回「消息」tab 后 note 立即在 DOM，300ms / 1200ms / 3000ms / 5500ms 四个
  采样点稳定存在。
- **场景 C（右键 Convert to Task、发送勾「作为任务」）：** 纯轮询路径 ≤1 个轮询周期内出现
  （勾「作为任务」Enter 后 129ms 已在 DOM），刷新后仍在。
- **基线复核：** live DB 里 MattDev 对 seq 13 的回复落在频道（seq 14），而 HEAD 的
  `resolveTaskReplyRoute`（#190）对「最新一条是 Owner 创建事件」应路由到任务线程 ⇒ 用户运行时是
  pre-#190；在 `21878b9` worktree 重放同一份数据，note 同样正常渲染 ⇒ 「版本偏旧」不足以解释症状。
- **门禁（工作区无改动）：** `tsc --noEmit` exit 0；`npm run lint` 0 error（1 个既存 warning
  `hooks/useI18n.tsx:61`）；`npm test` → 1551 tests / 1550 pass / 1 fail（唯一失败
  `lib/model-listing.test.mjs` 读真实 `~/.pi/agent/models.json`，基线同口径失败）。
- **证据目录：** `$TMPDIR/wsagent/evidence/`（`notes.md` 全量命令与输出、`scenarioA-note.png`、
  `scenarioB.png`、`scenarioC-convert.png`、`scenarioC-astask.png`、`baseline-pre190.png`、
  `api-showcase-messages.json`）。

## Merge Danger

**Door:** two-way

纯文档：新增 `.scratch/board-task-created-event/` 下的票据与本 body；无源码、schema、seed、
依赖或数据改动，回滚只是撤掉本 PR。

**Blast Radius:** none

不触碰 `notifyTaskCreated` 的 wake:true 全频道扇出、尽力而为不抛错、任务认领/线程路由语义；
`~/.worksplice` 与 live 数据目录全程未写（隔离副本 + `WORKSPLICE_DEMO=1` 关闭 agent-loop）。

## Closes

无对应 GitHub issue（本票来自 Orca 派发工单 `task_3eed481aa944`；票据正本
`.scratch/board-task-created-event/issues/01-board-task-created-event.md`）。

下一步待 coordinator / 用户裁决：A 结票为「HEAD 不可复现」；B 要用户现场（`npm run dev` 还是
`worksplice` CLI / 是否刷新过 / 截图）；C 认定「note 视觉过弱、易被长回复顶出首屏」是可发现性缺陷，
另开 spec 授权后做 UX 改动。
