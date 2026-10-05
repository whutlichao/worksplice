# 03 — 右栏容器 + 人类资料卡

**What to build:** 右栏内容统一由新容器组件按 kind 分派（agent 变体承接 02 直接挂载的现有 agent 详情面板；human 变体 = 薄资料卡：头像/名字/角色/描述/状态点）；人类成员点击（成员面板 / @提及）从模态框改为右栏展示；人类简介弹窗路径删除。

**Blocked by:** 02 — 中央/面板状态解耦 + 非长驻右栏 + 左栏高亮

**Status:** resolved

- [x] 点人类 → 右栏资料卡，channel 保持可操作（无模态阻塞）
- [x] 简介弹窗代码路径移除
- [x] agent 变体经容器渲染，行为与 02 一致
- [x] 容器渲染测试（node --test）：agent 变体渲染详情区块、human 变体渲染资料卡
- [x] tsc + eslint 通过

## Answer

随 commit `d580305`（#13）落地，`components/DetailPanel.tsx`：

- **容器按 kind 分派**：`agent` → `AgentDetailPanel`（原样承接 02 行为）；`human` → `HumanProfileCard` 薄资料卡（头像/名字/角色徽标/描述/状态点）；`thread` → `ThreadPanel`（04）；未知 id 空渲染不炸
- **人类点击改右栏**：mention 点击 → `memberPanel`（human）→ 右栏资料卡，channel 保持可操作、无模态阻塞
- **弹窗路径删除**：`MemberProfileModal.tsx` 整体删除（+ 对应 i18n 死键移除）
- **测试**：`components/DetailPanel.test.mjs` agent/human/thread 三变体渲染断言 + 未知 agent 空渲染 + 轮询纪律源码断言全绿
