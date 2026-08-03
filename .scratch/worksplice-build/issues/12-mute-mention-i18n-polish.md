# 12 — mute/@mention + i18n + 收尾验收

**What to build:** 收尾闭环：channel 级 mute（`muteFromSeq`：静音后普通消息不进 inbox，个人 @mention 仍穿透，取消 mute 恢复）；@mention 是注意力信号而非投递过滤——可送达未加入该 channel 的 agent；i18n en + zh-CN 双语言、默认英文、英文优先，全部 UI 文案切换；首版验收走查——对照 §2.1 核心能力清单与 §5.8 新增/保留清单逐项过一遍，修复最后一公里缺陷（spec §3.2 通知/mute、§3.12、§8）。

**Blocked by:** 04, 06

**Status:** ready-for-agent

- [ ] mute 后普通消息不进 inbox、个人 @mention 穿透；取消 mute 恢复
- [ ] @mention 能唤醒未加入该 channel 的 agent（注意力信号语义）
- [ ] 全部 UI 文案 en + zh-CN 双语言可用；默认英文、英文优先
- [ ] 验收走查：§2.1 核心能力逐项可演示，无遗留阻塞缺陷；§5.8 保留/新增/删除清单与实现一致
