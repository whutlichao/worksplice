# 视觉方向改判：马卡龙 × brutalist → modern-minimal

**背景**：仓库当前的视觉方向由 `.scratch/worksplice-build/issues/03-shell-and-visual-tokens.md`（Status: resolved）确立，并在 `docs/spec.md` §4「视觉设计 token」里以 12 色板 + 全局 0 圆角 + 2px ink 粗边框 + 硬偏移阴影阶梯（无模糊）+ Space Grotesk / Hanken Grotesk / Space Mono + 8×8 像素头像固化，逐条标注 **[锁定] 02**。载体是 `app/globals.css`（1044 行，Tailwind v4 `@import` + `@theme` + 旧 token 块）与 `app/layout.tsx` 的 `next/font` 注入。

**决策**：改用 `modern-minimal`（Linear / Vercel 语域）——近白纸面、13px 密度、小圆角（6/8/12/16）、发丝分隔、单一 indigo 强调色。契约正本是入库到 `worksplice-design-system/` 的设计系统：`DESIGN.md`（人向契约）、`colors_and_type.css` + `tokens.css`（oklch token 事实来源）、`SKILL.md`（agent 向配方）、`ui_kits/app/app.css`（应用层 class 库）、`worksplice-app.html`（1865 行自包含原型）。**马卡龙 × brutalist 的 token 体系整体退役**——不是叠加、不是并存：色板（cream / yellow / pink / cyan / orange / lime / lavender / coral / ink / stone）、0 圆角、2px ink 边框、硬偏移阴影、三个 Google 字体、像素图案取色全部作废；新契约的 token 名（`--bg / --surface / --panel / --panel-2 / --fg / --muted / --faint / --border / --border-strong / --accent / --accent-hover / --accent-soft / --accent-line / --online / --working / --error / --offline / --av-0…--av-4 / --sp-* / --r-* / --shadow-* / --rail-w / --dock-w / --stream-max / --board-col-w / --control-h / --z-* / --dur* / --ease`）是唯一契约面。

**为什么推翻**：旧裁决的依据是「马卡龙色块 + 墨色结构线」这一套品牌手感，它是设计者自拟的方向；新依据是产品所有者提供的一整套**带来源与保真度说明的设计系统资料**（`context/provenance.md` 记录每个值的出处、哪些是逐字摘录、哪些是 SVG 重建）。两者不是同一层级的证据：前者是一份方向声明，后者是一份可执行契约（token 文件 + 应用层 class 库 + 完整原型 + agent 配方）。**冲突时以契约资料为准**，且资料明确声明自己的方向为 `modern-minimal` 并写明「这是一份 load-bearing 的 token 契约」。

**影响面**（面，非行数）：
- `app/globals.css` 的 token 块、`@theme` 别名层、结构规则（0 圆角 / 2px ink 边框 / 硬阴影）、12 组 `@keyframes` 与全部 52 个 class 选择器。
- `app/layout.tsx` 的三个 `next/font` 与 `viewport.themeColor`。
- `hooks/useTheme.ts`（恒亮色的理由与消费者）。
- 30 个 `components/*.tsx`（共 1144 处 `var(--*)` 引用 + inline style 形态）。
- `hooks/useIsMobile.ts` 的断点（与设计系统的 1080 / 900 不一致）。
- `PixelAvatar.tsx` 的**退役**与 `StatusDot.tsx` 的形态。头像改为上游原型逐字一致的**首字 tile**（人类 owner「我」/ agent 名称首字符，`--av-0…--av-4` 按成员确定性取色），8×8 像素图案整体作废；`PixelAvatar.tsx` 删除、由新建的 `Avatar.tsx` 取代，7 个调用点随之迁移（调用点清单与两个尺寸变化的知情项见 `.scratch/design-system-refactor/spec.md` 的 D6 节）。这一条是产品所有者对「保留像素图案」荐答的**改判**：一致性优先于头像的可区分度，同首字母成员将不可区分。
- 文档面：`docs/spec.md` §4 整节失效；`AGENTS.md` 的 CSS 变量段、UI 图标规则段附近的视觉描述失效。

**迁移策略**：
- 实施分票落在 `.scratch/design-system-refactor/`（10 张票，frontier `02 → {03, 04, 10} → {05, 06, 07, 08, 09} → 11`），本 ADR 只裁决方向，不含实施细节；`docs/spec.md` §4 与 `AGENTS.md` 的视觉段的改写随实施票落地——设计票阶段改它们会让文档先于代码说谎（与 `.scratch/thread-message-actions/spec.md` 的 D6 同一条纪律）。
- **零行为改动**：消息不可变、freshness-hold、任务状态机、inbox 游标、权限面、agent-loop 语义一字不动。本改判只作用于视觉层。
- 旧 token 名**不做长期别名层**：设计系统明写「token 契约是 load-bearing 的，改名会重新扯断整个 app」，两套名字（新名 + 旧别名）会把「哪个才是契约」变成永久歧义。
- 数据与对外契约零影响：不触 schema、不触 HTTP 面、不触 `~/.worksplice` 任何文件。
- 回滚可达：改动集中在 `app/globals.css` / `app/layout.tsx` / `components/**` 的样式表达，`git revert` 即回到旧方向；无迁移步骤、无数据形态变化。

**被否决的备选**：
- **并存两套方向（主题开关）**：`hooks/useTheme.ts` 现在恒亮色，加回切换等于把两份形态差异（0 圆角 vs 8px 圆角、2px ink vs 发丝、硬阴影 vs 柔和阴影）全部塞进每个组件的分支——depth 反而变浅，且设计系统明写「无深色主题、单档亮色」。
- **只换 token 值、保留旧形态骨架**：旧形态的骨架判据（0 圆角 + 2px ink 边框 + 硬阴影）本身是 `globals.css` 里的具体声明，与 token 值同处一块；只换值会留下「8px 圆角配 2px ink 边框」这类自相矛盾的中间态。
- **以视觉重构为名顺带改行为**（如把消息行 hover 高亮改成设计系统的 `--surface` 填充时顺手改锚点高亮语义）：被 Out of Scope 挡住，视觉票不得夹带行为变更。

**Status**: accepted
**Supersedes**: `.scratch/worksplice-build/issues/03-shell-and-visual-tokens.md` 的视觉部分（该票的「三栏骨架」与「删除 pi-web 单窗口骨架」两项**不被推翻**，仍然有效）；`docs/spec.md` §4 整节。
