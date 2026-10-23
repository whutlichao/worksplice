# Answer：消息页旅程引导卡不随任务状态实时更新

## 结果

消息页的 3s 任务板轮询从「只合并未读计数」升级为「整行视图合并」：`status` / `owner_id` /
`reopened` / `reachable` / `updated_at` / owner 视图 / 未读计数 / `taskThreadReadSeq` /
`totalReplyCount` 同源刷新，新任务并入、消失行移除、未变化行保持对象身份。
真实浏览器实测：base 上卡面在 claim → in_review → done 全程停在「等待交接或认领」（红）；
修复后依次变成「让它跑」（1.2s）→「去复核」（2.4s）→ 消失（2.9s），均在 5s 内。

改动面：`hooks/useChannelData.ts`（`mergeTaskUnreadCounts` → `mergeTaskPollRows` + 3s 轮询
调用点 + 注释）、`hooks/useChannelData.test.mjs`（回归测试）。未改服务端、未改
`components/ChannelView.tsx`、未新增接口、未改轮询间隔与后台 tab 暂停语义。

## 根因

`hooks/useChannelData.ts` 的 3s 轮询每轮都 `loadTasksPage(cid)`，但旧合并函数
`mergeTaskUnreadCounts` 只回写四个计数字段（`unreadReplyCount` / `latestUnreadReplyAt` /
`taskThreadReadSeq` / `totalReplyCount`），并在注释里把「不写回 status」当成契约——
旧测试甚至断言 `task status remains owned by the normal task reload`。同时合并以
`current.map(...)` 为骨架，轮询返回的新行被直接丢弃。

`ChannelView.tsx:3028` 的 `journey` 完全由 hook 的 `tasks` 推导（Tasks 徽标 `openTaskCount` 同源），
Messages 页签下没有第二条全量任务重拉路径（Tasks 页签有自己的 3s 全量重拉，所以只在消息页复现）。
于是 agent-loop 认领/完成、另一页签或另一个 agent 的审批状态变化永远进不来，卡面停在旧形态，
直到切频道或整页 reload。浏览器探针在 base 上复现的正是这条路径。

## 实现

`mergeTaskPollRows(current, refreshed)`（替换旧名，调用点与测试同步改名，不留两套函数）：

```text
mergeTaskPollRows(current, refreshed)
  for (next of refreshed)                       // 服务端顺序 = number 升序
    prev ← current.byId[next.id]
    if 没有 prev            → 原样并入 next（新任务）
    if !sameTaskView(prev, next) → 用服务端整行替换；缺失 totalReplyCount 时保留 prev 值
    else                    → 返回 prev（对象身份不变）
  若数量、顺序、逐行身份都没变 → 返回 current（同一数组引用，维持「稳定行」契约）
```

`sameTaskView` 比较服务端会改写的字段：`status` / `owner_id` / `reopened` / `updated_at` /
两个未读字段 / `taskThreadReadSeq` / `totalReplyCount`（缺失视为未变化）/ owner id / `reachable` 逐项。
`anchor` 指向不可变消息、`number`/`message_id` 不变，不参与比较。

轮询 effect 只把函数换成新的（`tasksCacheRef` 写入条件仍是「有变化才写」）：

```diff
 setTasks((current) => {
-  const refreshed = mergeTaskUnreadCounts(current, rows);
+  const refreshed = mergeTaskPollRows(current, rows);
   if (refreshed !== current) tasksCacheRef.current.set(cid, refreshed);
   return refreshed;
 });
```

旧的过时注释（「后台刷新只合并计数…避免改写任务视图的其他状态」、D3 段落的
「只跟任务板前进」）一并改写，说明现在整行同源刷新与缺失 `totalReplyCount` 的兼容口径，
不在注释里留下与实现相反的结论。

## 红→绿

### 单元测试

先写失败回归、在未修改实现上取证，再改实现：

- **红**：`evidence/red-unit-tests.log` —— `tests 41 / pass 37 / fail 4`。核心失败是 journey 断言：
  `轮询行必须把 status=in_review 带进任务视图`，`actual 'todo'` vs `expected 'in_review'`。
  另外 3 条：整行替换（状态/属主/时间/可达落点）、重开标记与属主回池、服务端顺序与新行/消失行。
- **绿**：`evidence/narrow-gate.log` —— 票据窄门禁
  `node --test --test-timeout=60000 hooks/useChannelData.test.mjs components/ChannelView.test.mjs`
  → `tests 107 / pass 107 / fail 0`（hook 文件 41 项全绿）。
- 覆盖点：journey 推导 `in_review→review` / `in_progress→running` / `todo→handoff` / `done·closed→null`；
  变化行整行采用服务端视图（status/属主/reopened/reachable/updated_at）；未变化行与无变化数组保持引用；
  新任务按服务端顺序并入、服务端已不存在的行移除；`totalReplyCount` 缺失回退；
  `taskThreadReadSeq` 与总数/未读继续前进。

### 真实浏览器（ego-browser，仓库浏览器纪律）

探针 `.scratch/task-card-poll-sync/probe.ego.mjs`：自建私有频道 + 消息 + 任务（`POST /api/channels`、
`POST /api/messages`、`POST /api/tasks`），打开 `#c/<id>`，用接口依次制造
claim（todo→in_progress）→ update-status `in_review` → `done`，每步只读 DOM 里
`JourneyGuideCard` 的 `aria-label`（卡面标题），5s 不达预期记 TIMEOUT。`phase.txt` 控制
`before`/`after` 前缀，探针本体不随 phase 改动。

- **红（base `df20193` 的 hook）**：`evidence/before.log` → `RED (1/4)`，初始「等待交接或认领」正确，
  之后三步全部 TIMEOUT（~5.06s）：claim 后仍是「等待交接或认领」、`in_review` 后仍是、`done` 后卡还在。
  截图 `evidence/before-00-initial.png` … `before-03-done-disappears.png`。
- **绿（本票 head）**：`evidence/after.log` → `GREEN (4/4)`：
  `01-claim-running → 让它跑（1215ms）`、`02-review → 去复核（2430ms）`、
  `03-done-disappears → null（2937ms）`。截图 `evidence/after-*.png`。

取红方式：先提交实现，再 `git checkout df20193 -- hooks/useChannelData.ts` 跑探针取红，
随后 `git checkout HEAD -- hooks/useChannelData.ts` 还原；跑绿前后都核对过 `git status`，
除 `.scratch/task-card-poll-sync/`（本轮新增票据目录）外工作区干净，未丢任何未提交改动。

探针踩到的两个坑（写进脚本注释，避免后来者假红）：

1. **Service Worker 是 cache-first**：`public/sw.js` 对 `/_next/static/` 走 cache-first，不清缓存时
   页面会一直跑改动前的客户端 chunk，探针假红。探针在打开频道页前注销 SW 并清空 `caches`。
2. **公开频道会自动加入秘书 agent**：agent-loop 会在探针 claim 前抢先认领任务（实测 initial 已是
   「让它跑」/claim 返回 409 already claimed）。探针改用**私有频道**，状态只由本地接口制造。

隔离实例：`WORKSPLICE_DATA_DIR=/tmp/ws-task-card-poll-sync PORT=30199 npx next dev -H 127.0.0.1 -p 30199`
（用 worktree 内 `./node_modules/.bin/next`，避免 npx 触发依赖安装），全程未触碰 `~/.worksplice`，
用户正在跑的 30142 未动；取证结束后 30199 dev 已停。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test --test-timeout=60000 hooks/useChannelData.test.mjs components/ChannelView.test.mjs` | 107 pass / 0 fail（`evidence/narrow-gate.log`） |
| `node_modules/.bin/tsc --noEmit` | 0 error |
| `npm run lint` | 0 error，仅既存 `hooks/useI18n.tsx:61` 一条 warning（`evidence/lint.log`） |
| `npm test`（最终 head 全量） | 1650 pass / 0 fail（27.3s，`evidence/full-test.log`） |

## 省略双轴 code-review 的理由

本票改动可圈定：单个文件里的一个纯合并函数 + 既有 3s 轮询调用点，行为全部由同文件测试覆盖，
无跨包类型、构建配置或服务端接口变更；journey 推导逻辑（`lib/journey-state.ts`）与
`ChannelView.tsx` 一字未动。code-review 的双轴（Standards / Spec）在本票没有可复查的架构面，
故按票据安排省略，理由记录于此。

## PR

- 分支：`task-card-poll-sync`
- PR body：`.scratch/task-card-poll-sync/pr-body.md`
- PR 号：**#207** — https://github.com/whutlichao/worksplice/pull/207
