# 06 — 命名与品牌脱钩

Type: grilling
Status: resolved
Blocked by:

## Question

项目命名与品牌脱钩：候选名、npm 包名、仓库结构；脱钩清单（删除 git 历史、README、license、品牌资源、项目内部名称替换）。

## Answer

（2026-08-03 grilling，四项决策）

1. **命名方向**：与 raft、pi-web 都彻底脱钩，采用全新原创名。
2. **产品名 = npm 包名 = `worksplice`**：npm 直名可用（registry 404 确认）；与当前工作目录同名。
3. **仓库结构**：单包——一个 Next.js 应用 + `lib/`（沿用 pi-web 的 `lib/rpc-manager.ts`、`lib/session-reader.ts` 单包模式）。
4. **脱钩清单**：
   - git 历史：新仓库 `git init` 重开，不保留 pi-web 任何提交
   - README：重写为 worksplice 自己的，删 pi-web 链接/badge/截图
   - LICENSE：保留 MIT 原 `agegr/pi-web` 版权行 + 追加 `worksplice` 版权行（MIT 法律要求）
   - 品牌资源：删/换 pi-web logo、favicon、页面标题、"pi-web" 文案
   - 内部标识符：`bin/pi-web.js`→`bin/worksplice.js`、`PI_WEB_PASSWORD`→`WORKSPLICE_*`、`__piSessions` 等改自名前缀
   - **保留不动**（pi SDK runtime 接口面）：`@earendil-works/pi-*` 依赖、`PI_CODING_AGENT_DIR` 等 `PI_*` 环境变量、`~/.pi/agent` 目录
   - 仓库地址：新建私有仓库（spec 中定）
