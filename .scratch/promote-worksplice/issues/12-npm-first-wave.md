# 12 — npm 发布是否提前到首发？（换取 pi.dev/packages 自动收录）

**Type:** grilling
**Blocked by:** 04
**Status:** resolved

## Question

[票 06 的调研](../research/outreach-list.md)带回一条**推翻前提**的事实：`pi.dev/packages` 是 pi 的**官方包目录**，页面原文「Extensions, skills, prompt templates, and themes published to npm. Install with `pi install npm:<package>`」——当前收录 **5382 个包**，按「Most downloads / Recently published」排序。对照量级：`pi-mcp-adapter` **51.4 万次/周**、`pi-subagents` **20.5 万次/周**。调研的判断是：**这比在 Discussions 发帖的杠杆高几个数量级**，且是唯一有规模、合规、不惹人烦的曝光路径。

而现状是：`6eba0ba`（2026-10-02）决定「不通过包仓库分发」，票 04 的 Q16 把 npm 列进第二波。当时只算了维护成本，**没有算进这条当时不知道的分发收益**。

技术成本票 04 已经量过：`files`/`bin` 早已备好、`npm pack` 产物 **5.7MB**、装出来 15.7s、启动 114ms、`better-sqlite3` 自带 8 平台预编译。**包名 `worksplice` 在 npm 上可用**（2026-10-03 实测 `npm view worksplice` → 404）。

选项：

- **(a) 提前到首发**：D-7 备料时一并 `npm publish`；README 首行改 `npx worksplice`（比 Release 资产 URL 短得多）；Release 资产照旧挂（两条路并存，互为备份）。
- **(b) 维持第二波**：首发只用 Release 资产 URL（已实测可行）。
- **(c) 发布但不在首发文案里主推**：只吃目录收录，文案仍给 Release URL。

**⚠️ 先核实一件事**：官方目录的**收录条件未核实**——页面没说是否要求包里有 `pi` 字段、或某个 topic/keyword。在把 npm 提为首发路径之前，需要先确认「一个不是 pi extension 的 Node 应用包会不会被收录」（可行手段：读 pi 站点/仓库的目录生成逻辑，或先发一个 0.0.x 试探包观察）。**这一条不确认，选项 (a) 的收益就是假设。**

**产出**：决定 + 若走 (a)/(c)，npm 账号与 2FA、发布流程的确认清单（哪些只有作者本人能做），并回写票 07 的日历与票 09 的检查单。

**注**：npm 包发布超过 72 小时后基本不可撤——这是把它提前的主要不可逆成本。

## Answer

2026-10-03 谈定。**先核实了收录条件，结论推翻了我立票时的前提。**

### 1. 核实结果：那条「高杠杆分发路径」对 worksplice 不成立

pi 官方文档原文（`packages/coding-agent/docs/packages.md`，仓库内权威源）：

> **The `pi-package` keyword makes an npm package eligible for discovery in the [Pi package gallery](https://pi.dev/packages).**

体检两个已收录包（`@lenard9191/pi-project-profile`、`pi-mcp-adapter`）：`package.json` 里都带 **`pi-package` 关键词** ＋ 一个 **`pi` 字段**（声明 `extensions` / `skills` / `prompts` / `themes`）。而 pi 文档对 package 的定义是「extensions, skills, prompt templates, and themes as one unit」。

→ **worksplice 是独立服务端应用**，没有 `pi` 字段、也没有可声明的扩展资源。就算加上关键词挤进画廊，画廊给用户的安装命令 `pi install npm:worksplice` **也装不出任何能用的东西**。所以票 06 调研里那句「发到 npm 会被官方目录自动收录、杠杆高几个数量级」**对 worksplice 不成立**——那是把「pi 扩展作者的路径」误当成了「所有依赖 pi 的项目的路径」。

### 2. 决定

- **首发就发 npm**（`6eba0ba` 的「不通过包仓库分发」在本票被推翻），**但不加 `pi-package` 关键词**。
- 收益（实打实）：README 首行从长 URL 变成 **`npx worksplice`**；进入 npm 搜索（npm 官方文档：搜索只吃 `title/description/readme/keywords`，无主观排名）。
- 成本（票 04 已量）：`files`/`bin` 早已备好、包 **5.7MB**、装出 15.7s、启动 114ms、`better-sqlite3` 自带 8 平台预编译；包名 `worksplice` 可用（实测 404）。
- **Release 资产照旧挂**（两条路并存、互为备份）——`npx --yes <资产 URL>` 已实测可用。
- **画廊收录不作为收益**：要走那条路得先做一个**真正的 pi package**（扩展或 skill），属产品活 → 已记入地图「Out of scope」。

### 3. 执行清单（不在本图内 → 票 09 检查单与票 10 计划）

- npm 账号与 2FA（**只有作者本人能做**）；`npm publish`（`files` 已排除 `.next/cache`，无需改动）。
- 包的 `description` 用票 02 的 57 字符短变体；`keywords` 认真填。
- README 中英首行的安装命令改成 `npx worksplice`；票 07 日历的 D-7 备料段加上「npm 发布」。
