# 07 — 私有频道预勾选 Susan

**What to build:** 新建私有频道时，CreateChannelModal 的初始成员默认预勾选 Susan（可取消）（spec §7、交付清单 §8.2-2）——"新建私有频道默认加（可取消）"的落地。公开频道不涉及。取消勾选后创建的私有频道不含 Susan；服务端 createChannel 的 memberIds 语义不变。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 新建私有频道弹窗的初始成员里预勾选 Susan（若 Susan 存活）
- [ ] 可取消勾选；取消后创建的频道不含 Susan
- [ ] 既有 createChannel 行为不变（memberIds 语义复用，零机制改动）
