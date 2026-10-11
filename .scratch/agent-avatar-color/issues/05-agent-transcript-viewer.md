# 05: Agent 详情只读 Pi transcript viewer

**What to build:** 在 Agent 详情右栏现有“会话导出”旁提供可展开的只读 transcript viewer。它只读取该成员当前精确登记的 Pi session，展示其当前分支路径并支持向前分页；不从目录或文件名猜测归属，不提供会话写入或分支切换。

**Blocked by:** 03 — 让全部协作界面的 agent 身份头像同步使用当前头像色。

**Status:** resolved

- [x] Agent 详情右栏在现有“会话导出”旁呈现 transcript 展开区；展开可读，收起不影响会话导出入口。
- [x] 读取通过以 member ID 取数的公开 GET handler seam；请求不接受任意文件路径。handler 只查该成员当前 `pi_session_file` 并读取该文件，不扫描 workspace/cwd/project root，不按 basename、文件名、分叉关系或其它相似条件回退归属。
- [x] 仅呈现该成员当前 `pi_session_file` 精确指向的单个 Pi session 的当前分支路径。不得列出、切换其它 session 或分支；同 cwd/workspace 但登记文件不同的 session 不得混入。
- [x] 当前分支中的现有 Pi 消息类型均能完整呈现，包括 user、assistant、tool/custom、compaction 等；viewer 只读，不提供编辑、回复、工具执行或其它会改写 Pi 文件/消息的操作。
- [x] 首次展开/打开显示当前分支最新 100 条消息；“加载更早”沿同一分支连续向前取页，保留时间顺序、无重复或遗漏，直至浏览该分支全部消息并在起点停止加载。
- [x] 一次展开/打开建立文件快照；加载更早继续该快照。手动刷新或关闭后重新展开读取新快照并重置分页；不做 SSE/流式实时跟随。
- [x] 没有 `pi_session_file`、登记文件不存在、文件为空或当前分支为空时，详情展开区呈现明确空态；读取或解析失败呈现与空态区分的错误状态，并可通过手动刷新重试。
- [x] 展开区有高度上限并在内部滚动；约 `50vh` 仅为建议值，须适配小屏及现有面板/设计 token，不将建议值固化为跨设备高度承诺。
- [x] 行为测试覆盖 `AgentDetailPanel` 的实际展开、刷新、加载更早和关闭后重开；公开 GET handler 测试通过 member ID 取数，验证不接受任意路径、只用成员当前 `pi_session_file`、缺失/空/错误状态与当前分支分页边界。
- [x] 对当前分支首屏 100 条及连续前序页做外部行为断言；成功场景覆盖多种现有消息类型，确保分页无重漏。测试不依赖内部状态形状或强行引入任意 path 参数。

## Comments

- 产品行为范围来自产品所有者在本次 coordinator interview 中已确认的共识；本票只细化 viewer 与安全读取，不新增产品决策。

## Answer

- 实现：详情面板新增只读 viewer。GET handler 只按 member ID 读取成员当前登记的 `pi_session_file`；通过文件描述符/文件身份检查拒绝符号链接或替换竞态，不接受任意路径、不扫描目录。使用 Pi SDK 解析当前分支，固定快照按游标分页（首屏 100 条）；刷新与关闭重开建立新快照，空态、错误/重试均明确。沿用消息呈现器支持 Pi 消息、独立工具结果及图片；截断 bash 输出沿服务端返回的 session ID 取回。中英双语，滚动区限制为 `min(50vh, 420px)`。
- TDD/覆盖：新增 transcript route 与 AgentDetailPanel/viewer 行为测试，覆盖 member/session 绑定、当前分支、首屏与连续分页、快照并发/闲置回收、空/错/重试及展开/刷新/分页/重开。单独转义 glob 命令 `node --test --test-timeout=60000 'app/api/members/[[]id]/transcript/route.test.mjs'` 实际执行 **9/9**；普通未转义 `[id]` 命令曾因 Node glob 解释得到 0 tests，不能作为证据，仓库全量入口正常发现这些测试。全量测试 **1402/1402**。
- 浏览器 smoke（隔离数据目录）：真实页面验证 viewer 展开/收起/重开；刷新后读到新追加消息；加载到最早历史页；配对及孤立工具结果、配对图片、截断 bash 完整输出均可见；滚动区计算高度上限为 420px。首次等待超时来自临时 bash fixture 不符合既有安全命名约定，以及完整输出加载后仍需展开折叠的工具块；修正 fixture 并按 UI 两步交互复验通过，未改产品代码。
- Review — Standards：无硬性 finding；一项低优先级判断是 `AgentTranscriptViewer.test.mjs` 的 hook driver 直接替换 React 私有 dispatcher。按收尾冻结要求未再改源码；实际用户可见的展开/刷新/分页/重开另经 ego-browser 对最新页面复验通过。后续若扩展交互测试，应优先迁至稳定的 DOM 输出/公开状态 seam。
- Review — Spec：0 项 finding；票内全部验收满足，没有扩展规格范围。
- 最终门禁：`npm test`（1402/1402）、`node_modules/.bin/tsc --noEmit`、`npm run lint`（0 errors；`hooks/useI18n.tsx:61` 有 1 条既有 warning）、`git diff --check` 均通过。`AGENTS.md` 与 HEAD 一致，未纳入交付。
- PR：[#163](https://github.com/whutlichao/worksplice/pull/163)（base: `main`，open，未合并）。
