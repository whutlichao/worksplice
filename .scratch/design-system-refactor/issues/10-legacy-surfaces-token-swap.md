# 10 — 遗留面换皮（agent 会话面 / 文件面 / 配置面）

**What to build:** 15 个原型未覆盖的模块**只换 token、去 2px ink 边框、去 0 圆角，形态结构不动**，按 spec 的 `ED-1…ED-10` 外推：`MessageView`（气泡 → `--surface` + `--r-md` + 发丝；`--user-bg`/`--assistant-bg`/`--tool-bg` → `--surface`/`--panel`）、`ChatInput`（输入条 → `--border-strong` + accent 焦点环）、`MarkdownBody`（正文 14 → `--fs-body` 13px；代码块底 `--panel-2` + `--r-md`；`.linenumber` → `--faint`）、`MentionText`（mention 底 `--accent-soft` + 文字 `--accent`）、`MermaidBlock`（工具栏 → `.icon-btn`；画布底 `--surface`）、`FileExplorer`（行 hover `--fg-soft`；选中 `--accent-soft` + `--accent`）、`FileViewer`（工具栏高 `--control-h`；行号 `--faint`）、`FileIcons`（核验后若确无样式引用则不动）、`ModelPicker`、`ModelsConfig`（162 处）、`PluginsConfig`（83 处）、`SkillsConfig`（84 处）、`DirectoryPicker`、`ProjectTrustDialog`（若票 08 已覆盖则此处只核对）、`ExtensionStatusBar`（上发丝 + 四态色）。`useIsMobile` 的 640 断点**不动**（D5）。

**Blocked by:** 02

**Status:** pending

- [ ] 15 个模块里 `--text*` / `--bg-panel` / `--bg-hover` / `--bg-selected` / `--bg-subtle` / `--user-bg` / `--assistant-bg` / `--tool-bg` / `--ink` / 马卡龙 7 色 / `--font-space-*` / `--font-hanken*` 出现 0 次
- [ ] 无 `2px solid`；无 `border-radius: 0`
- [ ] 每个可聚焦元素有焦点环
- [ ] `hooks/useIsMobile.ts` 的 `MOBILE_QUERY` 仍是 `(max-width: 640px)`，且注释写明「这是配置面的紧凑断点，不是布局断点」
- [ ] **行为零改动**：props 名、i18n key、事件处理、轮询节奏、freshness `baseSeq` 来源一字不动
- [ ] `components/*.test.mjs` 全绿（`ChatInput.test.mjs` / `ChatInput.dormancy.test.mjs` / `MessageView.test.mjs` / `MarkdownBody.test.mjs` / `MermaidBlock.test.mjs` 是这一层的护栏）
- [ ] `npm test` / `tsc --noEmit` / `npm run lint` 通过

## Answer
