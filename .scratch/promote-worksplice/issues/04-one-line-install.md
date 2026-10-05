# 04 — 一行安装的精确形态与「无 pi 演示模式」可行性

**Type:** prototype
**Blocked by:** —
**Status:** resolved

## Question

landscape 实测：12 个同类高星项目 **10/12 有「一行安装」**（覆盖 1,500 ~ 211,441 stars 全量级），而 worksplice 的 README 目前写的是 clone + bun install + build。Q16 已定：首发先走 GitHub Release + 安装脚本，`npm` + `--demo` 列第二波。但「一行」的精确形态还没定：

1. **首发路径**：GitHub Release 附构建产物 + `curl -fsSL … | sh`？还是 `npm exec github:whutlichao/worksplice`？要不要同时出第一个 tag（当前 **0 tag / 0 release / version 0.1.0**）？`package.json` 的 `files` 已预置 `.next`/`bin`/`public`，这是现成的资产。
2. **`--demo` 演示模式是否可行**：`scripts/seed-demo.mjs` 已能往任意 `WORKSPLICE_DATA_DIR` 写一套完整的演示现场且不触发任何模型请求。要回答的是——**在没装 pi、没有模型 key 的机器上，worksplice 能不能只读地跑起来看到那个现场**？阻塞点在哪（pi SDK 是否在启动时就要配置、better-sqlite3 的预编译、Node ≥22.19 门槛、Basic Auth 是否干扰首次体验）？
3. **npm 路径的真实成本**（为第二波估工作量）：better-sqlite3 在用户机器上的安装体验、`.next` 产物随包分发的体积、发布流程的维护成本。

**产出**：可直接写进 README 的首发安装命令行 + `--demo` 可行/不可行的结论与工作量估计 + npm 第二波的成本估计。

**提示**：这是 prototype（用一个粗糙但能跑的探针把讨论抬到可反应的精度），不是正式实现；探针代码不进 main。

## Answer

2026-10-02，以 prototype 方式在 `/tmp/ws-probe1` 的**干净克隆**里实测（不污染工作区；该 checkout 本身没有 `node_modules`）。作者在实物（无 pi 的演示实例）前逐项确认，三个问题全部按推荐定案。

### 1. 「无 pi 演示模式」可行 —— 已证

在一台**假机器**上（`HOME=<tmp>/fakehome`，无 `~/.pi`、无任何模型 key、无 pi CLI）：

- 种演示数据成功：5 agent（Iris / Marlow / Nova / Quill / Rune）/ 4 频道 / 40 消息 / 14 任务（in_review=3、in_progress=3、todo=3、closed=2、done=3）/ 11 反应 / 2 置顶 / 3 提醒；
- 服务启动 **Ready in 99–114ms**，`GET /` → 200（16.9KB），首屏三个 API（`/api/channels`、`/api/members`、`/api/reminders`）全 200；
- 消息流、任务板（10 个任务带 `reachable` 合法落点）、全文搜索（`?q=reconciliation` 命中 10 条）全 200；
- 服务器日志唯一一条提示：`[worksplice] secretary auto-create skipped: no default model configured` —— **优雅降级，不是错误**。

根因：首屏只打 channels / members / reminders，而静态 import pi SDK 的路由（models、models-config、plugins、skills、project-trust、sessions）不在首屏路径上（Next 按请求惰性加载）。

**实现建议（首发版）**：

- 随包分发一份**预置演示库** `worksplice.db`（由 `scripts/seed-demo.mjs` 产出，实测 **258KB**），而不是在用户机器上跑 seed 脚本——`scripts/` 不在 `files` 白名单里，且 seed 依赖 Node 的 TS strip（Node 22.19 上不稳）。
- `--demo` 首次运行时把演示库复制到 `~/.worksplice-demo/`（或临时目录）并设 `WORKSPLICE_DATA_DIR`，随后正常启动。
- 复制时用一条 `UPDATE` 把 agent 家目录路径重写成目标机器上的路径（否则 agent 详情面板会显示种数据那台机器的路径）。
- **不加只读锁**：演示库在一次性目录里，让它可写（观众能真的发一条消息）比加锁便宜。

### 2. 首发「一行安装」= GitHub Release 挂 `npm pack` 产物

三条命令实测全部走通，**无需发布到 npm registry**：

```bash
npx --yes https://github.com/whutlichao/worksplice/releases/download/v0.1.0/worksplice-0.1.0.tgz
npm i -g https://github.com/whutlichao/worksplice/releases/download/v0.1.0/worksplice-0.1.0.tgz
```

| 项 | 实测 |
| --- | --- |
| `next build --webpack` | 43 秒 |
| `.next` 总量 / 其中 `cache` | 532M / 496M（`files` 已排除 cache） |
| `npm pack` 产物 | **5.7 MB**（解包 35M；682 个 `.next` 条目，cache **0** 条） |
| 从 URL 安装 | **15.7 秒 / 272 个包**（本地文件 18.6 秒）；node_modules 1.0G |
| 启动 | Ready in 99–114ms |
| `better-sqlite3@13.0.2` | 自带 **8 平台预编译**（darwin-arm64/x64、linux-x64/arm64、musl、win32）→ 用户机器**无需编译器** |

**被证伪的路径**：`npm exec github:whutlichao/worksplice` 走不通——`.next` 不在 git 里，`bin/worksplice.js:43` 直接 `Build artifacts not found`；要救它得加 `prepare` 脚本让每个用户先在本机构建 43 秒。
**被否掉的形态**：自写 `install.sh`（`curl | sh`）——它做的正是 `npm install <url>` 已经做好的事，却多一层要自己维护的壳。

### 3. npm registry 路径的真实成本 ≈ 0（除维护发布流程）

`package.json` 的 `files`（`bin` / `.next` / 排除 `.next/cache` / `public` / `next.config.ts` / `package.json`）与 `bin` 字段早已为发布备好，实测包 5.7MB、`next start` 直接跑。即「第二波 npm 发布」技术成本几乎为零，剩下的只是维护发布流程这一件事——**`6eba0ba` 那条「不通过包仓库分发」的决定因此可以完整保留**。

### 4. 决策（HITL 确认）

- **README 首行** = `npx --yes <Release 资产 URL>`；第二行给 `npm i -g <同 URL>` 变体。
- **`--demo` 提前到首发**——它同时是票 03 录屏的可重复现场：大部分镜头不必真跑 agent 就能录。
- **现在就出 `v0.1.0`**：打 tag + GitHub Release + 挂 `npm pack` 产物。

### 5. 执行清单（不在本图内 → 进票 09 检查单与票 10 计划）

- 出 `v0.1.0` tag + Release，资产 = `npm pack` 产物（作者侧复现：`bun install && npm run build && npm pack`）。
- 实现 `--demo`（flag + 预置演示库 + 首次复制 + 家目录路径重写）。
- 中英 README：首段换定位句（票 02）、Quick Start 换一行安装。

### 6. 未验证项（诚实记录）

- 全局形态 `npm i -g <url>` 未**直接**实测（沙箱禁止写全局前缀），已用 `npm install --prefix` 验证同一代码路径。
- 15.7 秒是「tarball 与依赖多半命中缓存」的耗时；陌生人冷缓存首次会更慢（取决于下载 272 个包）。
- `npx` 形态会在 `~/.npm/_npx/<hash>/` 留一份 lockfile 与安装副本（npm 的正常行为，非缺陷）。
