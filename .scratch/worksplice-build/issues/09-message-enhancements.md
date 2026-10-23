# 09 — 消息增强：reaction / pinned / 附件

**What to build:** 消息增强三件套：emoji reaction——hover 消息出现快捷栏 + 表情选择器，点击计数、再次点击取消，`UNIQUE(message_id, member_id, emoji)` 约束，无需通知/不进 inbox；个性化 pinned——每个成员在 channel 内维护自己的 pinned 区、channel 头部可展开查看，排序三选一（Manual 手动默认 / Recent / A-Z）；附件——输入区回形针上传，单文件上限 50MB（与 raft 一致），文件实体存应用数据目录 attachments/，库内只存元数据，预览复用 pi-web FileViewer、超出预览范围提供下载（spec §3.4、§3.5、§6.2 三张表）。

**Blocked by:** 04

**Status:** resolved（2026-10-23）

- [x] reaction 添加/取消幂等；同成员同消息同 emoji 重复添加被唯一约束拒绝
- [x] pinned 按成员隔离；Manual（默认）/Recent/A-Z 三种排序可用；channel 头部可展开
- [x] 附件 ≤50MB 上传成功、超限被拒；元数据入库、实体落盘 attachments/
- [ ] 附件预览复用 FileViewer；超出预览范围提供下载

## Answer

**结论**：按已批准偏差完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- reaction：`lib/domain/collab/reactions.ts:35` `toggleReaction`；唯一约束 `lib/data/schema.ts:95-101` `UNIQUE (message_id, member_id, emoji)`；测试 `lib/domain/collab/reactions.test.mjs:34`、`:47`。
- pinned：`lib/domain/collab/pinned.ts:39` `pinMessage`、`:62` `unpinMessage`、`:75` `listPinned`（manual 默认 / recent / az，`:87-103` 排序与手动重排）；成员隔离测试 `pinned.test.mjs:58`；三种排序 `pinned.test.mjs:76`；UI 头部展开 `components/ChannelView.tsx:2551`、`:2588`，排序 hook `:2500-2521`。
- 附件：`lib/domain/collab/attachments.ts:34` `stageAttachmentFiles`、`:39-40` 50MB 上限；元数据表 `lib/data/schema.ts:103-112`，实体落盘目录 `lib/data/dirs.ts:8` `attachments/`；测试 `attachments.test.mjs:28`、`:66`；下载路由 `app/api/attachments/[id]/route.ts:7`（图片 inline、其余 attachment）。
- 偏差项：附件预览由 `components/ChannelView.tsx:563` `AttachmentList` 自实现——图片 `<img>` 预览 `:623`、文本预览 `:697`、下载链接 `:706`。

**偏差**：第 4 条“附件预览复用 FileViewer”未满足，保持未勾选。原因：`FileViewer` 的契约按 repo 文件设计，必需/依赖 `filePath` + `cwd` + `sourceSessionId`（`components/FileViewer.tsx:786`，props 定义 `:29-32`），而附件是数据库实体 + 随机磁盘文件名（无 repo 路径/cwd），无法在不伪造 repo 语义的前提下复用。批准来源：本票 dispatch 的已批准偏差清单（task_1ed331f1ed3c）；行为等价面（预览 + 超范围下载）已由 AttachmentList 与下载路由覆盖。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
