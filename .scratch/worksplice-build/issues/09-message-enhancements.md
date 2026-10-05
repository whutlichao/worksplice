# 09 — 消息增强：reaction / pinned / 附件

**What to build:** 消息增强三件套：emoji reaction——hover 消息出现快捷栏 + 表情选择器，点击计数、再次点击取消，`UNIQUE(message_id, member_id, emoji)` 约束，无需通知/不进 inbox；个性化 pinned——每个成员在 channel 内维护自己的 pinned 区、channel 头部可展开查看，排序三选一（Manual 手动默认 / Recent / A-Z）；附件——输入区回形针上传，单文件上限 50MB（与 raft 一致），文件实体存应用数据目录 attachments/，库内只存元数据，预览复用 pi-web FileViewer、超出预览范围提供下载（spec §3.4、§3.5、§6.2 三张表）。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] reaction 添加/取消幂等；同成员同消息同 emoji 重复添加被唯一约束拒绝
- [ ] pinned 按成员隔离；Manual（默认）/Recent/A-Z 三种排序可用；channel 头部可展开
- [ ] 附件 ≤50MB 上传成功、超限被拒；元数据入库、实体落盘 attachments/
- [ ] 附件预览复用 FileViewer；超出预览范围提供下载
