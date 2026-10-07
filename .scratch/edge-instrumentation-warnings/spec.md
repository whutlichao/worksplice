# edge-instrumentation-warnings

Source: GitHub issue https://github.com/whutlichao/worksplice/issues/101 （票据正本）

## Problem Statement

`npm run dev` 的终端持续刷 Next.js 编译期警告，每个请求周期重复一组：

```text
⚠ ./instrumentation.ts:53:5
A Node.js API is used (process.exit at line: 53) which is not supported in the Edge Runtime.
⚠ ./lib/web-auth.ts:1:1
A Node.js module is loaded ('node:crypto' at line 1) which is not supported in the Edge Runtime.
⚠ ./lib/access-gate.ts:16:1  (node:net / node:os / node:timers/promises)
Import trace:
  Edge Instrumentation:
    ./lib/web-auth.ts
    ./lib/access-gate.ts
    ./instrumentation.ts
```

**功能无碍**（日志里 `GET ... 200` 全部正常），`register()` 第一行已有
`if (process.env.NEXT_RUNTIME !== "nodejs") return;` 守卫，node 侧照跑。这是纯噪音，
但每轮开发都要看一遍，且 "Ecmascript file had an error" 的措辞掩盖了这一点。

## 机制（已在 main 上取证）

`next/dist/build/entries.js` 把 `instrumentation.ts` 与 middleware 文件归进
**同一个 edge layer，无条件双编译**：

```js
layer: isApi ? WEBPACK_LAYERS.apiEdge
     : (isMiddlewareFilename(name) || isInstrumentation) ? WEBPACK_LAYERS.middleware
     : ...
```

因此 `instrumentation.ts` **顶层静态 import** 的 `@/lib/access-gate` 会把
`node:net` / `node:os` / `node:timers/promises` 拖进 edge 那一遍编译，
`access-gate` 再静态引 `./web-auth.ts` → `node:crypto`。

噪音自 #98（`b6f7f35` 引入 access-gate 的 node 内置模块）起存在；此前没有。

## Solution（方向已由维护者裁定：F1 最小面）

把 access-gate 从 `instrumentation.ts` 的顶层静态 import 改成 `register()`
内 `NEXT_RUNTIME` 守卫**之后**的动态 import，使 edge 编译的静态图里不再出现
Node 内置模块。行为不变（node 侧 register 走完整路径）。

补充实测结论（worker 取证，见 issues/01 的 Answer）：只改 import 不够——
`process.exit` 写在 `instrumentation.ts` 的**文件体**里，edge 那遍编译扫的是
「静态 import 图 + 文件体本身」，不认运行时守卫，所以 `process.exit` 的警告
与 import 链无关。启动闸整体（含 `process.exit`）搬进一个新模块，
由 `register()` 守卫之后动态 import。这仍在 F1 授权面内
（Target 明列「至多新增一个文件承载从 access-gate 拆出的启动期逻辑」）。

**已裁定的兜底**：若实测下来 Turbopack 不对 `NEXT_RUNTIME` 做常量折叠、警告清不掉，
worker 带必红/半绿证据 `worker_done` 报回，**由 coordinator 拿证据再决策**——
worker 不许自行扩大到 F2（惰性化 access-gate 判定层）或 F3（只文档化）。

## Testing Decisions

- **必红命令**：改动前 `npm run dev` 起一次，统计 stderr 里
  `not supported in the Edge Runtime` 的条数，必须 > 0（把实际输出贴进 Answer）。
- **必绿命令**：改动后同一条命令，条数必须 = 0。
- 该判据是本票唯一有信息量的门禁（全量单测不覆盖 `instrumentation.ts` 的导入图）。
- 另跑 `npm run typecheck`（退出码 0）与 `npm run lint` 增量对照（零新增）。
- 红绿证据必须是真实执行过的输出，不是推断。

## Out of Scope

- 不改 `lib/access-gate.ts` 判定层本体（F2 方向）。
- 不做只文档化的降级处理（F3 方向）。
- 不改 `proxy.ts`（Next 16 下 proxy 跑 Node runtime，不产生该警告）。
- 不动 ADR-0013 准入闸的 fail-closed 语义。

## Further Notes

- 装依赖用 `bun install`（AGENTS.md 明令，禁 `npm install`）。
- 不要跑 `next build`（污染 `.next/`，AGENTS.md 明令）。
- 反馈回路脚本：`evidence/repro.sh`（红绿两遍同一条命令，退出码 1=红 / 0=绿且 200）。
