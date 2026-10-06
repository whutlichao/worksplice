/**
 * 人类面准入闸（ADR-0013 决策二）：loopback 零配置照旧；**非 loopback bind + 无凭证 ⇒ 服务不可用**
 * （fail-closed，与 ADR-0012 决策五同构：拿不到安全前提就不提供服务）。
 *
 * 为什么判定必须落在服务进程内：`npm run dev:lan` / `start:lan` 直接起 `next dev -H 0.0.0.0`，
 * **绕过 `bin/worksplice.js`**——只改 CLI 包装会漏掉四条 npm 脚本与任何手敲的 `next dev -H 0.0.0.0`。
 * CLI 包装另加第一道明确报错（bin/worksplice.js），本模块是第二道、也是真正兜底的那一道。
 *
 * 「非 loopback」怎么知道：服务进程里没有 `server.address()`（Next 持有 server），
 * 所以用**自连接探针**——对本机每个非 loopback 网卡地址在本服务端口上试连：
 * 连得上 = 监听接受非 loopback 连接；全部 ECONNREFUSED = 只绑了 loopback；
 * 有不可判定（超时等）就不声称 loopback（返回 unknown）。unknown 不关服务（保住零配置承诺），
 * 但会让 CLI/启动日志提醒；绝不把 unknown 当成「已确认 loopback」。
 */

import { createConnection } from "node:net";
import { networkInterfaces } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { isWebPasswordEnabled } from "./web-auth.ts";

export type BindScope = "loopback" | "non-loopback" | "unknown";
export type AccessPosture = "open" | "password" | "closed";
export type ProbeResult = "open" | "refused" | "unknown";

export interface NetworkInterfaceAddress {
  name: string;
  address: string;
  internal: boolean;
}

const DEFAULT_PROBE_TIMEOUT_MS = 300;

/** loopback 形态（含 IPv4-mapped IPv6）：`127.0.0.0/8` 与 `::1`。 */
export function isLoopbackAddress(address: string): boolean {
  const unbracketed =
    address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const lower = unbracketed.toLowerCase();
  const mapped = lower.startsWith("::ffff:") ? lower.slice("::ffff:".length) : lower;
  if (mapped === "::1" || mapped === "0:0:0:0:0:0:0:1") return true;
  return /^127\./.test(mapped);
}

/**
 * 姿态判定（纯函数）：
 * - 配了 WORKSPLICE_PASSWORD → "password"（今天的 Basic Auth 闸，任何 bind 都照旧）；
 * - 没配 + 确认非 loopback → "closed"（服务不可用，不是「提示你设密码」）；
 * - 其余（loopback / 未判定）→ "open"（loopback 零配置是既有承诺）。
 */
export function decideAccessPosture(input: {
  passwordEnabled: boolean;
  bind: BindScope;
}): AccessPosture {
  if (input.passwordEnabled) return "password";
  if (input.bind === "non-loopback") return "closed";
  return "open";
}

/** 服务不可用的说明（请求门 503 正文 + 启动日志共用；给出两条出路，不让人猜）。 */
export function accessGateClosedMessage(): string {
  return (
    "worksplice is listening on a non-loopback address without WORKSPLICE_PASSWORD and " +
    "refuses to serve (fail-closed). Set WORKSPLICE_PASSWORD to allow remote access, " +
    "or bind to 127.0.0.1 (the default) and restart."
  );
}

function defaultInterfaces(): NetworkInterfaceAddress[] {
  const result: NetworkInterfaceAddress[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      result.push({ name, address: address.address, internal: address.internal });
    }
  }
  return result;
}

function probeAddress(
  address: string,
  port: number,
  timeoutMs: number,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: address, port });
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    timer = setTimeout(() => finish("unknown"), timeoutMs);
    socket.once("connect", () => finish("open"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ECONNREFUSED" ? "refused" : "unknown");
    });
  });
}

/**
 * 自连接探针：本进程是否能通过某个非 loopback 地址到达自己的服务端口。
 * 接口清单与探针都可注入（单测不碰真实网络）。
 */
export async function detectBindScope(
  options: {
    port?: string | null;
    interfaces?: () => NetworkInterfaceAddress[];
    probe?: (address: string, port: number) => Promise<ProbeResult>;
    timeoutMs?: number;
  } = {},
): Promise<BindScope> {
  const portRaw = options.port ?? process.env.PORT ?? null;
  const port = portRaw && /^\d+$/.test(String(portRaw).trim()) ? Number(portRaw) : null;
  if (!port) return "unknown";

  const list = (options.interfaces ?? defaultInterfaces)();
  const candidates = [
    ...new Set(
      list
        .filter((entry) => !entry.internal && !isLoopbackAddress(entry.address))
        .map((entry) => entry.address),
    ),
  ];
  if (candidates.length === 0) return "loopback";

  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probe =
    options.probe ?? ((address: string, targetPort: number) =>
      probeAddress(address, targetPort, timeoutMs));

  let inconclusive = false;
  for (const address of candidates) {
    const result = await probe(address, port);
    if (result === "open") return "non-loopback";
    if (result === "unknown") inconclusive = true;
  }
  if (inconclusive) return "unknown";
  // 全部 refused 还不能下结论：服务可能根本还没开始监听（启动早期，或用户 env 里预置了 PORT），
  // 此时非 loopback 探针同样全 refused。用 loopback 自连复核：连得上 = 服务确实在听 ⇒ 只绑了 loopback。
  const loopback = await probe("127.0.0.1", port);
  return loopback === "open" ? "loopback" : "unknown";
}

/**
 * 等服务真的开始监听（loopback 自连成功）——启动门的护栏：`process.env.PORT` 可能来自用户 env
 * （不是 Next 在 listening 事件里写的那个），此时马上探测会把「还没监听」误读成 loopback。
 * 超时返回 false（调用方只记日志：请求门会在第一个真实请求上按同一探针判定）。
 */
export async function waitForServerListening(
  options: {
    port: string | number;
    timeoutMs?: number;
    probe?: (address: string, port: number) => Promise<ProbeResult>;
    pollMs?: number;
  },
): Promise<boolean> {
  const port = typeof options.port === "string" ? Number(options.port) : options.port;
  if (!Number.isInteger(port) || port <= 0) return false;
  const timeoutMs = options.timeoutMs ?? 3000;
  const pollMs = options.pollMs ?? 25;
  const probe =
    options.probe ?? ((address: string, targetPort: number) => probeAddress(address, targetPort, DEFAULT_PROBE_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await probe("127.0.0.1", port)) === "open") return true;
    if (Date.now() >= deadline) return false;
    await delay(pollMs);
  }
}

declare global {
  var __workspliceAccessPosture: AccessPosture | undefined;
}

/**
 * 生产入口（memo 化：一个服务进程只判定一次，请求门与启动门共用同一结论）。
 * 配了密码时不再探测——姿态与 bind 无关（配了密码走 Basic Auth，loopback 上也没变）。
 */
export async function getAccessPosture(): Promise<AccessPosture> {
  if (globalThis.__workspliceAccessPosture) return globalThis.__workspliceAccessPosture;
  const passwordEnabled = isWebPasswordEnabled();
  const bind = passwordEnabled ? "unknown" : await detectBindScope();
  globalThis.__workspliceAccessPosture = decideAccessPosture({ passwordEnabled, bind });
  return globalThis.__workspliceAccessPosture;
}

/** 测试钩子：清掉 memo（生产进程不需要）。 */
export function resetAccessPostureCache(): void {
  globalThis.__workspliceAccessPosture = undefined;
}
