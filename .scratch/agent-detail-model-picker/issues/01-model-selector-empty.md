# 01 — Agent 详情面板无法选择模型（`/api/models` 无 cwd 时被 allowlist 403）

**What to build:** 让 `GET /api/models` 在未传 `cwd` 时不再对服务端自选的 `process.cwd()` 施加文件访问 allowlist；显式 `?cwd=` 的 400/403 语义保持不变。附带回归测试锁定三种入参形态。

**Type:** implement
**Status:** resolved
**Blocked by:** None

## 问题

用户运行中的实例上，`AgentDetailPanel` 的模型选择器按钮为 `disabled`，无法选择模型。

链路：`AgentDetailPanel.tsx:1020` 先请求 `/api/models?cwd=<agent workspace>`，失败后 `:1027` 回落到 `/api/models`；两次都返回 403 时 `setModels({ error })`，`models.modelList ?? []` 为空，`ModelPicker` 因 `modelOptions.length === 0 && !loading` 置灰。`CreateAgentModal.tsx:115` 的 `/api/models` 同样受影响。

## 根因

coordinator 在用户运行中的实例上实测（非推测）：

```text
curl 'http://127.0.0.1:30142/api/models'
→ HTTP 403 {"error":"Access denied"}

curl 'http://127.0.0.1:30142/api/models?cwd=<allowlist 内目录>'
→ HTTP 200，modelList 36 项
```

`app/api/models/route.ts` 原实现：

```ts
const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
const cwd = resolve(requestedCwd);
...
const allowedRoots = await getAllowedFileRoots();
if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
  return Response.json({ error: "Access denied" }, { status: 403 });
}
```

未传 `cwd` 时回落到 `process.cwd()`。这个目录由服务端自己选择（打包模式 = 安装目录；开发模式 = 仓库目录），**不是用户输入**，也不保证落在 `getAllowedFileRoots()`（由 pi 会话 cwd / projectRoot 推导）里，于是被文件访问 allowlist 拒绝。allowlist 的职责是约束用户可控路径，对服务端自选目录施加校验属于误用。

第二个触发面：同一实例上 `?cwd=<agent workspace>` 在 workspace 不在 allowlist 时同样 403，这正是 UI 的首次请求。

## 修复

`app/api/models/route.ts` 仅对**显式传入且非空**的 `cwd` 执行 allowlist：

```ts
const requestedCwd = new URL(req.url).searchParams.get("cwd");
// No cwd (including an empty value) means the server chooses its own working
// directory ... not user-controlled input, so the file-access allowlist does
// not apply to it.
const hasExplicitCwd = Boolean(requestedCwd);
const cwd = resolve(requestedCwd || process.cwd());

// stat / isDirectory 400 检查保持不变
if (hasExplicitCwd) {
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
}
```

- 未传 `cwd` 与 `?cwd=`（空串）→ 服务端目录，跳过 allowlist。
- 显式 `cwd` → 400（不存在 / 非目录）与 403（不在 allowlist）语义不变。
- 未改 `lib/file-access.ts`、`lib/model-listing.ts`、`components/`。

## 测试决策

新增 `app/api/models-route.test.mjs`（node:test + jiti，`createJiti(import.meta.url, { tsconfigPaths: true })` 导入 `./models/route.ts`），三条用例：

| 用例 | 断言 |
| --- | --- |
| `GET /api/models`（无 cwd） | `status === 200`，body 为对象且 `Array.isArray(body.modelList)` |
| `GET /api/models?cwd=<mkdtemp 临时目录>` | `status === 403`，`body.error === "Access denied"` |
| `GET /api/models?cwd=`（空串） | 与无 cwd 相同 |

- 无 cwd 的用例把 `process.cwd()` 切到 `mkdtempSync` 的临时目录（`t.after` 恢复并清理），让「服务端自选目录不在 allowlist」在任何机器上都可复现，不依赖仓库所在路径是否恰好是某个 pi 会话的 cwd。
- 测试在 import 路由前把 `PI_CODING_AGENT_DIR` 指向空的 `mkdtemp` 目录（沿用 `lib/tool-path-guard-extension.test.mjs` 的隔离约定）：allowlist 不再由开发机真实会话推导，显式 cwd 的 403 成为确定性结果；`loadModels` 也不再读取真实 `~/.pi/agent` 配置。
- 只断言状态码与数组存在，不依赖本机模型数量（SDK 环境缺失时路由自身的 `EMPTY_MODELS` 兜底仍是 200）。
- 不触碰 `~/.worksplice`，不写仓库外持久数据。

## 红 → 绿证据

**红（base commit `b1637b9` 的隔离 worktree，使用最终版测试文件）：**

```text
$ git worktree add --detach /tmp/models-route-red-base b1637b9
$ ln -s <本 worktree>/node_modules /tmp/models-route-red-base/node_modules
$ cp app/api/models-route.test.mjs /tmp/models-route-red-base/app/api/
$ cd /tmp/models-route-red-base && node --test app/api/models-route.test.mjs
✖ GET /api/models without cwd does not apply the file-access allowlist to the server cwd (5.261959ms)
✔ GET /api/models?cwd=<unlisted dir> still rejects explicit cwd outside the allowlist (3.873123ms)
✖ GET /api/models?cwd= (empty) behaves like no cwd (1.299708ms)
ℹ tests 3
ℹ pass 1
ℹ fail 2

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
403 !== 200
    at assertModelsOk (.../models-route.test.mjs:45:10)
```

证明显式 cwd 的 403 在 base 上本来就成立，红的是「无 cwd / 空串不应 403」两条。

**绿（修复后）：**

```text
$ node --test app/api/models-route.test.mjs lib/models-cache.test.mjs
✔ GET /api/models without cwd does not apply the file-access allowlist to the server cwd (56.49275ms)
✔ GET /api/models?cwd=<unlisted dir> still rejects explicit cwd outside the allowlist (90.92375ms)
✔ GET /api/models?cwd= (empty) behaves like no cwd (21.364583ms)
✔ caches model data independently for each cwd
✔ shares one loader between concurrent requests for the same cwd
✔ does not cache a stale load that finishes after invalidation
✔ retries after a model load fails
✔ adds runtime errors without discarding available models
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

**门禁：**

```text
$ npm run typecheck
> tsc --noEmit
EXIT=0

$ npx eslint app/api/models/route.ts app/api/models-route.test.mjs
EXIT=0
```

## Out of Scope

- 不改 `components/AgentDetailPanel.tsx` / `CreateAgentModal.tsx` 的请求与回落逻辑。
- 不改 `lib/file-access.ts`、`lib/model-listing.ts`、`lib/models-cache.ts`。
- 不改 allowlist 的其它调用点、PATCH runtime 路由。
- 不做格式化重排；不引入新依赖；不新建 lib 模块。
- 不跑全量 `npm test`（本票门禁只跑新增用例 + `lib/models-cache.test.mjs`）。

## Review

固定点 `b1637b9`，双轴（Standards + Spec）并行 review，结论如下；所有采纳项已落回本 diff 并重跑门禁。

### Standards

| Finding | 处置 |
| --- | --- |
| 【硬违规】`route.ts` 新增注释与测试 JSDoc 为英文，违反 `docs/engineering-standards.md` §1「代码注释一律简体中文」 | 已全部译为中文 |
| 【判断题】`hasExplicitCwd = Boolean(requestedCwd)` 与语义不符：`?cwd=` 是显式传入但标志为 false | 改名为 `hasNonEmptyCwd`，注释明确「未传 cwd（含空串）」 |
| 【判断题】注释末句「explicit `cwd=` 仍校验」与前文「空串豁免」自相矛盾 | 改为「非空 cwd 仍按下方逻辑校验」 |
| 【判断题】测试 a/c 断言块逐字重复 | 抽 `assertModelsOk(response)` |
| 【判断题】`*-route.test.mjs` 在工程规范里写作 `readFile` 源码断言，本测试直调 GET | 与现存 `app/api/task-thread-read-route.test.mjs` 一致；属规范文本落后于惯例，本票不改文档（Out of Scope） |
| 【判断题】测试未隔离真实 pi 会话/配置，403 前提依赖开发机环境 | 采纳：import 前把 `PI_CODING_AGENT_DIR` 指向空 `mkdtemp`，allowlist 空集、403 确定性成立 |

### Spec

| Finding | 处置 |
| --- | --- |
| (a) 规格缺失/部分实现 | 无。逐条核对：非空 cwd 才进 allowlist；空串走服务端目录；stat/400 顺序与显式 403 语义未变；未改 lib/components；三条用例与清理齐备 |
| (b) scope creep | 无。diff 仅 `route.ts`（+13/−5）与新增测试 |
| (c) 测试非 hermetic：显式 cwd 会扫描真实 `~/.pi/agent/sessions` 并对会话 cwd 跑 git；无 cwd 路径读取真实 auth/models/trust | 已采纳同上隔离方案；测试现在不读写真实用户配置，也不再依赖真实会话推导 allowlist |

Review 后重跑：`node --test app/api/models-route.test.mjs lib/models-cache.test.mjs` 8/8 通过；`npm run typecheck` 通过；两个改动文件 eslint 通过。红证据在隔离 base worktree 上用最终版测试重新取证（见上）。

## Answer

**PR:** [#186](https://github.com/whutlichao/worksplice/pull/186)　**分支:** `agent-detail-model-picker`　**提交:** `0499593`
**PR body:** `/tmp/agent-detail-model-picker-pr-body.md`（仓库外临时路径；同内容见 PR #186，按 `pr` skill 的 Summary / Evidence / Merge Danger 模板）

- **修复**：`app/api/models/route.ts` 增加 `hasNonEmptyCwd` 判定——只有非空 `cwd` 查询参数才执行 `getAllowedFileRoots()` + `isExistingFilePathAllowed()`；无 cwd / 空串使用 `resolve(process.cwd())` 并跳过 allowlist。`stat` / `isDirectory` 的 400 检查顺序与显式 cwd 的 403 语义保持不变。
- **回归测试**：`app/api/models-route.test.mjs` 三例（无 cwd 200 / 显式不在 allowlist 403 / 空串 200），通过 `PI_CODING_AGENT_DIR` + `process.cwd()` 双重隔离，不读写真实用户目录与配置。
- **红→绿**：base `b1637b9` 隔离 worktree 上 1 pass / 2 fail（`403 !== 200`）；修复后 `node --test app/api/models-route.test.mjs lib/models-cache.test.mjs` 8/8 通过，`npm run typecheck` 与两个改动文件的 eslint 均 EXIT=0。
- **Review**：双轴 review 完成，Standards 1 条硬违规（英文注释）+ 若干判断题、Spec 1 条测试隔离问题，全部采纳并重跑门禁；未采纳项仅为「规范文本落后于现有 route 测试惯例」，属本票 Out of Scope。
- **未做**：全量 `npm test`、UI 组件改动、`lib/file-access.ts` / `lib/model-listing.ts` / `lib/models-cache.ts` 改动（均按票面门禁与 Out of Scope）。
