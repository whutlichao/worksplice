# 01 — Agent 头像不使用中性色格

**Type:** task
**What to build:** 修复 agent 字符串 member ID 的哈希可能落入中性 `av-4` 的问题。根据 `.scratch/macaron-palette/spec.md` D8，agent ID 只映射 `av-0…av-3`，`av-4` 保留给 human；保留调色板、FNV-1a、稳定 ID 与数字 key 的显式调色板位置语义。

**Status:** claimed

## 验收条件
- [x] 使用 `Avatar` 的 `renderToStaticMarkup` 接缝新增真实 markup 回归断言：`agent-fixture-0` 不渲染 `av-4`、agent 色调属于 `av-0…av-3`、human 恒为 `av-4`。
- [x] 同一 ID 在消息、侧栏、成员挑选项的真实渲染 markup 上保持同色。
- [x] 记录同一回归测试红→绿；数字 key 保持显式 palette 位置含义。
- [x] 运行指定窄测试、`npm run typecheck`；对 base commit 和修改后运行 `npx eslint components/Avatar.tsx components/Avatar.test.mjs` 并比较新增问题。
- [x] 在隔离的临时 `WORKSPLICE_DATA_DIR` 演示数据上启动 app，经 ego-browser 查看侧栏 agent 和频道消息头像均显示有色 `av-0…av-3`；截图保存到 `/tmp/orch-worksplice/evidence/avatar-agent-tint/`，不得读写 live 数据。
- [x] Answer 记录诊断、红绿证据、文件清单、门禁与独立的 `## Standards` / `## Spec` 双轴 review（两节不可合并或重排）；finding 已修复或逐条说明豁免。
- [ ] Status 收敛为 `resolved`；提交并推送分支，创建 OPEN PR 并回填 PR 号。

## 范围与约束
- 仅改 `components/Avatar.tsx`、`components/Avatar.test.mjs`、本票正本及本票 Answer；仅允许为跨面验证更新 `components/message-stream.test.mjs`。
- 不改 CSS/token、成员数据或其他调用行为；不读写用户 live 数据；遇到需要人类、凭证、第三方或不可逆操作时升级协调者。

## Answer

### 诊断、实现与红→绿
- 根因：`avatarTint` 对字符串 member ID 使用五格色板取模；FNV-1a 对 `agent-fixture-0` 得到 `av-4`。修复仅将字符串 ID 的模数限定为 `AVATAR_TINTS - 1`（四格）。FNV-1a、稳定 ID、五格 palette、human 默认 `av-4` 与 numeric `colorKey` 的显式位置语义保持不变。
- 测试先行：新增的 `renderToStaticMarkup` agent 回归在修复前失败，实际输出 `class="avatar av-4"`；修复后同断言通过。human 断言恒为 `av-4`，numeric agent `colorKey: 4` 仍明确选到 `av-4`，以区分显式 palette 位置与 member-ID 哈希。
- 跨面测试把同一个 `agent-fixture-0` 用于消息、侧栏和成员挑选项，检查三者色调一致且消息头像非 `av-4`。
- 窄测试理由：单票、无方案分叉、无跨-module seam；行为归属 `Avatar` module，消息流/侧栏/成员挑选项只用于真实渲染集成验证。

### 门禁与证据
- `node --test components/Avatar.test.mjs components/message-stream.test.mjs components/WorkspaceSidebar.test.mjs components/CreateChannelModal.test.mjs`：52 passed，0 failed。
- `npm run typecheck`：通过。
- `npx eslint components/Avatar.tsx components/Avatar.test.mjs`：base `0e4cb4b` 与修改后均 exit 0、无诊断，新增问题 0。`npm run lint`：0 errors；有 1 条未改动文件的既存 warning：`hooks/useI18n.tsx:61` 缺少 `locale` hook dependency。
- `git diff --check` 通过；无无关格式化改动。`.pi-lens.json` 为本地忽略项，不在版本控制差异中。
- 浏览器：ego-browser 在隔离临时 `HOME`、Pi 目录及 `WORKSPLICE_DATA_DIR` 下检查真实页面；API 返回的非空 workspace/home/session 路径全部位于隔离根（0 escaped paths）。侧栏 agent 和 `#all` 消息作者实际渲染为有色 `av-0…av-3`。证据：`/tmp/orch-worksplice/evidence/avatar-agent-tint/sidebar-and-channel.png` 与 `browser-check.md`；隔离 server 已停止。
- 安全记录：第一次启动后 API 返回一个位于用户 Pi sessions 目录的 `pi_session_file` 路径，随即停下并升级协调者；未打开、修改、删除或验证该逸出路径是否存在。按协调者许可，后续浏览器验收改用临时 HOME/Pi/data 目录。该首次路径是否由启动过程写入无法确认，且按指示保持未触碰。

### 文件与提交
- `components/Avatar.tsx`：字符串 agent ID 限定前四格；澄清 numeric key 可显式选择任一格。
- `components/Avatar.test.mjs`：真实 SSR regression、human 固定色与数字 key 位置语义。
- `components/message-stream.test.mjs`：消息/侧栏/成员挑选项同 ID 同色断言。
- `.scratch/avatar-agent-tint/issues/01-agent-avatar-tint.md`：本票与 Answer。
- 实现提交：`eb6d86a`；数字 key 契约澄清提交：`410ccaf`。PR 号待创建后回填。

## Standards

- 最终独立 Standards reviewer：未发现文档化标准违规，Verdict **OK**。基线 smell 判断：`av-[0-3]` 断言在组件级与跨面测试中重复；这是有意保留的跨面回归覆盖，无需抽取。
- 先前一次审查把 numeric `colorKey: 4` 判为 D8 冲突；该项不是 Standards 违规，且与明确的 numeric palette-position 契约冲突。最终 reviewer 复核了精确 diff 与约束并确认 numeric 显式位置不等于 member-ID 哈希。

## Spec

- 最终独立 Spec reviewer：确认字符串 ID 使用 `hashString(colorKey) % 4`、human 恒为 `av-4`、消息/侧栏/成员挑选项同 ID 同色；无缺失/越界行为，Verdict **OK**。
- 对先前的 numeric-key finding 的处置：不采纳“agent 数字 key 4 应改到前四格”的建议。票面第 4 行要求保留“数字 key 的显式调色板位置语义”，验收第 11 行再次确认；D8 第 178–179 行的 `% 4` 约束列表序号与稳定 member-ID 哈希。数字 `colorKey: 4` 是明确选中第五格，不是 member-ID 哈希。最终 Spec reviewer 明确确认该 finding 不成立；实现未改 numeric 分支，并增加 `type: "agent"` 的 `colorKey: 4 → av-4` 断言与注释澄清。
- Final reviewers 审查固定点 `0e4cb4b` 到最终实现 `410ccaf` 的精确源码 diff；第一轮 reviewer 无法读取已提交范围，未作为最终审查依据。
