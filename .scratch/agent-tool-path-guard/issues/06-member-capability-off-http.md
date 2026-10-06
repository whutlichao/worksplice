# 06-成员能力面与协作面移出 HTTP（+ 人类面非 loopback fail-closed）

Type: task
Status: claimed
Blocked by: 04

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/http-corridor-caller-identity.md`
ADR: `docs/adr/0013-http-corridor-caller-identity.md`（决策一、二、四、五）
前置票: 04（设计票 resolved，PR #96）；02（路径守卫，ADR-0011 已合入）

## What to build

实施 ADR-0013 的四条决策：

- **决策一（本票主体）**：app 的协作面整体不再经 HTTP 暴露给成员侧。① 在 loop 的结构化回复协议
  （`parseAgentAction`，今天已承载 `claim` / `complete` / `unclaim`）上新增三条 op：
  `schedule reminder` / `react` / `pin`——`docs/spec.md` §5.4 的 act 清单本来就写了这三条，
  实现没跟上；② 身份取**结构身份**（`runAgentRound` 握有 agent，调用点天然知道它代表谁），
  不经请求头自述；③ **不注册新工具**——`lib/tool-presets.ts` 全程不动。
  **授权范围**：op 对全部成员同等开放（不做秘书豁免），能否执行由协作服务层按调用者身份裁决，
  判据是「默认拒绝、逐条开口，开口的是不提升调用者权限、只扩大协作面的动作」；人类专属操作
  （归档 / 删除身份 / 三种 reset / 改 runtime / 改 workspace）不开。
- **决策二**：人类面准入——loopback 零配置照旧；**非 loopback bind + 无凭证 ⇒ 服务不可用**
  （fail-closed）。判定必须落在**服务进程内**（`proxy.ts` / `instrumentation.ts` 一类位置），
  因为四条 npm 脚本直接起 `next`，绕过 `bin/worksplice.js`；CLI 包装另加第一道明确报错。
  **取证项**：`instrumentation.ts` 抛错能否真的阻止 Next 启动——测不出就如实记为未达成，
  以请求门为准，不要假装它生效。
- **决策四**：`{"type":"bash"}` 那条入口**不加第二道身份门**（本机没有区分「人类 curl」与
  「成员 curl」的手段，加一道无效的门比没门更坏）——本票不改它，也不声称收口了它。
- **决策五**：ADR-0012 的 Further Notes 里「按端口过滤可用但本形态不使用」那条保留的理由
  （「秘书的 curl 能力面是锁定条目」）因票 04 的 Q4 裁定消失，端口过滤成为可用形态——
  本票负责启用它，与票 05 的内核沙箱衔接（沙箱落地前靠 ADR-0012 决策五，落地后靠内核按端口过滤；
  两阶段各有一条支撑、中间无空窗）。

秘书原有的 7 条能力与旧 curl 速查保持不变（read 类每轮语境里本来就有；创建类由新增 op 承接）。

## Acceptance criteria

- [ ] 协议纯函数层：三条 op 的解析（形状 / 缺字段 / 未知 op 名）；授权裁决的默认拒绝与逐条开口。
- [ ] 集成层（真 `runAgentRound` + 真 DB + fake session/runtime）：成员经 op 成功调用的 3 条能力
      （react / pin / 设提醒），副作用可观察（reaction 行 / pinned 行 / reminder 行）。
- [ ] 越权调用被拒：成员身份调用人类专属操作（归档 / reset / 改 runtime）被拒（反向断言）。
- [ ] 身份取结构身份：成员 X 的 op 以 X 的名义落库（不是 Owner）。
- [ ] `lib/tool-presets.ts` 零 diff（`git diff --stat` 不出现该文件）。
- [ ] 非 loopback + 无凭证 ⇒ 服务不可用；非 loopback + 有凭证 ⇒ 可用；loopback + 无凭证 ⇒ 零配置可用。
- [ ] `instrumentation.ts` 能否阻止启动的取证结果如实写进 Answer。
- [ ] 红绿证据落 `.scratch/agent-tool-path-guard/evidence/`。
- [ ] 全量 `npm test` 输出落 Answer；`tsc --noEmit` 零错误；lint 只报告不修；绝不 `next build`。
- [ ] 双轴 code-review（Standards + Spec）报告落 Answer。
- [ ] 机械判据：`git status --porcelain` 空、`git diff --numstat` 无四位数单文件、分支有 OPEN 的 PR。

## Notes

- 本票**不声称 bash 收口完成**：在票 05 落地前 `{"type":"bash"}` 与 Owner 权限面对成员仍敞开
  （ADR-0013 残留 #1）；Answer 里要写清这个依赖。
- 不改 `lib/tool-presets.ts` 的档位定义；不做 HITL / 审批流；消息不可变（新建类 op 若落消息，
  走既有 `sendMessage` 不变量）。
- 提问通道 `orchestration ask`；预授权代答项见 dispatch spec（取证方法 / 模块划分 / op 命名与字段形状 /
  从 ADR 推出的结论 / 端口过滤实现方式）。

## Answer

（完成后填写：交付物 / outcome / 测试数字 / 取证 / Review / 残留。）
