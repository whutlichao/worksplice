/**
 * 服务启动钩子（Next instrumentation）：
 * 1. 人类面准入闸第二道（ADR-0013 决策二）：非 loopback bind + 无凭证 ⇒ 拒绝启动——
 *    判定必须落在服务进程内，因为 `npm run dev:lan` / `start:lan` 等四条 npm 脚本
 *    直接起 `next ... -H 0.0.0.0`，**绕过 `bin/worksplice.js`**（那里的第一道报错盖不到它们）。
 *    取证结论（起步「抛错能否阻止 Next 启动」）见票据 06 的 Answer 与
 *    `.scratch/agent-tool-path-guard/evidence/`；无法阻止启动时以请求门（proxy.ts 503）为准。
 * 2. agent-loop（§5.4）与秘书自动创建（spec-bootstrap-agent §6.1）：与准入闸同款纪律——
 *    非阻塞、失败不致命，但准入闸是例外：它必须先于一切业务启动完成。
 */

import {
  accessGateClosedMessage,
  getAccessPosture,
  waitForServerListening,
} from "@/lib/access-gate";

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
async function enforceAccessGateAtStartup(): Promise<void> {
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

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await enforceAccessGateAtStartup();

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // 演示模式（`worksplice --demo`）：只让人看一遍协作现场，不启动 agent-loop、
  // 也不自动创建秘书——否则会在访客自己的机器上真的跑起 agent（改掉演示现场，
  // 还烧掉他的 token）。演示库里的消息都是 wake:false 写进去的，本来就不会唤醒谁。
  if (process.env.WORKSPLICE_DEMO === "1") return;

  // agent-loop（§5.4）：崩溃恢复补拉 + wake 驱动 + reminder cron（§5.6 逐分钟轮询）；
  // 秘书首次启动自动创建（spec-bootstrap-agent §6.1，ticket 05）：agent-loop 启动之后执行，
  // 幂等（名字全等 + 软删标记，删除后不重建），defaultModel 未配置跳过；两条启动路径均不阻塞、失败不致命
  const { createAgentLoop } = await import("@/lib/agent-loop/index");
  const { autoCreateSecretary } = await import("@/lib/domain/collab");
  void Promise.resolve()
    .then(() => createAgentLoop().start())
    .catch((error) => {
      console.error(
        "[worksplice] agent loop startup failed:",
        error instanceof Error ? error.message : String(error),
      );
    })
    .then(() => autoCreateSecretary())
    .catch((error) => {
      console.error(
        "[worksplice] secretary auto-create failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
}
