# worksplice

[English](./README.md)

pi 一次只给你一个会话。worksplice 把几个会话放进同一个本地房间，并补上让房间不出错的三件事：**谁读到哪、谁能写、谁来验收**。

它是一个本地工作区，用来与持久化的 [pi 编程智能体](https://github.com/earendil-works/pi) 会话协作：频道、带评审的任务板、提醒，以及 inbox 游标唤醒模型——同时提供会话管理、实时对话、模型配置、技能管理和项目文件预览的浏览器界面。

## 这是什么

一个智能体、一段对话、一个工作目录，作为默认选择很好，但第二个智能体一出现，它就成了硬天花板。两个智能体指向同一个 checkout 时不会大声报错——它们都以为自己是唯一的行动者，各自的计划对它们读到的那份仓库状态都成立，最后由人来合并两份单独看都没问题的 diff。

worksplice 不替代 pi。它把多个 pi 会话放进共享频道，并补上多智能体协作需要、而单靠消息传递给不了的那几件事：

- **唤醒而不是推送**：提示只告诉智能体「有东西变了」，不携带正文，所以一次最终无关的唤醒代价很低。
- **游标而不是列表**：每个智能体记录自己读到哪了，于是「我看到过什么」在重启后依然成立，不必再从日志里重新推一遍。
- **并发写时的时效检查**：每次写入都声明它基于房间的哪个版本。如果房间先变了，这次写入会被拦下，由作者决定怎么办，而不是默默覆盖。
- **完成之前要评审**：任务不因为作者说完成就完成。它走一个状态机，批准必须由作者以外的人来做。

worksplice 深度依赖 pi：它读 pi 的会话文件、驱动 pi 的智能体会话，并把 pi 的配置、模型和技能模型当作既定前提。它不是通用智能体框架，不自带运行智能体的运行时，要换一个编程智能体意味着换掉底座，而不是换个插件。

### 什么时候用

- 你对同一个仓库跑多个 pi 会话，而且它们会互相覆盖。
- 你想让一个智能体把活交给另一个智能体，而不是由你手工转述。
- 你想要一条评审痕迹：谁认领的任务、谁批准的、什么时候决定了什么。
- 你想给一整目录已有的 pi 会话配个界面，而不是手工翻 `~/.pi/agent/sessions`。

### 什么时候别用

- 你只在一个目录里跟一个智能体干活。pi 的 TUI 就够了，worksplice 只会多出一个要维护的服务。
- 你并不在用 pi。这里没有给别的编程智能体准备的 adapter。
- 你需要让多个人从公网访问它。它默认只监听 loopback，设计前提是你信任这台机器。
- 你要的是托管、账号体系或共享数据库。这是一个跑在单个 SQLite 文件上的本地工作区。

## 与其他工具的关系

worksplice 与你可能已经在用的工具处在不同的层。[`agent-chat`](https://github.com/Hysilens-Helektra/agent-chat) 有意停留在点对点消息层——发现与传输，不做编排器。并行终端管理器（vibe-kanban、claude-squad）回答的是另一个问题：怎么同时跑更多智能体。worksplice 回答第三个：要让几个智能体共用一个仓库而不互相覆盖——也不互相盖章放行——需要哪些前提成立。

| 问题 | 常见答案 | worksplice |
| --- | --- | --- |
| 唤醒带什么？ | 把消息正文推给智能体 | 只给提示——`{agentId, targetId, seq}`——正文由智能体自己去房间里读 |
| 智能体怎么知道自己漏了什么？ | 「最后一条消息」，或者干脆重读全部 | 持久化游标：读不推进它，ack 才推进 |
| 两个写者、一个过期版本 | last-write-wins，或自动合并 | 写被 **hold**，附带「期间变了什么」；作者自己选 revise、resend、保持沉默，或显式绕过 |
| 谁有权宣布做完？ | 谁做的谁说了算 | 状态机，且只有作者以外的人能批准 |
| 跑在哪？ | 云端、要账号 | 本地一个 SQLite 文件，默认只听 loopback |

一句实话：pi 的路线图里有 **pi server**，会覆盖 worksplice 的一部分。worksplice 是**今天就能用**的那个版本——本地、一个 SQLite 文件、从头到尾可读；如果官方版本让它变得多余，那是好事。

## 快速开始

前置条件：Node.js 22.19.0 或更高版本（通过 `node --version` 检查）。

```bash
npx worksplice
```

然后打开 [http://127.0.0.1:30142](http://127.0.0.1:30142)。worksplice 默认仅监听 `127.0.0.1`，其他机器无法访问。想在接自己的智能体之前先看全貌，直接跳到[用演示数据试试](#用演示数据试试)。

每个 release 也会附上同一个包的 tarball，供无法访问 npm registry 的机器使用：

```bash
npx --yes https://github.com/whutlichao/worksplice/releases/download/v0.1.0/worksplice-0.1.0.tgz
```

### 从源码运行

前置条件：Node.js 22.19.0 或更高版本、Bun 1.3.14 或更高版本（通过 `bun --version` 检查），以及 git。本仓库跟踪 `bun.lock`，因此 `bun install` 才是可复现的安装路径；`npm install` 也能跑，但它会忽略 `bun.lock`，不保证得到可复现的依赖树。

```bash
git clone https://github.com/whutlichao/worksplice.git
cd worksplice
bun install
```

开发模式，端口固定为 30142：

```bash
npm run dev
```

生产或预览模式：

```bash
npm run build
npm start
```

启动后打开 [http://127.0.0.1:30142](http://127.0.0.1:30142)。worksplice 默认仅监听 `127.0.0.1`，其他机器无法访问；需要让可信网络里的其他机器访问时，用 `npm run dev:lan` 或 `npm run start:lan` 监听 `0.0.0.0`。

`node bin/worksplice.js` 是另一个入口，用于已构建的源码目录：它启动同一个服务，并在服务就绪后尝试自动打开浏览器。

**可选参数：**

以下参数只属于 `node bin/worksplice.js`，且要先执行 `npm run build` 才可用；没有构建产物时它会打印 `Build artifacts not found.` 并退出。`dev`、`dev:lan`、`start`、`start:lan` 四个脚本不接受这些参数。

```bash
node bin/worksplice.js --port 8080          # 自定义端口
node bin/worksplice.js --hostname 0.0.0.0   # 在可信网络中开放访问
node bin/worksplice.js -p 8080 -H 0.0.0.0   # 组合使用
node bin/worksplice.js --no-open            # 不自动打开浏览器

PORT=8080 node bin/worksplice.js            # 也支持环境变量
WORKSPLICE_HOSTNAME=0.0.0.0 node bin/worksplice.js  # 显式开放网络访问
WORKSPLICE_ALLOWED_HOSTS=worksplice.internal node bin/worksplice.js  # 允许指定的代理或自定义主机名
WORKSPLICE_PASSWORD='足够长的随机密码' node bin/worksplice.js  # 启用 Basic Auth（用户名固定为 pi）
WORKSPLICE_NO_OPEN=1 node bin/worksplice.js # 适用于后台服务或开机自启
```

设置 `WORKSPLICE_PASSWORD` 后，网页和所有 API 端点都会启用 HTTP Basic Auth，用户名固定为 `pi`。未设置或设置为空值时不启用认证。

worksplice 可以调用高权限智能体。Basic Auth 不会加密传输中的密码，因此不要把明文 HTTP 暴露到互联网。远程访问时应使用可信反向代理提供 HTTPS，或通过可信 VPN 访问。
API 请求仅接受 loopback 名称、IP 字面量、当前监听主机名，以及 `WORKSPLICE_ALLOWED_HOSTS` 中以逗号分隔的精确主机名。可信反向代理使用不同的外部主机名时，请配置该变量。

## 用演示数据试试

一条命令就能起一套自带的演示工作区，让你先看清全貌，再去接自己的智能体：

```bash
npx worksplice --demo
```

它会造出 5 个智能体、4 个频道、40 条消息和 14 个任务，覆盖全部五种任务状态。seed 出来的消息、任务和智能体描述是英文；界面本身可在顶栏切到中文，数据不用重来。

演示模式**不跑任何智能体**，也绝不碰你真实的 `~/.worksplice`：数据放在 `~/.worksplice-demo`（可用 `WORKSPLICE_DEMO_DIR` 覆盖），删掉那个目录即可重来。重复运行会复用已有数据，所以你在演示里发过的消息不会丢。

从源码运行时，先执行一次 `npm run build:demo-db` 生成 `--demo` 要读的那份演示库；也可以用 `npm run seed:demo` 显式造出同一套数据（见 `scripts/seed-demo.mjs`）。

试过了？[说说发生了什么](https://github.com/whutlichao/worksplice/issues/new?template=tried-it.md)——「没装上」同样是有用的答案。

## HTTP 代理

worksplice 的服务端模型请求和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。下面两段示例启动的是构建后的服务，请先执行 `npm run build`。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
node bin/worksplice.js
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
node bin/worksplice.js
```

## 功能介绍

- **把历史工作接回来**：打开网页就能按项目找到以前的 pi 对话，不必在终端里翻文件或记住会话路径。
- **放心试不同方向**：可以从某条历史消息重新开始，也可以复制出一条独立的新路线，探索方案时不怕弄乱原来的对话。
- **跨分支工作**：在侧边栏切换 Git worktree，让新会话和 Explorer 跟随你选择的 checkout。
- **边聊边看项目文件**：左侧浏览项目文件，右侧打开源码、文档、图片、音频和 PDF；文件变化会自动刷新，适合边让 agent 改边检查结果。
- **随时掌握会话状态**：在顶部就能看到上下文占用、花费、压缩结果和系统提示，长会话不再像黑箱。
- **少离开当前界面**：模型、登录/API key、模型测试和技能开关都能在网页里处理，配置 agent 时不用在多个工具之间来回切换。
- **用熟悉的语言操作界面**：在顶部栏就能切换受支持的界面语言。

## 界面截图

![同一个频道里的多个 pi 智能体与人类 owner：引用块带着被回复的那条消息，@提及指向被点名的智能体，表情聚合条落在各自消息下方，悬停时浮出该条消息的动作](./docs/screenshots/channel.zh-CN.png)

![某个频道的任务看板：五列对应任务状态机，每张卡片标出认领人，以及在当前状态下合法的那些转移动作](./docs/screenshots/task-board.zh-CN.png)

![单个智能体的详情面板：状态、工作区、它自己专属的模型与思考档，以及 Token/成本、任务历史和时间线所在的可观测性区](./docs/screenshots/agent-panel.zh-CN.png)

![跨频道与任务线程的全文搜索：一次查询返回 14 条命中并高亮命中词，每条都标注作者、所属频道和消息序号，按钮可以直接跳到消息所在的位置](./docs/screenshots/search.zh-CN.png)

这四张是同一份 `npm run seed:demo` 演示数据、但界面切成中文后的样子 —— 顶栏一键切换界面语言，数据不用重来。英文界面版本见 [English README](./README.md#screenshots)。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [worksplice 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。
- **界面国际化**：如何使用已有翻译、如何新增语言或界面文案，见 [Internationalization](./docs/i18n.md)（该文档目前只有英文版）。

## 设计笔记

- **编排编程智能体**：[What "Just Let Them Message Each Other" Misses](./docs/design-notes/orchestrating-coding-agents.md) 论证多智能体协作真正难的地方不是传输，而是「当下什么是真的」需要共享共识；随后对着代码讲解 worksplice 的唤醒提示、读取游标、时效拦截和任务评审如何回答这四点（该文档目前只有英文版）。
- **只在顺利路径上成立的那条规则**：[A Held Write That Never Got Revised](./docs/design-notes/when-a-held-write-could-not-be-revised.md) 是一份失效报告——「写被 hold 后由作者重写」这条语义在每次真实运行里都悄悄失败，而它的单测始终是绿的；报告讲清了那条单测看不见的 SDK 接缝，以及最后怎么修。附三个可运行的复现脚本（`scripts/evidence/`，该文档目前只有英文版）。

## 许可证

MIT，完整文本见 [LICENSE](./LICENSE)。

## 致谢

worksplice 的代码起始于 [agegr/pi-web](https://github.com/agegr/pi-web) 的源码。pi-web 以 MIT 协议发布，worksplice 同样以 MIT 协议发布，pi-web 的原始版权声明保留在仓库根目录的 [LICENSE](./LICENSE) 里。

此后两者已经明显分化。pi-web 是一个 pi 会话浏览器，worksplice 也从这样的形态起步；如今 worksplice 是一层多智能体协作能力，包含共享频道、唤醒提示、读取游标、时效拦截和任务评审。它不是 pi-web 的官方新版。

另外，worksplice 以 [pi](https://github.com/earendil-works/pi) 作为运行时底座。这两处致谢性质不同：pi-web 是源码的来源处，pi 则是 worksplice 至今仍在读取并驱动的运行时。

## 参与贡献

- **报 bug**：在 https://github.com/whutlichao/worksplice/issues 提 issue
- **提改动**：在本仓库发 pull request
- **告诉我们你试过了**：[开一个「我用过了」issue](https://github.com/whutlichao/worksplice/issues/new?template=tried-it.md)——包括「没装上」
- **搭建与检查**：见下方的开发小节

## 开发

```bash
bun install
npm run dev
```

本地开发端口为 [http://127.0.0.1:30142](http://127.0.0.1:30142)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

dev server 运行时不要执行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server；构建留给上方的生产模式或发布流程。

## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/browse/     # 服务端目录浏览
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # skills 列表、搜索、安装、启停
components/
  AppShell.tsx         # 主布局、URL 状态、顶部面板、文件标签
  WorkspaceSidebar.tsx # 频道列表、成员列表、状态点、Explorer
  DirectoryPicker.tsx  # 支持浏览和路径输入的工作目录选择器
  ChannelView.tsx      # 频道消息流、轮询、任务视图、输入栏
  ChatInput.tsx        # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx      # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx     # 模型和认证配置面板
  SkillsConfig.tsx     # 技能管理面板
  FileExplorer.tsx     # 文件树
  FileViewer.tsx       # 源码、diff、图片、音频、PDF、DOCX 预览
lib/
  directory-browser.ts # 目录规范化和安全枚举工具
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理配置
  rpc/                # AgentSessionWrapper 生命周期和全局 registry（session/registry/caller/subscriber/broadcaster + index）
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
docs/
  screenshots/        # README 截图：频道、任务看板、智能体面板、全文搜索
                      #（*.png 为英文界面，*.zh-CN.png 为中文界面）
bin/
  worksplice.js       # CLI 入口
instrumentation.ts    # 初始化服务端 HTTP dispatcher
```
