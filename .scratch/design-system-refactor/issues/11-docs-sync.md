# 11 — 文档同步

**What to build:** 让文档与代码同时回到同一个方向。`docs/spec.md` §4 整节（12 色板 / 0 圆角 / 2px ink / 硬阴影阶梯 / 三字体 / 像素头像，逐条 `[锁定] 02`）按 `worksplice-design-system/` 的契约改写，§4.5「沿用 pi-web 的主题基建（tailwind 配置 + CSS 变量）**[锁定] 04**」改用 D4 的裁决（Tailwind 已删）。`AGENTS.md` 的 CSS 变量段（`--bg --bg-panel --bg-hover --bg-selected --border --text --text-muted --text-dim --accent --user-bg --tool-bg --font-mono`）换成新契约名；File Map 与关键决策段里描述「马卡龙 × brutalist」「0 圆角」「2px ink 边框」「硬偏移阴影」「像素头像取色」「三个字体」的措辞逐处改写；`.scratch/worksplice-build/issues/03` 的视觉部分**不改**（它记录的是历史裁决，推翻事实已在 ADR-0014 的 `Supersedes` 留痕）。`CONTEXT.md` 只核对票 01 已落的「视觉契约」词条。

**Blocked by:** 03, 04, 05, 06, 07, 08, 09, 10

**Status:** resolved（2026-10-23）

- [x] `docs/spec.md` §4 不再出现 `#ffd440` / `#fe7da8` / `#fffaef` / `0 圆角` / `2px ink` / `[锁定] 02` / Space Grotesk
- [x] `docs/spec.md` §4.5 不再说「沿用 pi-web 的主题基建（tailwind 配置 + CSS 变量）」
- [x] `AGENTS.md` 的 CSS 变量段列出的是新契约名（`--bg` / `--surface` / `--panel` / `--panel-2` / `--fg` / `--muted` / `--faint` / `--border` / `--border-strong` / `--accent` / `--accent-hover` / `--accent-soft` / `--accent-line` / `--online` / `--working` / `--error` / `--offline` / `--av-0…--av-4` / `--font` / `--mono` / `--shadow-card` / `--shadow-pop` / `--shadow-composer` / `--r-*` / `--sp-*`）
      —— 偏差：清单里的 `--accent-line` 是 ADR-0015 前的过期项，已退役，只以「已退役」说明出现（见 Answer）
- [x] `AGENTS.md` 的 File Map 与决策段里视觉措辞与产品一致；「UI 图标规则（lucide 优先）」段保留不动
- [x] `docs/adr/0014-visual-direction-modern-minimal.md` 的 `Status` 仍为 `accepted`（无需改动，仅核对）
- [x] 文档正文中文（AGENTS.md 的 Language 段）
- [x] `npm test` / `tsc --noEmit` 通过；T-C 的文档一致性扩展断言绿（全量唯一失败是 base 已有的环境依赖用例，见 Answer）

## Answer

### 交付摘要

文档与代码回到同一方向：`docs/spec.md` §4 的历史沿革改写成不含退役契约字面量的表述（§4.2 / §4.3 的否定句同步改写），§4.5 明确 Tailwind 已删除；`AGENTS.md` File Map 的 `BrutalModal.tsx` 描述改为当前模态外壳形态，`PixelAvatar.tsx` 行替换为磁盘上真实存在的 `Avatar.tsx`；`app/globals.test.mjs` 在 T-C 上新增三条文档一致性断言，把「旧契约不许回到文档」变成可执行回归网。未改任何源码样式、未触达 `worksplice-design-system/` 上游资产、未动 AGENTS.md 的 lucide 图标段。

### 验收清单（逐条 + 证据）

- [x] **§4 退役字面量清零**：`grep -nE '#ffd440|#fe7da8|#fffaef|0 圆角|2px ink|\[锁定\] 02|Space Grotesk' docs/spec.md` 退出码 1（0 命中）。§4 另含 `像素头像` / `硬偏移阴影` / `tailwind 配置` / `沿用 pi-web 的主题基建` 也均为 0（新增断言覆盖）。历史沿革（line 217）保留「马卡龙色板 / 墨线粗边框 / 直角 / modern-minimal / ADR-0015 色板再改判」的事实链，但不含旧契约标记。
- [x] **§4.5**：现行文本为「Tailwind 已删除（ADR-0014 D4），`@theme` 别名层不复活」（line 287）；`grep -n 'tailwind 配置' docs/spec.md` 退出码 1。
- [x] **AGENTS.md CSS 变量段**（line 546–572）：列出纸族 / 墨族 / 行动 / 选中 / 未读 / 警示 / 四态 / 头像 / 尺度 / 阴影全部当前契约名。**偏差（ADR-0015）**：票面清单仍列 `--accent-line`，它是 ADR-0015 前的过期项，已退役并被 `--accent-graphic` 取代；本票没有为迎合清单恢复它，它只在「已退役」说明行出现（line 570），测试对任何把它当现行名的写法报红。
- [x] **File Map**（line 285–286）：`BrutalModal.tsx` 改述为「模态外壳（scrim + blur；`.modal` 两档宽度 440/560，模块名沿旧）」；`PixelAvatar.tsx` 行删除，替换为 `Avatar.tsx 首字 tile 头像（--av-0…--av-4 确定性取色，人类恒 --av-4）`。`grep -n 'PixelAvatar' AGENTS.md components/*.tsx` 退出码 1；File Map 中其余组件名均能在 `components/` 找到。lucide 段零 diff。
- [x] **ADR-0014 Status**：仍为 `**Status**: accepted`（只核对，未改）。ADR-0015 的 supersede 范围只覆盖色板段与三处表述，形态段继续有效。
- [x] **文档正文中文**：改动段落全部中文；测试代码注释沿用仓库既有的英文/中文混合风格（与本文件其余 T-A…T-D 一致）。
- [x] **门禁**：`tsc --noEmit` 通过；`npm run lint` = 0 error / 1 warning（`hooks/useI18n.tsx:61`，base 同一条，零新增）；`npm test` 见下。

### 红绿证据（TDD）

1. **红**（先加断言、文档未改）：`node --test app/globals.test.mjs` → `tests 14 / pass 12 / fail 2`。
   - `✖ T-C: docs/spec.md §4 不再出现退役色值与旧契约标记`：`docs/spec.md §4 仍含旧契约标记 0 圆角`（实际最后一处命中在 §4 沿革句）。
   - `✖ T-C: AGENTS.md File Map 不再指向已删除的旧头像组件`：`expected /PixelAvatar/` 未匹配（`doesNotMatch` 失败，AGENTS.md 仍引用 `PixelAvatar.tsx`）。
   - 红证据日志：`/tmp/t11-red.log`（本 worktree 的 base 文档 + 新断言）。
2. **绿**（文档改完后同一命令）：`tests 14 / pass 14 / fail 0`。
3. **全量基线**（隔离 worktree `/tmp/t11-base`，同一 `HEAD 3b86a28`，`node_modules` 软链）：`tests 1551 / pass 1550 / fail 1`。
4. **最终 head 全量**：`tests 1554 / pass 1553 / fail 1`（+3 即本票新增断言）。唯一失败是 base 已有的环境依赖用例 `lib/model-listing.test.mjs` 的 `lite path returns a working runtime without loading extensions`：测试给 SDK 空 `models.json` 后 `getAvailable()` 仍返回宿主 deepseek 两个模型，与本票改动无关（base / 最终两次同一条、同数量）。

### 两轴 code-review（Standards + Spec，不合并）

两份报告由两个独立 reviewer 子代理并行跑出（同一 base `3b86a28`、同一未提交 diff）。

#### Standards 轴（摘要）

> **结论：无文档化标准的硬违规。** 三条 smell 已处置：
> 1. **P2 退役名守护只罩 `--accent-line`** → 改为复用 `RETIRED_TOKEN_NAMES` 同时扫 `docs/spec.md` §4 与 AGENTS.md CSS 段，且只允许「退役」行出现。
> 2. **P3 File Map 断言越界/脆弱** → 改为 `extractSection(agents, "## File Map")` 内断言 `/^\s*Avatar\.tsx\s/m`，不再钉死「首字」散文。
> 3. **P3 重复正则、缺前向边界** → 抽出 `tokenPattern()`（前后双向边界），T-B 与新断言共用。
> 4. **P3 文件头 T-C 定义过窄** → docblock 补「文档一致性」。

#### Spec 轴（摘要）

> **结论**：文档已对齐 ADR-0014/0015，新断言方向正确；缺口已补：
> 1. 退役 token 守护只跑 AGENTS → **已修**：spec §4 同样跑 `RETIRED_TOKEN_NAMES`（`--accent-line` 写回 §4.5 会红）。
> 2. `像素头像` / `硬偏移阴影` 两个「不恢复」项未入断言 → **已修**：加入 §4 字面量表；§4.2 的否定句改写为「无硬阴影阶梯」（仍表达同一终局值）。
> 3. Answer 为空 → **本段即回填**。
> 4. `docs/spec.md:11`（索引表历史行）改动越出 §4 → **有意保留**：票面 Change 1 明确「历史沿革注记可保留事实，但不得再逐字出现这些旧契约标记」，该行是历史沿革注记且含 `0 圆角`；已改写为「粗墨线边框 + 直角」，并保留「已被 ADR-0014 / ADR-0015 先后改判」的指路。该行不在 §4 断言范围内，`硬偏移阴影` 仍作为历史事实保留。
>
> **核对通过**：§4 色值/配比、圆角 6/8/12/16、`--av-0…--av-4`、`.modal` 440/560、Avatar「human→`--av-4`」、§4.5 D4、CONTEXT.md 词条、ADR-0014 Status。

### 最终改动面

```
 docs/spec.md                                  §4 沿革 / 否定句 / §4.5
 AGENTS.md                                     File Map 两行
 app/globals.test.mjs                          T-C 三条文档一致性断言 + tokenPattern
 .scratch/design-system-refactor/issues/11-docs-sync.md   Status / Answer
 .scratch/design-system-refactor/pr-body.md    PR body
```

零源码样式改动；最终 `git status --porcelain` 为空；无整文件重排（逐 hunk 检查）。

### PR

- PR: #197 — https://github.com/whutlichao/worksplice/pull/197
- PR body: `.scratch/design-system-refactor/pr-body.md`（已随本票提交）
