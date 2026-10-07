# 07-内核按端口过滤：成员连不上 worksplice 自己的端口

Type: task
Status: in-progress
Blocked by: 05, 06

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/http-corridor-caller-identity.md`（决策五第 ③ 环）、`docs/agent-bash-containment-form.md`
ADR: `docs/adr/0013-http-corridor-caller-identity.md`（决策四、决策五）、`docs/adr/0012-agent-bash-containment-form.md`（决策五）
前置票: 05（沙箱，PR #97）、06（成员能力面移出 HTTP，PR #98）

## Problem Statement

票 05 落地后成员 bash 已进内核沙箱，但 profile 写着 `(allow network*)`——它**不封网络**。
于是成员仍能 `curl http://127.0.0.1:<app 端口>/api/*`，而 `POST /api/agent/[id]` 的
`{"type":"bash"}` 走**未沙箱**的裸本地实现、且这条路由没有调用者身份（进门一律按 Owner）。
人类已实测：`curl -s -m 3 http://127.0.0.1:30142/api/channels` 返回 200 与完整频道 JSON
（含 private 的 `secretary-office`）。

这是 ADR-0012 决策六那条排序链的**最后一环**：HTTP 走廊票（06）→ 沙箱票（05）→ 本环。

## Solution

沙箱 profile 保留 `allow network*`（**不能封死出网**：成员要能 `npm install`、拉依赖、访问外部服务），
追加一条按端口的 deny——`(deny network* (remote ip "*:<port>"))`（ADR-0012 Further Notes 已实测的形态，
`docs/agent-bash-containment-form.md:238`）：**只封指定端口，同机其它 loopback 与出网都不受影响**。

**端口必须推导，不能硬编码**（实测教训：某 agent 的 MEMORY.md 速查里记的 base URL 是 `30141`，
实际监听 `30142`，`30141`/`30143` 都没监听；端口会变，`-p` 与自定义端口都支持）。
来源 = **本服务进程实际监听的端口**：Next 在 `listening` 事件里把**真实绑定**的端口写进
`process.env.PORT`（`next/dist/server/lib/start-server.js:296`；dev 端口被占时自动改端口也写进去），
仓库既有事实（`instrumentation.ts` 的启动门、`lib/access-gate.ts`）读的就是这一个变量。

**推导不出来 ⇒ fail-closed**：不封等于洞开着，绝不静默退回「不封」。落地成 ADR-0012 决策五
同款姿态——**不激活 bash**（而不是降级成不封端口的沙箱），并让档位展示能解释这件事。

**机制前提**：bwrap 只有 `--share-net` / `--unshare-net` 两档，**无法表达「只封一个端口」**
（`--unshare-net` 会连出网一起封，违反约束）⇒ Linux 侧同样 fail-closed，不静默放开。

## What to build

- `lib/bash-containment.ts`：
  ① 端口推导（纯函数吃 env，薄适配读 `process.env`，与 `detectBashSandbox` 同款纪律）；
  ② profile 追加按端口 deny（空列表 ⇒ **整体** `deny network*`，不是放开）；
  ③ 机制矩阵补「能否按端口过滤」这一维；④ 两个前提的合取（拿得到沙箱 ∧ 机制能按端口过滤 ∧ 推导得出端口）
     产出**有效 resolution**，下游三处（fail-closed 拒绝文本 / 工具描述 / 档位展示）沿用既有通路；
  ⑤ 边界文本加一句端口规则（决策四「边界先于撞墙」）。
- `lib/bash-containment-extension.ts`：装配处把两个前提合成一个有效 resolution（一个调用、一处答案）。

## Acceptance criteria

- [ ] 端口推导有断言：来自 Next 写入的实际监听端口、`-p` 自定义端口同样覆盖；**不是硬编码常量**。
- [ ] 推导不出来 ⇒ fail-closed（不激活 bash，不是「不封端口的沙箱」），该分支有测试覆盖。
- [ ] profile：`(allow network*)` 之后紧跟按端口 deny；**出网不被封**（正例）；其它 loopback 端口不被封。
- [ ] 真会话实测（绿证据）：负例 = 成员会话内 curl app 端口被**内核拒绝**（`Operation not permitted` /
      连不上，**不是 HTTP 4xx/5xx**）；正例一 = 仍能出网；正例二 = 人类会话不受影响；正例三 = 成员经 loop
      的结构化回复协议调协作能力照常（票 06 的 op 在进程内，不经网络）。
- [ ] `lib/tool-presets.ts` 零 diff（`git diff --stat` 不出现该文件）。
- [ ] 全量 `npm test` 输出落 Answer；`tsc --noEmit` 零错误；lint 只报告不修；未跑 `next build`。
- [ ] 双轴 code-review（Standards + Spec）报告落 Answer。
- [ ] 机械判据：`git status --porcelain` 空、`git diff --numstat` 无四位数源码单文件、分支有 OPEN 的 PR。
- [ ] Answer 写明：ADR-0012 决策六那条链的三环是否真的闭合；残留逐条列清（不笼统说「已收口」）。

## Notes

- 人类会话不沙箱（决策三：无人归属的会话不沙箱）⇒ 人类自己开浏览器/curl 不受影响，验收里要有反向断言。
- Linux `bwrap` 的等价形态照票 05 的先例：argv 形态照给，**本机未验证就不要声称覆盖**，测试只断言形态。
- 提问通道 `orchestration ask`。预授权代答：profile 规则写法 / 端口推导实现 / 模块划分 / 命名 /
  测试策略形状 / 从 ADR-0011·0012·0013 推出的结论 / 必要的配置读取入口。
  必须 ask：封端口后必要操作被连带阻断；`(deny network* (remote ip ...))` 在当前 macOS 对 loopback 不生效。