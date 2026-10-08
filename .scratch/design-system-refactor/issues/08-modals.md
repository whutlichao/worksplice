# 08 — 模态族与设置面弹窗

**What to build:** `components/BrutalModal.tsx` 换 `.overlay`（scrim + blur）+ `.modal`（`--r-xl` + `--shadow-pop`）+ `.modal-head` / `.modal-body` / `.modal-foot`；`--modal-max` 440px / `--modal-wide-max` 560px 替换硬编码宽度。**模块名与对外 props 不改**（改名零视觉收益）。四个模态内容：`CreateChannelModal`（`.field` + `.member-pick` / `.member-opt` 可挑胶囊 + `.radio-card` / `.radio-row` + 底部 `.btn.btn-primary`）、`CreateAgentModal`（同上 + `.select` / `.input`）、`ReminderModal`（原型「提醒」模态形态；`datetime-local` 与 recurrence chips 是本仓独有，按 ED-3/ED-5 外推）、`MyRemindersModal`（行 = `.kv` 形态：频道名 + 锚点 seq mono + 下次触发时间 mono + `.btn-sm` snooze/cancel）。`DirectoryPicker` 与 `ProjectTrustDialog` 一并换 token（危险动作走 `.btn-danger` / `--error`）。

**Blocked by:** 04

**Status:** resolved

- [x] 模态外壳为 `.overlay` + `.modal`；无 2px ink 边框、无硬偏移阴影 —— `BrutalModal.tsx` 只写 `className`；断言 `components/BrutalModal.test.mjs`（markup 无 `rgba(20, 17, 17`／无 `6px 6px 0 0`；`.modal` 规则体无 `2px solid`／无 `var(--ink)`）
- [x] 宽度来自 `--modal-max` / `--modal-wide-max` —— `.modal{max-width:var(--modal-max)}` + `.modal.wide{max-width:var(--modal-wide-max)}`；调用点按档位走 `.modal` / `.modal wide`（CreateChannel / Reminder / MyReminders 走 wide，CreateAgent 走默认档）
- [x] 模态内每个可聚焦元素有焦点环（`--accent-soft` 环或 `:focus-visible` outline） —— 四个模态 + 外壳的渲染断言逐条扫描 `<button|input|select|textarea>` 无 inline `outline`；reset 段 `:focus-visible{outline:2px solid var(--accent)}` 与字段 `--accent-soft` 环（票 02）承担视觉
- [x] `components/CreateChannelModal.test.mjs` / `CreateAgentModal.test.mjs` / `ReminderModal.test.mjs` 既有断言全绿 —— 三份既有断言未删未改（只追加），全量 `npm test` 1195 pass / 0 fail
- [x] `DirectoryPicker` 选中行 = `--accent-soft` 底 + `--accent` 文字（不是黄色实心） —— **豁免**：该组件无「选中行」实体（目录行是导航入口），且 `createPortal` + `renderToStaticMarkup` 不跑 effect ⇒ markup 断言不可达；协调裁决 Q1-B 判为票面需求写错，改为形态收口（行 hover `--fg-soft`），见 Answer「Q1-B」
- [x] **成员挑选项头像**（`CreateChannelModal.tsx:181`）尺寸 28 → 22px（`size="sm"`）；挑选项本身的行高与选中态重校 —— 挑选项换 `.member-pick` / `.member-opt` 胶囊（`--r-pill`，内嵌 22px `.avatar.sm`），选中态 `.is-on` = `--accent-soft` 底 + `--accent` 字 + `--accent-line` 边；断言在 `CreateChannelModal.test.mjs`
- [x] `npm test` / `tsc --noEmit` 通过 —— 1195 pass / 0 fail；tsc 无输出；lint 0 error / 1 warning（同基线 `hooks/useI18n.tsx:61`）

## Answer

**交付面（7 个组件模块 + globals.css 追加段 + 7 份测试）**

| 文件 | 改动 |
| --- | --- |
| `app/globals.css` | **只追加** 44 行模态族 class 块（`.overlay` / `.modal*` / `.member-pick` / `.member-opt` / `.radio-*` / `.kv` 逐字搬上游 + `.directory-picker-entry` 两条收口规则），未覆盖他人段落 |
| `components/BrutalModal.tsx` | 外壳换 `.overlay` + `.modal` + `.modal-head` / `.modal-body` / `.modal-foot`；宽度两档；`width` 降级为**档位选择器**（模块名与 props 名不变） |
| `components/CreateChannelModal.tsx` | `.field` / `.input` / `.textarea` + `.radio-row` / `.radio-card` + `.member-pick` / `.member-opt`（内嵌 22px `Avatar size="sm"`）+ `.modal-foot` 的 `.btn` / `.btn.btn-primary`；走 wide 档（原型 `openNewChannel` 是 wide） |
| `components/CreateAgentModal.tsx` | 同上；模型 / 推理选择仍由 `ModelPicker` 承担（不在本票 Ownership） |
| `components/ReminderModal.tsx` | 原型「提醒」形态：`.modal-body` 字段 + 既有提醒列表 + `.modal-foot`；`datetime-local` 与 recurrence chips 按 ED-3/ED-5 外推；取消 = `.btn.btn-sm.btn-danger` |
| `components/MyRemindersModal.tsx` | 行 = `.kv`（标题 + 频道名 + 锚点 seq mono + 下次触发 mono）+ `.btn-sm` 动作；取消 = `.btn.btn-sm.btn-danger` |
| `components/DirectoryPicker.tsx` | 形态收口：目录行底色 / 文字从 inline 移到 `.directory-picker-entry`（否则 hover 永不生效），hover 走 `--fg-soft`；票 10 的 token 换皮未回退 |
| `components/ProjectTrustDialog.tsx` | 两个动作走 `.btn` / `.btn.btn-primary`；弹窗宽度走 `var(--modal-max)`；「信任项目」不红化（Q2-A） |

新增 4 份测试（`BrutalModal` / `MyRemindersModal` / `ProjectTrustDialog` / `DirectoryPicker`），扩写 3 份（`CreateChannelModal` / `CreateAgentModal` / `ReminderModal`）：+33 断言，既有断言一条未删。

**红 → 绿证据（真实执行，逐切片）**

| 切片 | 红 | 绿 | 修了什么 |
| --- | --- | --- | --- |
| 1 模态外壳 | `node --test components/BrutalModal.test.mjs` → 8 fail / 1 pass | 9 pass | `globals.css` 追加 `.overlay` / `.modal*` 块 + `BrutalModal.tsx` 换 class 外壳 |
| 2 CreateChannelModal | 同文件 5 fail | 8 pass | 字段 / 单选卡 / 成员胶囊 / `.modal-foot` |
| 3 CreateAgentModal | 3 fail | 14 pass | 同上 + 启动助手入口 `模型为空` 提示字号落标尺 |
| 4 ReminderModal | 3 fail | 6 pass | `.modal-body` / `.modal-foot` + `.field` / `.input` / `.select` + 导出 `ReminderRow`（`.kv` + `.btn-danger`） |
| 5 MyRemindersModal | 4 fail | 4 pass | 导出 `MyReminderRow`（`.kv` + `.btn-sm` + `.btn-danger`）+ `.modal-body` |
| 6 picker / dialog | 2 fail | 8 pass | 目录行 class 化（hover）+ 信任对话按钮走原语 |

红证据来自需求语言（`.overlay` / `.modal` / `.member-opt` / `--avatar-sm` / `.btn-danger`），不是实现细节；`DirectoryPicker` 因 `createPortal`（SSR 下 `portalTarget=null` ⇒ 组件 `return null`）降级为 CSS 规则 + 源码级 seam，降级理由已写在 `components/DirectoryPicker.test.mjs` 文件头。

**协调裁决（两条，均经 `orchestration ask` 问回，非自决）**

- **Q1-B（DirectoryPicker「选中行」）**：票面这条验收假设该组件有选中态，实际没有——目录行是导航入口（点击即进入），唯一与「当前目录」绑定的是 path 输入框；且它 `createPortal` 挂 body，`renderToStaticMarkup` 不跑 effect 时组件直接 `return null`，markup 级断言**物理不可达**。裁决：**豁免该条**，只做形态收口（圆角角色 / 边框 / hover `--fg-soft`），并要求照实登记技术依据。已按此落地，未新造「未编辑态高亮」这种原型之外的形态。
- **Q2-A（危险动作落点）**：danger 的语义是「破坏性 / 不可逆」而非「授权」。裁决：危险动作 = 提醒的 cancel（`ReminderModal` / `MyRemindersModal` 的 cancel = `.btn.btn-sm.btn-danger`，`--error` 描边 + 文字）；`ProjectTrustDialog` 的「信任项目」保持 `.btn.btn-primary`（红化会反转模态主操作层级）。

**搬运偏离登记（相对上游逐字块；均为裁剪，未改值）**

1. `.modal-head .sub` / `.radio-card span` / `.reminder-row*` **不搬**：本仓模态无 sub 槽、radio-card 无副标题、提醒行取 `.kv`（票面要求）——三个槽位零消费者，按票 04 先例（`.avatar img` 槽位退役）裁掉，避免死规则。
2. `.modal` 的 `overflow: hidden` 被该元素上的 inline `maxHeight: min(640px, 90dvh)` + `overflowY: auto` 覆盖：保住旧外壳「超高内容整体可滚动」的行为（形态改动不带行为回归），代码注释在 `BrutalModal.tsx`。
3. `.overlay` 的 `z-index` 由旧内联 `600` 换 `var(--z-overlay)`（=60）：设计系统 z 阶梯里 `rail 50 / dock 55 < overlay 60`。模态内部的 `ModelPicker` 下拉（inline 600）位于 overlay 的层叠上下文内，照常压住模态内容；既有字面量 z（`ChannelView` 菜单 100、`ChatInput` 120/500）理论可盖住 scrim，未找到可达路径（菜单在点开模态的那次点击时即关闭），登记为残留风险。
4. 关闭按钮的 `onMouseDown` / `onMouseUp`（写 inline 硬阴影 + 位移的按压反馈）随形态退场：它们只改样式表达，新形态的交互反馈由 `.icon-btn:hover` / `:focus-visible` 承担；`onClick` / `aria-label` / Esc / backdrop 关闭逻辑未动。
5. 上游逐字字号（`.modal-head h2` 15px、`.radio-card b` 12.5px、`.member-opt` 12px 等）保留在原位——上游契约优先于 ED-5 标尺枚举。

**双轴 code-review（Standards + Spec 两份报告，未合并；两个 fresh 只读 reviewer 并行）**

| Finding | 轴 | 判定 | 处理 |
| --- | --- | --- | --- |
| `CreateChannelModal` 把 `body.error ?? "…"` 改成 `||`（`{error:""}` 语义漂移） | Standards（硬违规）· Spec（P2） | 属实 | **已修**（收口 commit 还原 `??`） |
| `CreateChannelModal` 未走 wide 档，原型 `openNewChannel` 是 `wide:true` | Spec（P1） | 属实 | **已修**（调用点传 `width={520}` 走 `.modal.wide`，并加断言） |
| 票正本未收敛（Status / 勾选 / Answer） | Spec（P1） | 属实 | **本次收敛** |
| 死规则：`.reminder-row*` / `.modal-head .sub` / `.radio-card span` 零消费者 | Standards（判断题）· Spec（P2） | 属实 | **已修**（三个槽位整体不搬，见偏离登记 1） |
| `width > 440` 把 `--modal-max` 的 440 复制进 TS | Standards（Primitive Obsession，判断题） | 属实 | **部分修**：提成命名常量 `MODAL_MAX_PX` 并注明来源 token；props 名按票面保留 |
| `feedbackStyle` 在两个提醒模态逐字重复；`ReminderRow` / `MyReminderRow` 约八成重复 | Standards（Duplicated Code，判断题） | 属实 | **豁免**：两行数据形状不同（一个带频道 / 锚点 / 定位，一个没有），共享接口会被两个调用点塑形；抽公共行组件等于新增模块，越出本票 Target（7 个模块 + globals.css 追加段） |
| `blockBody` / `escapeRe` 在 4 份新测试里各留一份 | Standards（判断题） | 属实 | **豁免**：spec 的 Testing Decisions 明写「复用两条 seam，**不新增夹具**」；本仓既有测试亦各自持有这份 6 行 helper |
| `.modal-head h2` 15px / `.radio-card b` 12.5px 不在 `--fs-*` 枚举内 | Standards（登记项） | 上游逐字 | **豁免**：上游契约优先（同偏离登记 5） |
| 同一模态内两个 accent 实心 CTA（启动助手 + 创建） | Standards（登记项） | 动作不同 | 登记，不改（各有其动作，非同一动作的第二主按钮） |

两份报告的收尾裁决均为 **Merge verdict: OK with notes**；上述 P0/P1/硬违规项已全部落地，判断题按理由豁免并留痕。

**零行为改动自查（机械证据）**

- i18n key 集合 / `fetch(...)` 调用 / `use(State|Effect|Callback|Ref)(...)` 签名，四个模态逐文件与 `HEAD~2` 对照 **diff 为空**。
- props 名、事件处理（`onClick` / `onChange` / `onKeyDown` / `disabled`）、轮询常量（`REFRESH_MS = 15_000`）、`baseSeq` 来源、`role` / `aria-*` / `id` 关联未动；模态开关逻辑、Esc、backdrop 关闭、提交 / 校验流程一字未改。
- 新增两个**导出**（`ReminderRow` / `MyReminderRow`）是渲染面 seam，与既有 `ModelsEmptyHint` / `TaskHistoryList` 同一条先例；模块内部消费同一个函数，不产生第二份实现。

**红线自查（`git diff d387cfa HEAD --name-only`）**

- `lib/**`：**0 个**文件（`lib/i18n` 也未改）；`app/api/**`：**0 个**。
- 票 03 / 06 所属文件（`AppShell` / `WorkspaceSidebar` / `ChannelView`）：**不在清单**。
- `hooks/useIsMobile.ts` / `worksplice-design-system/**` / `spec.md` / 其他票文件：**0 改动**；`components` 侧只碰本票 Ownership 的 7 个模块 + 测试；无新增 emoji（图标仍走 lucide）。
- `git diff --numstat`：无整文件重写；`app/globals.css` 对 base 是 **44 增 / 0 删**（纯追加）。

**门禁输出（本 worktree，收口后）**

```text
npm test                              → 1195 pass / 0 fail（基线 1162；本票 +33）
node_modules/.bin/tsc --noEmit        → 通过（无输出）
npm run lint                          → 0 error / 1 warning（同基线 hooks/useI18n.tsx:61）
grep -c '@keyframes' app/globals.css  → 13（= 基线，未减）
prefers-reduced-motion: reduce        → 3 处（= 基线，未减）
git diff d387cfa HEAD --numstat -- app/globals.css → 44 0（只追加）
```

残留风险（登记，不阻塞）：一次全量跑出现环境性 flake——`lib/bash-containment-extension.test.mjs` 的沙箱用例在并行负载下 172s 超时并连带 `lib/domain/collab/observability-route.test.mjs` 失败；两份文件单独重跑全绿，其后两次全量跑均 1195 / 0。与本次改动面（`components/**` + `app/globals.css`）无关。

**PR:** [#115](https://github.com/whutlichao/worksplice/pull/115)
