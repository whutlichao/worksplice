## Summary

`···` 二级菜单的菜单项吃到了动作栏「图标键」的 port 几何。修法是在扩展层加一条更高特异度的规则，
不动 port 块本身。

```diff
 .msg-tools button      { width: 26px; height: 24px; display: grid; place-items: center; … }   # 逐字 port，一字未动
+.msg-tools .msg-more-menu-item { display: flex; align-items: center; justify-content: flex-start;
+                                 width: 100%; height: auto; padding: 5px 8px; gap: 8px;
+                                 white-space: nowrap; text-align: left; … }                   # (0,2,0) > (0,1,1)
```

```diff
 <div role="menu" style={{ width: "max-content", minWidth: 190, … }}>
   {items.map(item => (
-    <button role="menuitem" className="btn btn-ghost btn-sm" style={itemStyle}>
+    <button role="menuitem" className="btn btn-ghost btn-sm msg-more-menu-item">
       {item.icon}<span>{item.label}</span>
```

根因：`.msg-tools button` 是**后代**选择器，票 16 把菜单嵌进 `.msg-tools > span > div[role="menu"]` 后
连带命中 `[role="menuitem"]`，于是每项被钉成 26×24 的 grid 图标键（图标单独一行）、
面板高度按 N×24 算（最后一项掉出面板）、标签没有内边距与 `nowrap` 契约。
`.btn` / `.btn-sm` 的 (0,1,0) 打不过它，所以「加个 class」不够，必须落到 `.msg-tools <class>` 这一级。

## Evidence

真实浏览器（ego-browser 驱动 Chromium，隔离实例 `WORKSPLICE_DATA_DIR=/tmp/ws-more-menu-w1/data`、
端口 30177、全程不碰 `~/.worksplice`），在真实频道里 hover 消息、点 `···` 后直接量 `getBoundingClientRect()`：

- **Before:** `.scratch/msg-more-menu-layout/evidence/before.png` —— 图标各占一行压在文字上、项互相压、面板截断。
  探针 `evidence/probe-before.log` → `RED`，13 条失败：项高 **24** < 26、`svg.top` 与文字 `span.top` 差 **21px**、
  `svg.left > span.left`、面板 `scrollHeight 95 > clientHeight 84`、每项内容溢出自身盒子。
- **After:** `.scratch/msg-more-menu-layout/evidence/after.png` —— 一行一项、图标在左、面板完整包住。
  探针 `evidence/probe-after.log` → `GREEN`，`failures: []`：项高 **28**、top 差 **−2.5px**、图标在文字左侧、
  `scrollHeight 96 = clientHeight 96`、最后一项 298.18 ≤ 面板内边距线 299.18、无换行、无溢出。
  4 项形态（含「转为任务」）另跑一次（`evidence/probe-after-4-items.log`）同样 `GREEN`。

落盘回归（先红后绿；红在 base `155f883` 的独立 worktree 上取证，只放新测试、不放修复）：

- `evidence/tests-red.log` → `tests 96 / pass 94 / fail 2`：`缺少规则 .msg-tools .msg-more-menu-item`、
  `菜单项需要专属 class… class="btn btn-ghost btn-sm" style="width:100%;justify-content:flex-start;…"`。
- `evidence/tests-green.log` → `tests 96 / pass 96 / fail 0`。

测试锁的是「几何不再泄漏」这件事实：port 块仍与上游逐字一致、菜单项规则特异度真的大于 `.msg-tools button`
（算了特异度三元组）、渲染出的菜单项带专属 class 且不再内联几何。

质量门禁（基线在 base `155f883` 的 worktree 上取）：

| 检查 | 基线 | 本 head `d75c07a` |
| --- | --- | --- |
| `tsc --noEmit` | exit 0 | exit 0，0 新增 |
| `npm run lint` | 0 errors / 1 warning | 0 errors / 1 warning（同一条既有 `hooks/useI18n.tsx:61`），0 新增 |
| `npm test` | 1610 tests / 1609 pass / 1 fail | 1612 tests / 1611 pass / 1 fail，无新增失败 |

唯一失败是既有环境相关用例 `lib/model-listing.test.mjs:50`（读本机模型配置），在 base commit 上同样失败。

## Merge Danger

**Door:** two-way

纯样式/组件内联几何的收口，回滚只需 revert 一个 commit；不触数据层、协作域、路由、共享类型与构建配置。

**Blast Radius:** layout-only（`···` 二级菜单）

影响面限于 `MessageMoreMenu` 渲染出的菜单项几何与面板宽度。菜单项左边距从 `.btn-sm` 的 9px 变成本规则的 8px；
面板新增 `width: max-content`，在最长标签短于 `minWidth: 190` 时行为与之前一致（实测仍为 190px 宽）。
线程面板的菜单不复用这段（线程面收窄后只有表情 / 引用 / 复制链接 / ⏰），频道面之外无消费方。

## Closes

无关联 issue（用户截图报障）。

## Checklist

- [x] 未包含 agent 会话语义上的内部状态。`.scratch/msg-more-menu-layout/` 只放本票 Answer / PR body / 探针 / 证据，
      与近期合并 PR #200–#204 的既有惯例一致。
- [x] `README.md` / `README.zh-CN.md` 未改。
- [x] 无凭证、API key、会话文件内容或其它私有数据（截图取自 `/tmp` 下的隔离 demo 库）。
