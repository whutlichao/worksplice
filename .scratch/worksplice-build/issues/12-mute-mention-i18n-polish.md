# 12 — mute/@mention + i18n + 收尾验收

**What to build:** 收尾闭环：channel 级 mute（`muteFromSeq`：静音后普通消息不进 inbox，个人 @mention 仍穿透，取消 mute 恢复）；@mention 是注意力信号而非投递过滤——可送达未加入该 channel 的 agent；i18n en + zh-CN 双语言、默认英文、英文优先，全部 UI 文案切换；首版验收走查——对照 §2.1 核心能力清单与 §5.8 新增/保留清单逐项过一遍，修复最后一公里缺陷（spec §3.2 通知/mute、§3.12、§8）。

**Blocked by:** 04, 06

**Status:** resolved（2026-10-23）

- [x] mute 后普通消息不进 inbox、个人 @mention 穿透；取消 mute 恢复
- [x] @mention 能唤醒未加入该 channel 的 agent（注意力信号语义）
- [x] 全部 UI 文案 en + zh-CN 双语言可用；默认英文、英文优先
- [x] 验收走查：§2.1 核心能力逐项可演示，无遗留阻塞缺陷；§5.8 保留/新增/删除清单与实现一致

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- mute：`lib/domain/collab/channels.ts:216` `muteChannel`（记录 `muteFromSeq`/`muteRowid`）、`:237` `unmuteChannel`；inbox 过滤 `lib/domain/collab/inbox.ts:40-60`；测试 `channels.test.mjs:161`、`inbox.test.mjs:162`（静音抑制 + @mention 穿透）、`:182`（unmute 不补投）。
- @mention 穿透：`lib/domain/collab/wake.ts:62-87` `notifyMessageWakes`（channel 成员 + 非成员个人 mention 定向唤醒）；测试 `lib/agent-loop/wake.test.mjs:82`（非成员 agent 被 mention 唤醒）、`:168`（muted 成员仍被个人 mention 唤醒）、`:190`（unmute 恢复）。
- i18n：`lib/i18n/registry.ts:36-39` 默认/回退英文；词条 `lib/i18n/messages/en.ts`（724 行）与 `lib/i18n/messages/zh-CN.ts`（720 行）；UI 切换 `components/WorkspaceSidebar.tsx:146`、`:419-420`；测试 `lib/i18n/registry.test.mjs:13`（浏览器语言回退英文）、`lib/i18n/messages.test.mjs:13`。
- 验收走查：对照 `docs/spec.md:62` §2.1 核心能力与 `docs/spec.md:396` §5.8 改造清单，逐项核对本仓库实现与测试面（频道/消息/任务/提醒/反应/pinned/附件/观测/i18n 均有对应 service + test），未发现遗留阻塞缺陷。

**偏差**：无。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
