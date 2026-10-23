## Summary

文档与代码回到同一方向：`docs/spec.md` §4 只保留 ADR-0014（形态）+ ADR-0015（色板）的终局值，`AGENTS.md` 的 File Map 与 CSS 变量段描述当前实现，`app/globals.test.mjs` 把这条一致性钉成 T-C 断言。

```diff
 docs/spec.md
-  §4 沿革/否定句中的旧契约字面量（0 圆角 / 2px ink / Space Grotesk …）
+  只保留事实链：马卡龙色板 → 墨线粗边框 + 直角 → modern-minimal → ADR-0015 色板再改判
+  §4.5：Tailwind 已删除（ADR-0014 D4），@theme 别名层不复活

 AGENTS.md (File Map)
-  BrutalModal.tsx  马卡龙 × brutalist 模态框外壳
-  PixelAvatar.tsx  8×8 像素头像（seed 确定性）
+  BrutalModal.tsx  模态外壳（scrim + blur；.modal 两档宽度 440/560）
+  Avatar.tsx       首字 tile 头像（--av-0…--av-4 确定性取色）

 app/globals.test.mjs (T-C)
+  §4 不得含退役色值 / 旧契约标记 / 退役 token 名
+  AGENTS CSS 变量段必须列全当前契约名；退役 token 只许出现在「退役」行
+  File Map 不得再指向 PixelAvatar
```

零源码样式改动，未触达 `worksplice-design-system/` 上游资产，lucide 图标段未动。

## Evidence

- **Before:** `node --test app/globals.test.mjs` → `tests 14 / pass 12 / fail 2`
  - `✖ T-C: docs/spec.md §4 不再出现退役色值与旧契约标记` — `§4 仍含旧契约标记 0 圆角`
  - `✖ T-C: AGENTS.md File Map 不再指向已删除的旧头像组件` — `PixelAvatar` 仍被 File Map 引用
- **After:** 同一命令 → `tests 14 / pass 14 / fail 0`；`npm run typecheck` exit 0；`npm run lint` 0 error / 1 既有 warning（`hooks/useI18n.tsx:61`，与 base 逐字一致）。
- **Full suite:** 隔离 base worktree（`3b86a28`）`tests 1551 / pass 1550 / fail 1`；最终 `tests 1554 / pass 1553 / fail 1`（+3 = 本票新增断言）。唯一失败是 base 已有的环境依赖用例 `lib/model-listing.test.mjs` 的 lite-path 用例（空 `models.json` 仍返回宿主模型），与本票无关。
- **Mechanical:** `grep -E '#ffd440|#fe7da8|#fffaef|0 圆角|2px ink|\[锁定\] 02|Space Grotesk' docs/spec.md` → 0 命中；`grep 'tailwind 配置' docs/spec.md` → 0；`grep 'PixelAvatar' AGENTS.md components/*.tsx` → 0。

## Merge Danger

**Door:** two-way（文档 + 测试；只改文档措辞与测试断言，不改运行时）

**Blast Radius:** docs-and-tests

后续若再次改判视觉方向，需同时更新 `docs/spec.md` §4 与 `AGENTS.md` 契约段，否则 T-C 文档一致性断言会红——这是有意的回归网。

## Closes

- `.scratch/design-system-refactor/issues/11-docs-sync.md`（票据 Status → resolved，Answer 含证据与 ADR-0015 偏差记录）
