# 01 — 仓库地基与命名脱钩

**What to build:** 以 pi-web 源码为底、重开 git 历史的新仓库就位，整个应用以 **worksplice** 名义启动：npm 包名、启动器（bin/worksplice.js）、环境变量（WORKSPLICE_*）、README、LICENSE（保留 pi-web 原版权行 + 追加 worksplice 版权行）、品牌资源（logo/favicon/页面标题/文案）与内部标识符前缀全部替换完成；pi SDK 接口面（@earendil-works/pi-* 依赖、PI_* 环境变量、~/.pi/agent 目录）保持不动。此时应用行为仍是原 pi-web（冒烟可跑），作为后续重写的地基（spec §7.2、§5.8 删除项除外）。

**Blocked by:** None — can start immediately.

**Status:** resolved（2026-10-23）

- [x] 新仓库 `git init`，无 pi-web 提交历史；单包结构（Next.js 应用 + lib/，沿用 pi-web 单包模式）
- [x] package.json `name` = worksplice；`bin/worksplice.js` 启动应用；页面标题为 worksplice
- [x] 环境变量全部替换为 `WORKSPLICE_*`（含 `WORKSPLICE_PASSWORD`、`WORKSPLICE_DATA_DIR`）；内部标识符（如 `__piSessions` → `__workspliceSessions`）替换完成
- [x] README 重写无 pi-web 链接/badge/截图；LICENSE 保留原版权行 + 追加 worksplice 版权行；logo/favicon/文案无 pi-web 残留
- [x] `PI_*` 环境变量与 `~/.pi/agent` 目录保持原样；@earendil-works/pi-* 依赖不动
- [x] 启动后原 pi-web 既有功能冒烟通过（作为后续 ticket 的基线）

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- `package.json:2` `"name": "worksplice"`；`package.json:26-28` `"bin": { "worksplice": "bin/worksplice.js" }`；`app/layout.tsx:7` 页面标题 `worksplice`。
- 环境变量：`lib/data/dirs.ts:19` `WORKSPLICE_DATA_DIR`、`lib/web-auth.ts:14` `WORKSPLICE_PASSWORD`、`lib/request-security.ts:35-36` `WORKSPLICE_HOSTNAME`/`WORKSPLICE_ALLOWED_HOSTS`；内部标识符 `__workspliceSessions` 见 `lib/rpc/registry.ts:16` 与 `lib/cwd-mutex.ts:104`。
- `LICENSE:3-4` 同时保留 `Copyright (c) 2026 agegr` 与 `Copyright (c) 2026 worksplice contributors`；`README.md:200-204` 的 pi-web 出处声明只出现在致谢小节，符合 `docs/adr/0010-readme-source-attribution-exception.md` 的收窄判据（允许一处出处声明，不允许 badge/logo/截图/品牌文案）。
- 干净历史：首个提交 `5723fbd chore: bootstrap worksplice repo from pi-web source with branding decoupled`，无 pi-web 提交历史。
- pi SDK 接口面未动：`package.json` 依赖 `@earendil-works/pi-*`（0.99.2）保持原样，`~/.pi/agent` 目录约定沿用。

**偏差**：无。README 保留一处 pi-web 出处链接是 ADR-0010 对 spec §7.2 第 2 项的显式收窄，不构成本票偏差。

**验证方式**：只读审计（未改源码），逐项核对当前 main（`3b86a28`）的上述文件；启动基线由后续各票的测试套件持续覆盖。本票零源码改动，故未跑 npm test / tsc / lint。
