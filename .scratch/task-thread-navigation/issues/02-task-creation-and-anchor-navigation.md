# 02 — 任务创建事件与锚点导航

## Parent

`.scratch/task-thread-navigation/spec.md`

## What to build

Owner 将频道中的消息转为 Task 后，能把低强调、只读的创建事件与真正承载 Task 的原始锚点区分开；并能从始终可见的锚点入口直接打开对应任务讨论，即使讨论尚无回复。

## Blocked by

None (can start immediately)

Status: resolved
Type: task

## Acceptance criteria

- [x] 转为 Task 后，频道主序列出现独立、低强调的「Task #N 已创建」信息及普通文本预览；创建事件不是 Task 锚点或任务讨论内容，Owner 自己创建的事件不计入 Owner 的 Channel 未读，也不改变既有的 agent 唤醒行为。
- [x] 创建事件本身没有 hover / pop action、点击区域、链接、键盘停靠点、上下文菜单或再次转为 Task 的入口；预览中的 URL 仍是普通文本。
- [x] 新出现的创建事件以 polite 方式播报一次，播报时焦点留在触发操作处；页面刷新或重载呈现历史事件时不重复播报。
- [x] 原始 Task 锚点持续显示 Task 编号与当前状态，并始终提供清楚标明「打开任务讨论」的键盘可达按钮；按钮有清晰的可见焦点样式和说明 Task 编号的无障碍名称。
- [x] 即使对应讨论尚无回复，锚点按钮也能直接打开该 Task 的正确讨论；事件提示、Task 状态和讨论入口各自表达独立含义，不以整行点击代替按钮。
- [x] 本票不呈现 Task thread 未读回复数，也不推进或建立 Task thread 已读位置。

## Answer

完成 Ticket 02：Task 创建事件独立呈现为静态 note，URL 预览保持普通文本；事件行按自身内容识别，不依赖 Task 元数据快照。首次加载的历史不播报，按频道保留 seq 水位，切回频道仍会对新事件礼貌播报一次。原消息锚点显示 Task 编号和状态，并始终提供带 Task 编号的“打开任务讨论”按钮；零回复也能打开正确 thread。任务转换显式传递动作栏/上下文菜单触发控件，在该控件移除后把焦点交给同一锚点的讨论入口。未实现 thread 未读或已读位置，也未改变 wake、任务状态机或既有视觉系统。

### 验证

- TDD：新增事件静态呈现、锚点元数据和 announcement tracker 测试；先红后绿。焦点缺陷经 ego-browser 实测为红（焦点掉到 `BODY`），修复后落在对应讨论按钮且 `:focus-visible` 可见。频道切换及 Task 快照延迟两项回归均先红后绿。证据见 `/tmp/orch-worksplice/evidence/task-thread-navigation-02/` 下的 `tdd-red.out`、`tdd-green-slice.out`、`tdd-focus-red.txt`、`tdd-focus-green.out`、`tdd-channel-switch-red.out`、`tdd-channel-switch-green.out`、`tdd-task-snapshot-red.out`、`tdd-task-snapshot-green.out`。
- `npm test`：1327 passed，0 failed；`npm run typecheck` 通过。
- `npm run lint`：exit 0；基线与改后均只有既存 `hooks/useI18n.tsx:61` missing-dependency warning。`git diff --check` 通过。
- Ego-browser 在隔离 `WORKSPLICE_DATA_DIR` 中验证事件无交互、URL 普通文本、刷新历史不重复播报、键盘焦点样式及零回复 thread 导航；未使用 Playwright。浏览器手工焦点验证覆盖键盘动作栏路径；TaskSpace 关闭后的内部修正由最终测试和 review 验证，上下文菜单路径未单独重跑浏览器。截图及记录见 `/tmp/orch-worksplice/evidence/task-thread-navigation-02/`。

### Review

- Standards：未发现文档标准违规；非阻塞备注为事件解析依赖当前持久化正文模板，且与 `lib/domain/collab/event-messages.ts` 当前格式一致。
- Spec：No issues found；符合 D1–D3，未见范围扩张。

### Delivery

- Commit: 待创建
- PR: 待创建
