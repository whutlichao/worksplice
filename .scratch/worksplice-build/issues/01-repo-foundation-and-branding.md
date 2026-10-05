# 01 — 仓库地基与命名脱钩

**What to build:** 以 pi-web 源码为底、重开 git 历史的新仓库就位，整个应用以 **worksplice** 名义启动：npm 包名、启动器（bin/worksplice.js）、环境变量（WORKSPLICE_*）、README、LICENSE（保留 pi-web 原版权行 + 追加 worksplice 版权行）、品牌资源（logo/favicon/页面标题/文案）与内部标识符前缀全部替换完成；pi SDK 接口面（@earendil-works/pi-* 依赖、PI_* 环境变量、~/.pi/agent 目录）保持不动。此时应用行为仍是原 pi-web（冒烟可跑），作为后续重写的地基（spec §7.2、§5.8 删除项除外）。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 新仓库 `git init`，无 pi-web 提交历史；单包结构（Next.js 应用 + lib/，沿用 pi-web 单包模式）
- [ ] package.json `name` = worksplice；`bin/worksplice.js` 启动应用；页面标题为 worksplice
- [ ] 环境变量全部替换为 `WORKSPLICE_*`（含 `WORKSPLICE_PASSWORD`、`WORKSPLICE_DATA_DIR`）；内部标识符（如 `__piSessions` → `__workspliceSessions`）替换完成
- [ ] README 重写无 pi-web 链接/badge/截图；LICENSE 保留原版权行 + 追加 worksplice 版权行；logo/favicon/文案无 pi-web 残留
- [ ] `PI_*` 环境变量与 `~/.pi/agent` 目录保持原样；@earendil-works/pi-* 依赖不动
- [ ] 启动后原 pi-web 既有功能冒烟通过（作为后续 ticket 的基线）
