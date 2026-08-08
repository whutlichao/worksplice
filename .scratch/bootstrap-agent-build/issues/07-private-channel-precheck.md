# 07 — 私有频道预勾选 Susan

**What to build:** 新建私有频道时，CreateChannelModal 的初始成员默认预勾选 Susan（可取消）（spec §7、交付清单 §8.2-2）——"新建私有频道默认加（可取消）"的落地。公开频道不涉及。取消勾选后创建的私有频道不含 Susan；服务端 createChannel 的 memberIds 语义不变。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 新建私有频道弹窗的初始成员里预勾选 Susan（若 Susan 存活）
- [x] 可取消勾选；取消后创建的频道不含 Susan
- [x] 既有 createChannel 行为不变（memberIds 语义复用，零机制改动）

## Answer

**纯判定 seam**（`lib/secretary-bootstrap.ts` 扩展，仅 type import 运行时零依赖，node:test 直测）：
- `liveSusanMemberId(agents)`：活存 Susan 的 member id（与 `hasLiveSusan` 同源共享 `isLiveSusan` 判定：名字全等 + agent 类型 + 未软删）；无活存 Susan → undefined。`BootstrapAgentLike` 增加可选 `id`。
- `precheckSusanForPrivateChannel(memberIds, type, susanId, susanTouched)`：§7「默认加（可取消）」状态机——类型进入 private 且 Susan 未被手动触碰 → 幂等补入预勾选（未包含时返回新数组，已包含返回同引用）；切回 public（未触碰）→ 撤掉预勾选（公开频道不涉及，预勾选不泄漏进公开提交，review 硬化）；已触碰（用户勾/取消过 Susan）→ 尊重用户选择永不再自动补。

**UI**：CreateChannelModal 类型按钮改走 `selectType`——`susanId = liveSusanMemberId(agents)` + `susanTouchedRef`（`toggleMember` 勾/取消 Susan 时置位），把 `setType` 与预勾选状态机合并为一次 `setMemberIds` 更新。memberIds 语义与既有 `createChannel` 完全一致（服务端零改动；公开频道本就由服务层静默必加 Susan，§7 已落地）。

**测试**：`lib/secretary-bootstrap.test.mjs` +11 条（id 提取 / 软删与 human 排除 / private 补入幂等 / public 不涉及 / 无活存 Susan 原样 / 触碰后尊重——含取消后不补回、保留的选择存活、切回公开撤预勾选与保留用户选择）；`components/CreateChannelModal.test.mjs` 新建 3 条静态渲染冒烟（成员列表含 Susan 渲染 / 初始 public 无人预勾选 / 无成员时无初始成员区）。类型检查 0 错误、eslint 0 错误 0 警告；全量测试 614/612 绿（2 失败为既有环境性 `skill-lock.test.mjs` + `models-config/test/route.ts`，与本次无关）。浏览器实测闭环（Playwright，本地 30141）：新建频道 → 私有 → Susan 预勾选（黄底去 "+"）；点 Susan 取消 → "+" 复现且再切私有不自动补回（触碰尊重）；取消重开 → 私有预勾选 → 切回公开 → 预勾选撤掉。code-review 双轴整改：`hasLiveSusan` 回退 `.some(isLiveSusan)`（委托 `liveSusanMemberId` 会因 id 缺失的行误判，判定两用各自自足）、预勾选状态机补 public 撤出方向、冒烟测试名与断言口径修正。
