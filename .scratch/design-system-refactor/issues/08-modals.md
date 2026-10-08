# 08 — 模态族与设置面弹窗

**What to build:** `components/BrutalModal.tsx` 换 `.overlay`（scrim + blur）+ `.modal`（`--r-xl` + `--shadow-pop`）+ `.modal-head` / `.modal-body` / `.modal-foot`；`--modal-max` 440px / `--modal-wide-max` 560px 替换硬编码宽度。**模块名与对外 props 不改**（改名零视觉收益）。四个模态内容：`CreateChannelModal`（`.field` + `.member-pick` / `.member-opt` 可挑胶囊 + `.radio-card` / `.radio-row` + 底部 `.btn.btn-primary`）、`CreateAgentModal`（同上 + `.select` / `.input`）、`ReminderModal`（原型「提醒」模态形态；`datetime-local` 与 recurrence chips 是本仓独有，按 ED-3/ED-5 外推）、`MyRemindersModal`（行 = `.kv` 形态：频道名 + 锚点 seq mono + 下次触发时间 mono + `.btn-sm` snooze/cancel）。`DirectoryPicker` 与 `ProjectTrustDialog` 一并换 token（危险动作走 `.btn-danger` / `--error`）。

**Blocked by:** 04

**Status:** pending

- [ ] 模态外壳为 `.overlay` + `.modal`；无 2px ink 边框、无硬偏移阴影
- [ ] 宽度来自 `--modal-max` / `--modal-wide-max`
- [ ] 模态内每个可聚焦元素有焦点环（`--accent-soft` 环或 `:focus-visible` outline）
- [ ] `components/CreateChannelModal.test.mjs` / `CreateAgentModal.test.mjs` / `ReminderModal.test.mjs` 既有断言全绿
- [ ] `DirectoryPicker` 选中行 = `--accent-soft` 底 + `--accent` 文字（不是黄色实心）
- [ ] **成员挑选项头像**（`CreateChannelModal.tsx:181`）尺寸 28 → 22px（`size="sm"`）；挑选项本身的行高与选中态重校（票 04 已迁到 `Avatar`，本票只收行高与容器形态）
- [ ] `npm test` / `tsc --noEmit` 通过

## Answer
