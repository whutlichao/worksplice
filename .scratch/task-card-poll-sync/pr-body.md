## Summary

消息页的旅程引导卡（`JourneyGuideCard` 的 review 形态）不随任务状态实时更新。根因在
`hooks/useChannelData.ts` 的 3s 轮询：它每轮都拉任务板，但只把未读计数合并回 `tasks`，
`status` / `owner_id` / `reopened` / `reachable` / `updated_at` 从不写回（旧测试还把这条
写成了断言），轮询返回的新行也被丢弃。`ChannelView` 的 journey 完全由这份 `tasks` 推导，
于是 agent-loop 认领/完成、另一页签或另一个 agent 的审批永远进不来。

```diff
 mergeTaskUnreadCounts(current, refreshed)          # 只合并计数，current.map 丢新行
+mergeTaskPollRows(current, refreshed)             # 整行视图合并
+  for next of refreshed                            # 服务端顺序（number 升序）
+    prev ← current.byId[next.id]
+    if !prev                    → 原样并入（新任务）
+    if !sameTaskView(prev,next) → 服务端整行替换；缺失 totalReplyCount 时保留 prev 值
+    else                        → 返回 prev（对象身份不变）
+  if 数量/顺序/逐行身份全未变 → 返回 current（同一数组引用）
```

```diff
 <ChannelView>
   useChannelData(channel?.id)
     loadTasksPage(cid)                       # 3s 轮询，频率与后台 tab 暂停不变
-    mergeTaskUnreadCounts(current, rows)
+    mergeTaskPollRows(current, rows)
   deriveJourneyState({ messageCount, tasks })  # 卡面 / Tasks 徽标同源，逻辑未动
```

`sameTaskView` 比较服务端会改写的字段：status / owner_id / reopened / updated_at / 未读计数 /
`taskThreadReadSeq` / `totalReplyCount`（缺失视为未变化）/ owner id / `reachable` 逐项。
`anchor` 指向不可变消息、number 与 message_id 不变，不参与比较。服务端、`ChannelView.tsx`、
轮询间隔、后台 tab 暂停语义均未改；旧名与过时注释一并替换，不留两套函数。

## Evidence

真实浏览器（ego-browser 驱动 Chromium；隔离实例 `WORKSPLICE_DATA_DIR=/tmp/ws-task-card-poll-sync`、
端口 30199；未触碰 `~/.worksplice` 与用户 dev 的 30142），私有频道自建「消息 → 任务」，
用接口依次制造 claim → `in_review` → `done`，只读 DOM 里卡面的 `aria-label`：

- **Before:** `evidence/before.log` → `RED (1/4)`：初始「等待交接或认领」正确，三步全部 TIMEOUT（~5.06s），
  claim / in_review / done 卡面始终停在「等待交接或认领」。
  截图 `.scratch/task-card-poll-sync/evidence/before-00-initial.png` … `before-03-done-disappears.png`。
- **After:** `evidence/after.log` → `GREEN (4/4)`：`让它跑` **1215ms** → `去复核` **2430ms** → 卡消失 **2937ms**。
  截图 `evidence/after-00-initial.png` … `after-03-done-disappears.png`。

回归测试（先红后绿）：

- **红**：`evidence/red-unit-tests.log` → `tests 41 / pass 37 / fail 4`，核心失败
  `轮询行必须把 status=in_review 带进任务视图`（actual `todo` vs expected `in_review`）。
- **绿**：`evidence/narrow-gate.log` → `hooks/useChannelData.test.mjs components/ChannelView.test.mjs`
  `107 pass / 0 fail`；覆盖 journey 四种形态、整行替换（状态/属主/重开/可达落点）、
  稳定行身份、服务端顺序、新行并入与消失行移除、`totalReplyCount` 缺失回退、已读游标前进。

门禁：`node_modules/.bin/tsc --noEmit` 0 error；`npm run lint` 0 error（仅既存
`hooks/useI18n.tsx:61` 一条 warning）；`npm test` **1650 pass / 0 fail**（`evidence/full-test.log`）。

## Merge Danger

**Door:** two-way

纯客户端 hook 内的合并策略与回归测试，服务端一行未改，回滚只需还原本文件。

**Blast Radius:** 消息页

只影响 Messages 页签下 `tasks` 缓存的新鲜度：卡面、Tasks 徽标、任务板会跟随 3s 轮询更新；
Tasks 页签自己的全量重拉、线程面板、未读角标路径不变。风险点是合并判据漏字段会让某类变化
仍不刷新（已由逐字段断言与浏览器探针兜底），或过度替换导致无谓重渲染（由「未变化行保持身份 /
全量无变化返回同一数组引用」两条测试兜底）。
