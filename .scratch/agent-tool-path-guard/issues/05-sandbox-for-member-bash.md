# 05-成员 bash 的沙箱与 env 收口

Type: task
Status: ready-for-agent
Blocked by: （无；03 已 resolved，04 是文档票，本票实施 ADR-0012 的六条决策）

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/agent-bash-containment-form.md`
ADR: `docs/adr/0012-agent-bash-containment-form.md`（决策一至六）· `docs/adr/0013-http-corridor-caller-identity.md`（决策三 env 收口）
前置事实: `docs/adr/0011-agent-file-tool-path-guard.md`（票 02 已合入）

## What to build

让成员的 `bash` 落在**操作系统级沙箱**内（判据落到进程，不落在命令文本上），并把 `WORKSPLICE_*`
从子进程环境里收掉。逐条对应 ADR-0012 的六条决策：

1. **形态**：允许面由**与路径守卫同一份**允许根判定生成（复用 `lib/tool-path-guard.ts` 的
   `pathGuardScopeFor`，不新造第二套目录解析）。
2. **allow-only profile**：清单内可达、其余一律不可达。清单 = 成员允许根 + 系统只读面 +
   进程自己的 `TMPDIR` + 只读工具链缓存。**用户级凭证不进清单**（`~/.ssh` / `~/.config/gh` /
   keychain 类）——已拍板的代价是成员 shell 不能 `git push` / `gh pr create`。
3. **覆盖范围 = 沙箱跟随会话归属的成员**：工具面与 `lib/rpc/session.ts` 的 RPC 面（人类 `!bash`
   走同一条路）走同一判定；**无人归属的会话（人类自己的会话）不沙箱**。规则是会话属性而非工具属性。
4. **越界处置**：机制换成内核的 `Operation not permitted` / exit 134，并把它归因成**可读错误**；
   该成员的允许根写进**注册期的工具描述**（边界先于撞墙）。仍**不静默改写、不静默截断**。
5. **平台 fail-closed**：macOS 用 `sandbox-exec`；Linux 用 `bwrap`（**本机没有、未验证——测不出来
   就不声称覆盖**）；Windows 无对应物。**拿不到沙箱就不激活 bash**。
6. **env 收口**：命名空间一刀切剥 `WORKSPLICE_*`，不带成员判定分支；保留 pi 故意暴露的
   `PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL`。
   只有 `WORKSPLICE_PASSWORD` 是真秘密，其余 `WORKSPLICE_*` 并非机密，按命名空间一刀切更省心。

沙箱与 env 收口落在**同一个 operations 包装**上：bash 工具面有 `BashToolOptions.spawnHook`，
但 RPC 面没有 spawnHook、落 `env ?? getShellEnv()` 兜底，唯一杠杆是 operations 包装；且包装必须
**总是显式构造 env**，不能写成「上游给了就转交」。

## Acceptance criteria

- [ ] profile 由**同一份**允许根判定派生（改允许根 → profile 跟着变），不新造第二套目录解析。
- [ ] profile 是 allow-only：清单外读被拒、清单外写被拒；成员允许根内读写照常。
- [ ] 用户级凭证面（`~/.ssh`、`~/.config/gh`、keychain 类）不在清单内，并有负例断言。
- [ ] 工具面与 RPC 面走同一判定（断言两处都进沙箱）；人类无归属会话**不**沙箱。
- [ ] 越界失败可读化：EPERM 与 exit 134 有断言（不是裸码），且指明边界与允许根。
- [ ] 允许根写进**注册期**的工具描述（边界先于撞墙），且 pi 原生描述/准则不退化。
- [ ] 拿不到沙箱的平台 fail-closed：bash 不激活（拒绝执行而不是裸跑），档位展示能解释这件事。
- [ ] `WORKSPLICE_*` 全部剥除、五个 `PI_*` 全部保留，各有断言。
- [ ] 冒烟清单：node / npm / git / gh 各跑一条只读命令（清单够用）。
- [ ] 负例：根外读、根外写、`sh <工作区内脚本>` 藏载荷、`node -e` 路径作数据、`$VAR` 间接。
- [ ] Linux `bwrap` 的 profile 生成有实现与测试，但**未在本机验证**这一事实照实写进文档与测试。
- [ ] 不改任何工具档位的名义构成（`PRESET_FULL` / `PRESET_DEFAULT` 仍含 bash），不改
      `lib/tool-presets.ts` 的档位定义本身。
- [ ] 不做 TOCTOU 加固（沿用 ADR-0011 决策六）；不声称 bash 收口完成（HTTP 走廊票在前）。

### 门禁（G-impl）

- 测试档位：**宽**（全量）。本票改的是每个会话的 shell 执行路径，影响面圈定不了；全量 `npm test`
  实测 8-10 秒 / 970+ 用例，付全量成本接近零。
- 两层 seam 都要测：纯函数层（profile 生成、允许面判定、env 过滤，可穷举）+ 集成层（真会话里
  越界被拒、合法路径零行为变化、人类无归属会话不被沙箱）。
- `tsc --noEmit` 零错误；lint 只报告不修；**绝不 `next build`**。
- 红绿证据落 `.scratch/agent-tool-path-guard/evidence/`。
- **双轴 code-review（Standards + Spec）不可省**：本票跨 bash 接缝 / env / 平台适配 / 档位展示，
  不满足「无跨模块 seam」这条可数判据。Answer 里有独立 Review 小节（两份报告不合并、不重排）。
- 机械判据：`git status --porcelain` 空；`git diff --numstat` 无四位数以上单文件；
  `gh pr list --head <分支>` 有一条 OPEN。

## Notes

- 涉及模块：`lib/bash-containment.ts`（纯层：平台适配 / profile 生成 / env 收口 / 失败归因）、
  `lib/bash-containment-extension.ts`（pi 侧装配：operations 包装 + bash 同名覆盖注册）、
  `lib/rpc/caller.ts` 与 `lib/rpc/session.ts`（两处接线）、`lib/tool-path-guard.ts`（复用，不改语义）。
- 术语用 `CONTEXT.md` 的领域词：允许根、路径守卫、沙箱。
- 提问通道 `orchestration ask`；预授权代答的项见派活 spec。
- Linux 侧实现但未验证；Windows 无对应物 → fail-closed。

## Answer

（待填）
