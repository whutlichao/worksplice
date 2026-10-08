# 09 — 搜索视图

**What to build:** `components/SearchView.tsx` 按原型形态重做：`.search-view` / `.search-field`（`:focus-within` accent 环，替换 ink 边框）/ `.facet-row` / `.filter-chip`（选中 `.is-on` → `--accent-soft` + `--accent`）/ 结果 `.group` / `.group-label`（mono 大写 + `letter-spacing .1em`）/ 命中摘要的 `#seq` 与作者名（mono / accent）/ `.empty`（空态：`--panel-2` 图标底 + 13.5px 标题）。

**Blocked by:** 03, 04

**Status:** pending

- [ ] 搜索框焦点环走 `--accent-soft`；无 ink 边框
- [ ] facet chip 选中态 = `--accent-soft` 底 + `--accent` 文字
- [ ] 结果分组的 `#seq` 用 `var(--mono)` + `tabular-nums`
- [ ] 新增渲染断言：facet chip 选中态（落在无障碍名上）
- [ ] 搜索行为零改动（`GET /api/search` 的调用与参数不动）
- [ ] `npm test` / `tsc --noEmit` 通过

## Answer
