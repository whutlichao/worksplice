# 05: Agent 详情只读 Pi transcript viewer

**What to build:** 在 Agent 详情右栏现有“会话导出”旁提供可展开的只读 transcript viewer。它只读取该成员当前精确登记的 Pi session，展示其当前分支路径并支持向前分页；不从目录或文件名猜测归属，不提供会话写入或分支切换。

**Blocked by:** 03 — 让全部协作界面的 agent 身份头像同步使用当前头像色。

**Status:** ready-for-agent

- [ ] Agent 详情右栏在现有“会话导出”旁呈现 transcript 展开区；展开可读，收起不影响会话导出入口。
- [ ] 读取通过以 member ID 取数的公开 GET handler seam；请求不接受任意文件路径。handler 只查该成员当前 `pi_session_file` 并读取该文件，不扫描 workspace/cwd/project root，不按 basename、文件名、分叉关系或其它相似条件回退归属。
- [ ] 仅呈现该成员当前 `pi_session_file` 精确指向的单个 Pi session 的当前分支路径。不得列出、切换其它 session 或分支；同 cwd/workspace 但登记文件不同的 session 不得混入。
- [ ] 当前分支中的现有 Pi 消息类型均能完整呈现，包括 user、assistant、tool/custom、compaction 等；viewer 只读，不提供编辑、回复、工具执行或其它会改写 Pi 文件/消息的操作。
- [ ] 首次展开/打开显示当前分支最新 100 条消息；“加载更早”沿同一分支连续向前取页，保留时间顺序、无重复或遗漏，直至浏览该分支全部消息并在起点停止加载。
- [ ] 一次展开/打开建立文件快照；加载更早继续该快照。手动刷新或关闭后重新展开读取新快照并重置分页；不做 SSE/流式实时跟随。
- [ ] 没有 `pi_session_file`、登记文件不存在、文件为空或当前分支为空时，详情展开区呈现明确空态；读取或解析失败呈现与空态区分的错误状态，并可通过手动刷新重试。
- [ ] 展开区有高度上限并在内部滚动；约 `50vh` 仅为建议值，须适配小屏及现有面板/设计 token，不将建议值固化为跨设备高度承诺。
- [ ] 行为测试覆盖 `AgentDetailPanel` 的实际展开、刷新、加载更早和关闭后重开；公开 GET handler 测试通过 member ID 取数，验证不接受任意路径、只用成员当前 `pi_session_file`、缺失/空/错误状态与当前分支分页边界。
- [ ] 对当前分支首屏 100 条及连续前序页做外部行为断言；成功场景覆盖多种现有消息类型，确保分页无重漏。测试不依赖内部状态形状或强行引入任意 path 参数。

## Comments

- 产品行为范围来自产品所有者在本次 coordinator interview 中已确认的共识；本票只细化 viewer 与安全读取，不新增产品决策。
