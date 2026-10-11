# 01 — Pinned 消息定位高亮

Type: task
Status: resolved

## Problem Statement

从 pinned 列表点击当前频道主消息流消息时，滚动定位已有，但目标行缺少明确的短暂视觉反馈。

## Solution

遵循 `.scratch/pinned-message-highlight/spec.md`：主消息流目标未加载时用现有 `loadEarlier/hasMore` 分页加载到目标后再定位；分页请求在频道切换后不得将旧频道结果写入当前消息流；给目标行加短暂高亮，并在重复点击时重启高亮；thread pinned 项继续只打开右栏线程。

## Acceptance

- 仅修改本行为所需的 `ChannelView`、`useChannelData` 迟到分页响应守卫、对应样式、测试与本票文档。
- 先新增紧贴问题的回归测试并证明红，再实现并证明绿；断言产品渲染出的目标行样式，而非只查 class 字符串。
- 主消息流目标不在当前消息页时，使用现有 `loadEarlier/hasMore` 逐页加载到目标再定位；目标比最新页更新时重拉最新页；频道切换后旧分页响应不可写入当前消息流。
- 验证重复点击会重新开始/延长高亮且到期后自动消退；thread pinned 项行为不变。
- 跑对应精确测试、`node_modules/.bin/tsc --noEmit`、`npm run lint`；不跑全量测试、不运行 `next build`。
- 用 ego-browser 在隔离的临时数据目录中验证真实页面，不触碰用户数据，并保存可核验截图。
- Answer 记录红绿、验证、浏览器证据、Standards 与 Spec 两份原始 review 及 finding 处置；记录文件清单与 PR 号；完成后 `Status: resolved`。

## Answer

### 实施与 TDD

- `ChannelView` 的主流 pinned 导航在旧目标未加载时逐页调用 `loadEarlier`，比最新页新的目标触发最新页刷新；加载完成后居中滚动并短暂高亮，重复点击重新计时。thread pinned 仍只打开右栏。
- `useChannelData` 的分页响应捕获频道 ID 与频道代际；频道切换（包括 A→B→A）后，旧分页成功或错误响应均不再写当前状态。
- RED：新增 `isCurrentChannelRequest` 回归测试后，`node --test hooks/useChannelData.test.mjs` 按预期因 `isCurrentChannelRequest is not a function` 失败；实现代际判定后 GREEN。
- 渲染测试断言真实消息行的背景/内描边样式；分页决策测试覆盖两页未命中、下一页命中、更新目标重拉、不可用目标和请求错误状态。

### 验证

- `node --test components/ChannelView.test.mjs hooks/useChannelData.test.mjs`：88/88 通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- `npm run lint`：0 errors；仅有既存 warning：`hooks/useI18n.tsx:61` 的 `locale` 依赖提示。
- pi-lens LSP：`components/ChannelView.tsx`、`hooks/useChannelData.ts` 均为 0 diagnostics；基线差异 `git diff --check` 通过。
- 按约束未运行全量测试或 `next build`。

### 浏览器验收与决策记录

- **Q→A（人工批准）**：原获批 ego-browser TaskSpace 9 返回 `task space not found: 9`，无法恢复。人工再次明确批准为本目标新建且仅复用一个隔离替代 TaskSpace。实际使用 Space 10；完成后执行 `finish({ keep: [] })`。浏览器使用独立临时数据目录（`/tmp/worksplice-pinned-highlight-followup.eDjXS1`），已停止临时服务器并删除数据目录，未触碰用户数据。
- pinned #5 起初不在当前页（最新页首 seq 82）；实际向前分页请求 `before=82`、`before=32` 后加载目标，定位中心误差约 0.23px，并出现高亮。
- 重复点击后高亮继续可见，计时到期后高亮消退且消息正文未变；thread pinned 显示锚点 #131 与回复，主消息流 `scrollTop=166` 不变且目标行没有高亮。
- 截图：`.scratch/pinned-message-highlight/evidence/pinned-old-message-active.png`、`pinned-old-message-repeated.png`、`pinned-old-message-restored.png`、`pinned-old-thread-opens-panel.png`。

### 双轴审查及 finding 处置

#### 首轮 Standards 结果摘要（后续已修复）

> ## Review — Standards (首轮)
> - Finding 1 — 已解决。定位请求记录 `requestedLoadError`；错误相对请求基线变化时清除 pending，若向前分页前已有错误则先 `loadLatest` 清错再继续（`components/ChannelView.tsx:2700–2740`）。新增测试覆盖错误识别（`components/ChannelView.test.mjs:127–133`），浏览器证据覆盖跨页定位、高亮重启/消退及 thread 行为。
> - Finding — P1：切换频道时，未完成的旧频道 `loadEarlier()` 仍无条件 `setMessages(prev => prependPageMessages(prev, page.messages))`，可能把旧频道消息混入新频道流。`ChannelView.tsx:2728–2738` 调用该异步方法，但频道切换只清 pending，不取消请求；`hooks/useChannelData.ts:987–996` 未检查请求频道。建议在 `loadEarlier` 响应提交前校验频道/请求代际。
> - Judgement-call smell：真实浏览器覆盖了重复点击与消退，但自动化测试未覆盖计时和异步滚动；建议后续增强，不另列 finding。
> - Merge verdict: BLOCK。

#### 首轮 Spec 结果摘要（后续已修复）

> ## Review — Spec (首轮)
> - Finding 1 — 已解决。Spec 已明确旧消息用 `loadEarlier/hasMore` 逐页加载到目标；测试覆盖多页后命中。
> - Finding 2 — 部分解决，仍有 P2。隔离 ego-browser 记录和截图覆盖重复点击、消退及 thread 右栏；但测试只有渲染断言和纯分页/错误决策，没有重复点击计时、到期清除或 thread 不改变主流位置的行为级回归测试。手动证据不替代自动回归；若 finding 只要求手动验收则已解决，自动测试仍有缺口。
> - Finding 1 不再成立；仍有一项 P2，无其他发现。
> - Merge verdict: OK with notes。

#### finding 处置

- 请求失败后 pending 残留：加入 `requestedLoadError` 基线检测；错误变化时清理 pending。若旧错误已存在，重试旧页前先 `loadLatest` 清错。
- Standards P1 跨频道迟到分页：`useChannelData` 增加频道代际 ref；`loadEarlier` 仅在请求频道与代际仍当前时提交消息、`hasMore` 或错误。代际测试覆盖 A→B 及 A→B→A 的拒绝条件。
- Spec 旧页要求：spec/票据明确逐页加载、较新目标刷新最新页、切频道丢弃旧页；测试覆盖两页未命中后命中。
- 重复点击、淡出与 thread 行为：由隔离 ego-browser 的真实页面验证及四张截图覆盖；自动行为级断言缺口按最终 Spec 复审结论保留为非阻塞后续建议。

#### 最终 Standards 复审原始结果

> ## Review — Standards (最终复审)
>
> - **Correct**：`loadEarlier` 同时校验请求频道 ID 与请求代际（`hooks/useChannelData.ts:1001–1019`）；频道切换 effect 每次递增代际（`hooks/useChannelData.ts:797`）。A→B→A 时，即使频道 ID 回到 A，代际仍不同，旧请求的成功结果和错误都会被丢弃。因此上一轮 P1 已解决。
> - **无新增 stale/error/依赖问题**：守卫覆盖消息、`hasMore` 与 `loadError` 的提交；ref 不需加入 `useCallback` 依赖。测试覆盖频道变化及同频道代际变化（`hooks/useChannelData.test.mjs:176–180`）。
> - 浏览器成功路径证据与实现一致；未直接读取截图。现有测试没有端到端断言 A→B→A 的 hook 生命周期，但纯函数覆盖代际拒绝条件，且浏览器验证了主要交互；不构成当前 finding。
> - **No issues found.**
> - **Merge verdict: OK**

#### 最终 Spec 复审原始结果

> ## Review — Spec (最终复审)
>
> - **原 Finding 1 — 已解决。** Spec 明确规定旧目标用 `loadEarlier/hasMore` 逐页加载、较新目标刷新最新页和切频道丢弃迟到响应（`.scratch/pinned-message-highlight/spec.md`，Solution/Scope）。`ChannelView.test.mjs` 覆盖连续两页后才加载到目标；`useChannelData.test.mjs` 覆盖旧频道/旧代际请求判定。
> - **原 Finding 2 — 手动验收已解决；自动化缺口为非阻塞备注。** 隔离 ego-browser 验证及截图覆盖重复点击后仍高亮、随后消退、thread pinned 打开右栏且主流不变。当前差异没有对这些交互增加自动行为断言，但票据要求“验证”，并未限定必须自动化；已有真实浏览器证据，不构成 Spec 阻塞项。
> - **最终 Spec finding 列表：无。** 非阻塞备注：后续可增加重复点击计时、消退和 thread 主流位置的自动回归测试。
>
> Merge verdict: OK with notes

### 文件清单与交付

- `components/ChannelView.tsx`、`components/ChannelView.test.mjs`、`hooks/useChannelData.ts`、`hooks/useChannelData.test.mjs`、`app/globals.css`。
- `.scratch/pinned-message-highlight/spec.md`、本票及 `evidence/` 下浏览器截图。
- PR：[#154](https://github.com/whutlichao/worksplice/pull/154)（OPEN，base `main`，merge state `CLEAN`）。
