## Summary

用 AgentScope 重构 worksplice 的可行性评估，**本票零源码改动**——新增一份评估文档 + 一张研究票 + 一批一手证据。

```text
docs/
└── agentscope-refactor-assessment.md        # 九节评估（本轮唯一交付物）
.scratch/agentscope-refactor-assessment/
├── issues/
│   ├── 01-agentscope-refactor-feasibility.md # Type: research / Status: resolved
│   └── evidence/                             # E01–E38（既有语料）+ R01–R61（独立重跑）
│       ├── collect.sh / verify.sh            # 全部取证命令的可执行原文
│       ├── R60-zero-hit-and-full-exclusion.txt   # 零命中的退出码记录
│       └── R61-hardened-pi-ref-counts.txt        # 全排除口径下的 pi 引用计数
└── …
```

核心结论（层错位）：

```text
worksplice 房间层（两套 AgentScope 都没有对应物）        ← 承重 9523 行，不碰底座
  频道 / thread 锚点 / UNIQUE(target_id,seq) 消息序
  consumed_seqs 每成员游标（drain 不推进 / ack 收口）
  freshness-hold / 任务状态机 + 互审门 + reopen 封锁
  channel_reads 未读 / reminders / FTS trigram / 会话文件所有权
─────────────────────────────────────────────────────
agent 框架层（pi 现在占位）                              ← 接触面 39 文件 / 6476 行
  AgentSession / 工具表 / 模型目录与凭证 / 事件流 / 沙箱 / 会话持久化
```

**判断：条件成立（conditional），但当前证据不支持换底座。推荐先走路径 C。**

| 路径 | 改动面 | 关键判据 | 结论 |
| --- | --- | --- | --- |
| A 保留 TS/Next.js，换 AgentScope TS 底座 | 39 文件 / 6476 行 | **成熟度倒挂**：候选 47 文件 / 8106 行 / 15 版本 / 88 stars；`permission` 只有类型无引擎、无 workspace/sandbox | 不可行 |
| B 后端迁 Python 2.x，Next.js 只做 UI | `lib` 22892 + `app` 5259 行 / 79 路由 | 双语言双运行时 + ADR-0007 作废 + `lib` 125 个 `*.test.mjs` 归零；Py `channels` 是外部机器人绑定；runtime 钉 1.x 线 | 不建议启动 |
| C 不换底座，收紧既有 seam + 有界 spike | 本轮 **0** | 子座接触面只有 39 文件，两条缝已存在且窄（`AgentRuntime` 4 成员 / `LoopRuntime` 结构子集） | **推荐** |

## Evidence

- **Before:** 无评估文档；`docs/` 只有 `pi-sdk-upgrade-assessment.md`，没有关于换底座的任何结论。
  **After:** `docs/agentscope-refactor-assessment.md`（770 行）九节齐备，TL;DR 给出明确条件判断，全部估算带 `[INFERENCE]`。

- **起点假设逐条重跑（我的数字 vs 票面）**：

```text
pi 引用       源码后缀 全排除: 67 hits / 47 files      票面 ≈71 / 44
              票面原文裸跑:  507 hits / 77 files     ← 自指污染，不作判据
              仅排 node_modules/.next: 71 hits      ← 票面 71 的复现口径（把 .scratch 两文件算进来）
impl 面       app lib components hooks next.config.ts: 58 hits / 39 files / 6476 行
适配器行数    5/7 文件比票面小 1（wc -l 三法自洽；git show 三版一致 → 计数口径差异）
规模          实现 53774 行 / 248 文件  ✓ 与票面一致
              测试 37834 行 / 170 文件  ✓
路由          route.ts 79（票面 80）；引 pi 的 route.ts 17（票面约 18）
域计数        lib/domain/collab 20/37（票面 19/37）、lib/data 6/2 ✓、lib/agent-loop 5/12 ✓、components 测试 30 ✓
版本          本仓 pi 四包 0.99.2 ✓；@agentscope-ai/agentscope 0.0.15 ✓；PyPI agentscope 2.0.10 ✓
```

- **外部事实全部一手**（registry 元数据 / `npm pack` 包内 `src` / PyPI JSON API / wheel 解包 / GitHub 一手 API+raw）：

```text
AgentScope TS   0.0.15  src 8106 行 / 47 文件；15 版本（0.0.1 2026-03-13 → 0.0.15 2026-07-24）
                permission/index.ts 201 行纯类型，PermissionEngine 零实现（仅 2 处 doc 注释）
                sandbox|workspace|chroot|seccomp|bwrap → 0 命中
                fork|navigate|rewind|checkpoint → 0 命中
                model: 4 provider（OpenAI/Ollama/DashScope/DeepSeek），无 OAuth
                GitHub agentscope-typescript: 88 stars，仓库仅 1 包 + 1 Electron app
AgentScope Py   2.0.10  641 .py / 122548 行；12 provider；permission/_engine.py 848 行
                workspace 8 后端（Local/Bubblewrap/Docker/E2B/Daytona/K8s/OpenSandbox/AppleContainer）
                consumed_seq|read_seq|freshness|base_seq|max_seq → 0 命中
                in_review|unclaim|reopen → 1 处无关命中
                app/channels = 外部机器人绑定（Feishu/DingTalk/Discord）
                bubblewrap 网络只有 --share-net 布尔，无按端口 deny
runtime         1.1.6.post2 钉 agentscope>=1.0.14（1.x 线），最后发布 2026-06-04
```

- **票据 `E26`/`E34` 的 0 字节**：不是采集失败，**零命中即结论**（TS 无 sandbox/workspace、Py 无 worksplice 游标词汇）。
  已用带退出码的写法复核成有记录的证据：`R60-zero-hit-and-full-exclusion.txt`。

- **磁盘纪律**：全部证据先写 `/tmp/as-verify` 再拷入库（禁止重定向进被扫描目录树）；
  递归 grep 带全排除集；最大单产物 148KB（阈值 5MB 未触）；仓库根临时 `.tgz` 已删除、未提交；
  `R50` 与 `E06` 内容逐字一致故去重，来源记入 `R50-gh-org-repos.provenance.txt`。

- **零源码改动核验**：`git diff --name-only HEAD~1 HEAD | grep -E '\.(ts|tsx|mjs)$|package\.json|README|docs/spec\.md|docs/adr/'` → **无命中**
  （evidence 里的导出面/包元数据产物已改用 `.txt` / `.meta.txt` 后缀，避免看起来像源码）。

## Merge Danger

**Door:** two-way —— 纯新增（一份文档 + 一张研究票 + 一批证据），无既有文件被改、无依赖、无配置、无 schema。`git revert` 即完全回退。

**Blast Radius:** none（评估结论本身会影响后续是否立项 A/B，但它不改变任何运行时行为）
