# Answer：消息动作栏完成操作后立即收起

## 结果

修复消息动作栏完成操作后仍因 hover/focus 保持显示的问题。动作完成时立即关闭工具栏；打开快捷 reaction 或 emoji picker 不算完成，选择 reaction 后才收起。改动位于共用的 `MessageRow` / `MessageActions` 路径，频道与线程继续复用原有动作和回调语义。

## 根因与实现

根因是 `app/globals.css` 的 hover、focus-within 和 reaction-open 规则会重新显示 `.ws-message-actions`，而完成操作后没有行级的关闭状态。真实浏览器中点击 Quote 后，引用状态已更新，但指针仍在消息上、工具栏仍为 `display: flex`。

`components/ChannelView.tsx` 增加统一的 `completeAction`：先调用行级 dismiss、关闭 emoji picker，再执行 Reply、Quote、复制链接、Reminder、Pin、转任务或 reaction 选择。`MessageRow` 在动作完成后标记 toolbar dismissed；指针离开再进入该行时重置。CSS 的 hover/focus/reaction-open 揭示规则都尊重该标记。打开/关闭快捷 reaction 与打开 picker 不会 dismiss；只有选择 emoji 才会。

## 红绿与门禁

浏览器验证使用临时项目和 `WORKSPLICE_DATA_DIR`（`/tmp` 下）、隔离端口 `30143` 及 ego-browser；未触碰 `~/.worksplice`。红阶段在 base `905c17f` 上运行回归脚本，Quote 后观察到 `hovered: true`、工具栏 `display: flex`，断言要求 `none`，复现原缺陷。绿阶段同一反馈流程通过：Quote 在指针仍停留于消息行时隐藏工具栏；打开、关闭快捷 reaction 选择以及打开 emoji picker 时保持可用；选中 quick reaction 或 picker emoji 后工具栏收起。测试 TaskSpace 已按 ego-browser 约定结束，临时项目、数据和测试服务器均已清理。

| 检查 | Base | 修改后 |
| --- | --- | --- |
| `node --test components/ChannelView.test.mjs` | 改前基线已运行 | 50 pass / 0 fail |
| `npm run typecheck` | 通过 | 通过（`tsc --noEmit`，exit 0） |
| `npm run lint` | 0 errors；1 条既有 `hooks/useI18n.tsx:61` warning | 0 errors；同一条既有 warning，无新增 |
| ego-browser 回归 | Quote 后 toolbar 仍为 `flex`（red） | Quote / reaction selection / emoji picker selection 收起 toolbar（green） |

未运行全量测试或 `next build`；未运行 formatter/fix 命令。`.pi-lens.json` 的格式化已关闭并加入 `.git/info/exclude`，未进入提交。`git diff --check` 通过；改动文件无 `[DEBUG-*]` 标记。

## 双轴 review

审阅固定点：`905c17f0206e675e0a5dc9df274a2590153c3631`；提交：`a5304fa fix(message-actions): dismiss toolbar after actions`。

### Standards

- **Correct**：未发现违反已记录标准的改动。新 reaction emoji 只用于测试脚本中的 reaction 选择/断言，符合 `AGENTS.md` 的持久化 reaction 内容例外；`CONTEXT.md` 术语规则无冲突。
- **判断项 — Duplicated Code**：测试脚本多处在浏览器 callback 中查找同一消息行，例如 `rowState()` 与 `mineHasReaction()` 都使用 `document.querySelectorAll(".ws-message-row")` 并按 `textContent` 查找。属于低影响的测试脚本重复，不是标准违规；接受此 note，避免为跨 `page.evaluate` / `waitForFunction` 的浏览器执行上下文引入字符串注入或全局 helper。
- **Merge verdict**：OK with notes。

### Spec

- **Correct**：共用 `MessageRow` 同时服务频道消息行及 `ThreadPanel` 锚点/回复行；dismiss 状态与 CSS 规则落在共用路径。各完成动作统一调用 `completeAction`；reaction 选择前不会收起。未见明显 scope creep 或实现错误。
- **P2 覆盖 note**：浏览器脚本直接验证了频道行的 Quote 和 reaction 流程，但没有单独走一条线程行，也没有逐个点击 Reply、Copy link、Reminder、Pin、Convert to Task。评审引用的要求为“Preserve action availability and semantics across channel and thread message rows”。这是自动化覆盖范围的限制，不是发现的行为差异：ThreadPanel 仍使用同一 `MessageRow`，这些动作都经过同一个 `completeAction`。作为非阻塞 note 保留；本次保持窄档，不扩成每个按钮一条浏览器流程。
- **Merge verdict**：OK with notes。

**分轴汇总**：Standards：0 个标准违规、1 个低影响判断项（重复查询）；Spec：1 个 P2 覆盖 note、0 个已确认的规格行为错误。

## 交付状态

- 分支：`msg-actions-dismiss-retry`
- 实现提交：`a5304fa`
- 改动文件：`app/globals.css`、`components/ChannelView.tsx`、`scripts/verify-message-actions-dismissal.ego.mjs`
- 本 Answer：`.scratch/msg-actions-dismiss-retry/Answer.md`
- **PR 尚未创建**：按 coordinator 对第三方 GitHub/凭证操作的接管指示，worker 未执行 push、`gh pr create` 或 merge。coordinator 验收后负责 push 与创建 PR；目前无 PR 编号。
