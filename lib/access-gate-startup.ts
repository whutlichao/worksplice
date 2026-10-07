/**
 * 准入闸的**启动期**执行（ADR-0013 决策二第二道闸，从 `instrumentation.ts` 拆出）。
 *
 * 为什么值得单独成文件（issue #101）：Next 把 `instrumentation.ts` 与 middleware 归进同一个
 * edge layer **无条件双编译**（`next/dist/build/entries.js` 的 edgeServer 分支），那一遍编译扫的是
 * instrumentation 的**静态 import 图 + 文件体本身**——不看运行时守卫。于是两样 Node 专有物必然被它看见：
 * 判定层 `./access-gate.ts` 顶层拖 `node:net` / `node:os` / `node:timers/promises`，连带 `./web-auth.ts`
 * 拖 `node:crypto`；`process.exit` 则直接写在 instrumentation 的文件体里。
 *
 * 拆分的意义：这两样都搬进**只在 `register()` 的 `NEXT_RUNTIME === "nodejs"` 守卫之后动态 import**
 * 的模块里，edge 那遍的静态图就干净了，噪音归零；node 侧行为一字未变（见
 * `.scratch/edge-instrumentation-warnings/evidence/` 的必红/必绿计数）。
 *
 * ⚠️ 合并回 `instrumentation.ts` = 警告回来。判定层本体（纯函数 + 探针 + memo）不在这儿，
 * 在 `./access-gate.ts`；这里只有「启动这一刻按判定层的结论决定放不放服务」。
 */

import {
  accessGateClosedMessage,
  getAccessPosture,
  waitForServerListening,
} from "./access-gate.ts";

/** 等 Next 把实际监听端口写进 process.env.PORT（start-server 在 listening 事件里写）。 */
async function waitForServerPort(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.env.PORT) return process.env.PORT;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return process.env.PORT ?? null;
}

/**
 * 启动门：非 loopback + 无凭证 ⇒ 拒绝启动（fail-closed 的「拿不到安全前提就不提供服务」）。
 * 两件护栏（缺一就会误判成 open）：
 * - 端口未知（Next 还没写 process.env.PORT）→ 不探（探针会退化成 unknown），留给请求门；
 * - 端口已知但服务还没真的 listening（用户 env 里预置了 PORT）→ 等下再探，
 *   否则「非 loopback 全 refused」会被误读成 loopback（`detectBindScope` 的 loopback 复核也防这层）。
 */
export async function enforceAccessGateAtStartup(): Promise<void> {
  const port = await waitForServerPort(3000);
  if (!port) {
    console.warn(
      "[worksplice] access gate: server port unknown at startup; the request gate will decide per request",
    );
    return;
  }
  const listening = await waitForServerListening({ port, timeoutMs: 3000 });
  if (!listening) {
    console.warn(
      "[worksplice] access gate: server not listening yet at startup; the request gate will decide per request",
    );
    return;
  }
  const posture = await getAccessPosture();
  if (posture === "closed") {
    console.error(`[worksplice] ${accessGateClosedMessage()}`);
    process.exit(1);
  }
}
