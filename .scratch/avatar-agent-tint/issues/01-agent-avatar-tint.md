# 01 — Agent 头像不使用中性色格

**Type:** task
**What to build:** 修复 agent 字符串 member ID 的哈希可能落入中性 `av-4` 的问题。根据 `.scratch/macaron-palette/spec.md` D8，agent ID 只映射 `av-0…av-3`，`av-4` 保留给 human；保留调色板、FNV-1a、稳定 ID 与数字 key 的显式调色板位置语义。

**Status:** claimed

## 验收条件
- [ ] 使用 `Avatar` 的 `renderToStaticMarkup` 接缝新增真实 markup 回归断言：`agent-fixture-0` 不渲染 `av-4`、agent 色调属于 `av-0…av-3`、human 恒为 `av-4`。
- [ ] 同一 ID 在消息、侧栏、成员挑选项的真实渲染 markup 上保持同色。
- [ ] 记录同一回归测试红→绿；数字 key 保持显式 palette 位置含义。
- [ ] 运行指定窄测试、`npm run typecheck`；对 base commit 和修改后运行 `npx eslint components/Avatar.tsx components/Avatar.test.mjs` 并比较新增问题。
- [ ] 在隔离的临时 `WORKSPLICE_DATA_DIR` 演示数据上启动 app，经 ego-browser 查看侧栏 agent 和频道消息头像均显示有色 `av-0…av-3`；截图保存到 `/tmp/orch-worksplice/evidence/avatar-agent-tint/`，不得读写 live 数据。
- [ ] Answer 记录诊断、红绿证据、文件清单、门禁与独立的 `## Standards` / `## Spec` 双轴 review（两节不可合并或重排）；finding 已修复或逐条说明豁免。
- [ ] Status 收敛为 `resolved`；提交并推送分支，创建 OPEN PR 并回填 PR 号。

## 范围与约束
- 仅改 `components/Avatar.tsx`、`components/Avatar.test.mjs`、本票正本及本票 Answer；仅允许为跨面验证更新 `components/message-stream.test.mjs`。
- 不改 CSS/token、成员数据或其他调用行为；不读写用户 live 数据；遇到需要人类、凭证、第三方或不可逆操作时升级协调者。

## Answer

（完成后追加。）
