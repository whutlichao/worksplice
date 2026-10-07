# 01-fix-edge-instrumentation-warnings

Type: implement
Status: in-progress
Assignee: worksplice-dev (worker term_3dac0866-88e6-4924-9bb8-2bf634a414d7)
Blocked by: （无）
Closes: GitHub #101

## Problem Statement

`npm run dev` 每个请求周期刷一组 Next Edge Runtime 警告（`not supported in the Edge Runtime`），
共 5 条 × 2 轮 = **10 条**：`instrumentation.ts:53` 的 `process.exit`，加上
`lib/access-gate.ts` 的 `node:net`/`node:os`/`node:timers/promises` 与连带的
`lib/web-auth.ts` 的 `node:crypto`。功能无碍（请求全 200），纯噪音。

根因：Next 把 `instrumentation.ts` 与 middleware 归进同一个 edge layer **无条件双编译**
（`next/dist/build/entries.js` 的 edgeServer 分支），那一遍扫的是
**静态 import 图 + 文件体本身**，不认 `register()` 里的 `NEXT_RUNTIME` 运行时守卫。

## Solution

F1 最小面（维护者裁定）：准入闸的启动期逻辑整体搬进新模块
`lib/access-gate-startup.ts`，`instrumentation.ts` 在 `NEXT_RUNTIME` 守卫**之后**
动态 `await import("@/lib/access-gate-startup")`。

`lib/access-gate.ts` 判定层本体一字未动。

## Implementation Decisions

1. **为什么必须连 `process.exit` 一起搬**：只把 import 改成动态是不够的——
   `process.exit` 写在 `instrumentation.ts` 的**文件体**里（模块顶层函数
   `enforceAccessGateAtStartup`），edge 那遍编译不看运行时可达性，照样报。
   实测确认（见 Answer 第 1 节的 `instrumentation.ts:53:5` 那条）。
2. **新文件路径选 `lib/access-gate-startup.ts` 而非 coordinator 建议的
   `lib/access-gate/startup.ts`**（dispatch 原文「路径由你定」）：
   同一个模块的名摊在一个文件和一个同名目录上会让 locality 变差、两个 import
   路径指同一个概念；而 `lib/` 下既有单职责模块一律扁平 kebab-case
   （`lib/agent-status.ts`、`lib/agent-lifecycle.ts`、`lib/bash-containment.ts`）。
3. **两处写「合并回去警告就回来」的告警注释**：拆分的理由不在代码形状里，
   在构建器的行为里；不写下来下一个「顺手清理」的人会把 `process.exit` 挪回来。

## Testing Decisions

见 spec.md「Testing Decisions」。本票测试档 = 窄，理由见 Answer 第 4 节。

## Out of Scope

见 spec.md「Out of Scope」。本票**未**触碰：`lib/access-gate.ts`、`proxy.ts`、
ADR-0013 的 fail-closed 语义。

## Comments

- 2026-09-30 开工。coordinator 在 main 上已取证机制与传递链，本 worker
  按 dispatch 要求**自己先跑了一遍必红命令**（10 条）才动手。

## Answer

<!-- ANSWER -->
