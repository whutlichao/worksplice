# 01 — 事件系统消息投递

**What to build:** 关键节点触发的第一半（spec §4.2/§7、交付清单 §8.1-2）。当新 agent 加入频道或新频道建立时，频道里出现一条以 Owner 署名投递的短事件消息（如 `@Susan 新成员 @X 加入频道` / `@Susan 新频道 #Y 已建立`）——内容只含关注对象、不含欢迎正文；消息投递只定向唤醒 Susan、不惊动其他 agent；加入者是 Susan 本人或 Owner 时不投（不存在"欢迎自己"）。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 新 agent 加入频道（提交后）→ 目标频道出现 Owner 署名事件消息，含 `@Susan` mention
- [ ] 新频道建立（提交后）→ 新频道出现同样形态的事件消息
- [ ] 排除规则：加入者 = Susan 或加入者 = Owner 时不投事件消息
- [ ] 不惊动其他 agent：channel 级 wake 关闭，仅 `@Susan` 定向穿透（验收点：其他 agent 不被唤醒）
- [ ] 既有 createChannel / joinChannel 服务层签名不变（零机制改动）
- [ ] 事件消息在事务提交后投递（回滚/held 不产生事件消息），复用现有 sendMessage 语义
