# 10-startSession软删引用集纳入归属门禁

**What to build:** review 整改（Spec 轴最高优先级）：`agent-runtime.ts` 的 `referencedSessionFiles()` 目前用 `listMembers()`（deleted=0 过滤）——软删成员的 pi_session_file 登记不计入「被其他成员固化引用」，B 绑定 A 遗留会话文件且 A 软删时，B 的 startSession 归属校验放行并复用/固化 A 的会话 = 症状②「继承上下文」最后一条残留路径。切换到 `listMembersIncludingDeleted()`（与 08 backfill 侧同款访问器），软删登记重新计入门禁 → B 清绑 + 新建空会话。

**Blocked by:** None — can start immediately

**Status:** resolved（2026-08-12）

## Answer

**修复落地（代码级）：** `referencedSessionFiles` 从 `createRealAgentRuntime` 闭包提升为模块级导出函数（`lib/agent-runtime.ts`），引用集来源切为 `listMembersIncludingDeleted()`（与 08 backfill 侧同款访问器）。**关键：排除语义从「按路径删除」改为「按成员 id 排除」**——旧组成 `referencedByOthers.delete(normalize(boundFile))` 会把同路径的软删登记一并抹掉（Set 按路径去重无法区分两成员），访问器单独切换不生效；现 `referencedSessionFiles(member.id)` 排除本成员自己的登记，软删 A 的登记保留在集合中 → B 的归属校验失败 → 清绑 + 新建空会话。`resolveLatestSessionFile`/`removeSessionFilesForCwd` 无参调用保留全量登记语义（家目录回填路径下本成员无登记；删文件面必须保留软删成员的文件）。语义自洽：ADR-0003 凭证 = 固化登记，与 08 同源；03 自愈路径（清绑 + 新建空会话）不变。

**验证（全绿）：**
- 红灯 → 绿灯：先写回归用例（`lib/agent-runtime.test.mjs` 14/14 pass）——A 绑定 F、A 软删、B 绑定 F → `referencedSessionFiles(b.id)` 含 F（A 的软删登记计入门禁，B 自身登记被排除）→ `chooseSessionFileForStart` 裁决 `{ sessionFile: null, clearedBinding: true }`
- 全量：`node --test lib/agent-loop/*.test.mjs lib/raft/*.test.mjs` 306/306 pass；`tsc --noEmit` + `npm run lint` 干净
- ⚠️ 已改 `lib/agent-runtime.ts`（globalThis 闭包持有旧代码）：dev server 必须重启才生效——已确认无 server 在跑（端口 30142 空闲），下次 `npm run dev` 生效

- [x] `referencedSessionFiles()` 改用全量访问器（软删成员登记计入引用集）+ 排除语义改按成员 id
- [x] 回归测试：A 绑定文件 F、A 软删、B 绑定 F → startSession 归属校验拒绝复用（清绑 + 新建空会话），不继承 A 上下文
- [x] `tsc --noEmit` + `npm run lint` + `node --test lib/agent-loop/*.test.mjs lib/raft/*.test.mjs` 全绿
- [x] 改 agent-runtime 相关代码后 dev server 重启验证（或确认无 server 在跑，下次 `npm run dev` 生效）
