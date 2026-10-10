# 02 — 任务创建事件与锚点导航

## Parent

`.scratch/task-thread-navigation/spec.md`

## What to build

Owner 将频道中的消息转为 Task 后，能把低强调、只读的创建事件与真正承载 Task 的原始锚点区分开；并能从始终可见的锚点入口直接打开对应任务讨论，即使讨论尚无回复。

## Blocked by

None (can start immediately)

Status: ready-for-agent
Type: task

## Acceptance criteria

- [ ] 转为 Task 后，频道主序列出现独立、低强调的「Task #N 已创建」信息及普通文本预览；创建事件不是 Task 锚点或任务讨论内容，Owner 自己创建的事件不计入 Owner 的 Channel 未读，也不改变既有的 agent 唤醒行为。
- [ ] 创建事件本身没有 hover / pop action、点击区域、链接、键盘停靠点、上下文菜单或再次转为 Task 的入口；预览中的 URL 仍是普通文本。
- [ ] 新出现的创建事件以 polite 方式播报一次，播报时焦点留在触发操作处；页面刷新或重载呈现历史事件时不重复播报。
- [ ] 原始 Task 锚点持续显示 Task 编号与当前状态，并始终提供清楚标明「打开任务讨论」的键盘可达按钮；按钮有清晰的可见焦点样式和说明 Task 编号的无障碍名称。
- [ ] 即使对应讨论尚无回复，锚点按钮也能直接打开该 Task 的正确讨论；事件提示、Task 状态和讨论入口各自表达独立含义，不以整行点击代替按钮。
- [ ] 本票不呈现 Task thread 未读回复数，也不推进或建立 Task thread 已读位置。
