/**
 * 人类面准入闸（ADR-0013 决策二）：loopback 零配置照旧；**非 loopback bind + 无凭证 ⇒ 服务不可用**
 * （fail-closed，与 ADR-0012 决策五同构：拿不到安全前提就不提供服务）。
 *
 * 为什么判定必须落在服务进程内：`npm run dev:lan` / `start:lan` 直接起 `next dev -H 0.0.0.0`，
 * **绕过 `bin/worksplice.js`**——只改 CLI 包装会漏掉四条 npm 脚本与任何手敲的 `next dev -H 0.0.0.0`。
 * CLI 包装另加第一道明确报错（bin/worksplice.js），本模块是第二道、也是真正兜底的那一道。
 *
 * 「非 loopback」怎么知道：服务进程里没有 `server.address()`（Next 持有 server），
 * 所以用**自连接探针**——对本机每个非 loopback 网卡地址在本服务端口上试一次：
 * **本服务在该地址答得上 HTTP** = 监听接受了非 loopback 连接；全部 ECONNREFUSED = 只绑了 loopback；
 * 有不可判定（超时等）就不声称 loopback（返回 unknown）。unknown 不关服务（保住零配置承诺），
 * 但会让 CLI/启动日志提醒；绝不把 unknown 当成「已确认 loopback」。
 *
 * 为什么判据不能只是「TCP 握手成功」（本模块曾因此把一个只绑 loopback 的 dev 服务关掉）：
 * tun 型 VPN / 代理客户端对**自己地址上的任意端口**都完成握手，握手后既不转发也不回一个字节。
 * 取证（macOS，Shadowrocket 的 `MacPacketTunnel`，网卡 `utun9`，服务只绑 `127.0.0.1:40143`）：
 *
 * | 候选地址 | 网卡 | 握手探针 | 该端口上实际有监听吗 |
 * | --- | --- | --- | --- |
 * | `192.168.10.245` | en0 | refused | 否 |
 * | `198.18.0.1` | utun9 | refused | 否 |
 * | `fd00:1234:ffff::10` | utun9 | **open（零字节应答）** | **否** |
 * | `fe80::2e0:4cff:fe68:ec4` | utun9 | unknown | 否 |
 *
 * 对照：`127.0.0.1:40143` 上什么都没监听时，探 `[fd00:1234:ffff::10]:40143` 同样返回 open——
 * 「握手成功」与「本服务在听」之间没有因果关系。所以 `open` 的判据收紧为「拿得到 HTTP 应答字节」
 * （见 `probeAnswer`）；零字节应答归 `refused`（假 accept 的正解），不能归 `unknown`——
 * `unknown` 会让真 `0.0.0.0` 暴露静默通过，等于丢掉 fail-closed 的方向。
 *
 * 判据收紧后有两件事必须一起看，否则会从「误判 non-loopback」翻成「漏判 non-loopback」：
 * ① **静默只在服务答得比探测预算快时才是证据**：所以下结论前先校准「本服务在 loopback 上答得上
 *    HTTP 吗」，只对「接了连接却零字节」的候选做一次复判（`rescanSuspects`）；
 * ② **探不到应答的那一档不可缓存**：启动期 `register()` 未返回前 Next 只接连接、不处理请求
 *    （本机实测：启动闸里打 `/favicon.ico` 只剩零字节——临时把预算放宽到 10s 复验仍然一个字节都
 *    不回；同一进程 servable 之后同一路径 3ms 答 404），把那一档的 unknown 缓存下来就是
 *    fail-open——实测后果：
 *    `next dev -H 0.0.0.0`（无密码）+ tun 型 VPN 时局域网直接拿到 200。所以启动闸那一次只能
 *    如实返回 unknown，由请求门在第一个真实请求上重判（ADR-0013 决策二留的「以请求门为准」）。
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

/** 建连预算：本机自连接只走一次三次握手，300ms 已是宽松上限。 */
const DEFAULT_PROBE_TIMEOUT_MS = 300;

/**
 * 应答预算：建连成功后还得在多久内看到 HTTP 应答的第一个字节。
 *
 * 为什么与建连预算分开成两段：两件事的时间尺度不同。tun 型 VPN 客户端的假 accept 在握手阶段
 * **一分钱都不花**（瞬间完成），真正有信息量的等待落在「它会不会回码」这一段；混用一个预算时，
 * 要么把假 accept 等太久（启动闸被拖住），要么把慢一点的 HTTP 应答误判成假 accept。
 */
const DEFAULT_PROBE_ANSWER_TIMEOUT_MS = 500;

/** HTTP 应答的开头（RFC 9112 §4：`HTTP-version` 先出现）。 */
const HTTP_RESPONSE_PREFIX = "HTTP/1.";

/**
 * 探测路径：**必须落在 `proxy.ts` 的 matcher（`/` 与 `/api/:path*`）之外**。三条理由：
 * ① 命中 matcher 的请求会先进 `proxy()`，而 `proxy()` 第一件事就是 `getAccessPosture()` ——
 *    探针会重入自己（启动期 memo 尚未写入，就是一个探测套探测的递归）；
 * ② 答得快的路径不能触发路由编译：dev 下首次访问页面路由要编译（本机实测 `/` 的首次 6.27s
 *    里有 5.8s 是 next.js 编译），会把应答预算吃掉、把真服务误判成假 accept；
 * ③ `/favicon.ico` 是 Next 的静态图标位，答的是 404，不进 app 路由编译（本机实测同进程第二次
 *    1.5–4.7ms）。
 */
const PROBE_PATH = "/favicon.ico";

/** 去掉 IPv6 字面量外层的方括号（`[::1]` → `::1`），其余原样返回。 */
function stripBrackets(address: string): string {
  return address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
}

/** loopback 形态（含 IPv4-mapped IPv6）：`127.0.0.0/8` 与 `::1`。 */
export function isLoopbackAddress(address: string): boolean {
  const lower = stripBrackets(address).toLowerCase();
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

/**
 * 握手探针：TCP 建连成功 = `open`。
 *
 * 只保留给「目标上不存在第三方 acceptor」的两处——loopback 自连复核与启动等待；对非 loopback
 * 候选地址不够用（tun/VPN 假 accept，见模块头注释）。
 */
export function probeHandshake(
  address: string,
  port: number,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
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

export interface ProbeAnswerOptions {
  connectTimeoutMs?: number;
  answerTimeoutMs?: number;
}

/** 一次应答探测的完整结论：`result` 之外还带上「对端到底接没接」。 */
export interface ProbeAnswerDetail {
  result: ProbeResult;
  /** 对端接受了 TCP 连接（不论后来答没答）。 */
  peerAccepted: boolean;
}

/** HTTP/1.1 必带 Host；IPv6 字面量要括起来。不带任何凭证。 */
function probeHostHeader(address: string, port: number): string {
  const unbracketed = stripBrackets(address);
  return unbracketed.includes(":") ? `[${unbracketed}]:${port}` : `${unbracketed}:${port}`;
}

/**
 * 应答探针（socket 层接缝）：探那个地址上是不是有个 HTTP 服务在答（本服务，或同端口上的
 * 另一个 HTTP 服务——后者同样 ⇒ `non-loopback`，因为那意味着这个端口不在我们手上，
 * 多判 non-loopback 正是 fail-closed 要的方向）。
 *
 * 判据是「建连成功后能拿回以 `HTTP/1.` 开头的字节」——**任意状态码都算**（不要求 200：带
 * `WORKSPLICE_PASSWORD` 时 401、不允许的 Host 403、静态路径没匹配上 404、姿态 closed 时 503，
 * 全都证明本服务在这个地址上可达；要的是「答得上」，不是「答得对」）。零字节应答是 tun 型
 * 假 accept 的正解：`refused`。
 *
 * 四档收敛（与 `ProbeResult` 一一对应）：
 * - 收到 `HTTP/1.` ⇒ `open`；
 * - 建连成功但**预算内零字节**、或应答阶段 EOF/RST/非 HTTP 字节 ⇒ `refused`；
 * - TCP 建连阶段 `ECONNREFUSED` ⇒ `refused`；
 * - TCP 建连阶段其它错误或超时 ⇒ `unknown`（保留既有「不可判定」语义，绝不据此声称 loopback）。
 */
export function probeAnswerDetailed(
  address: string,
  port: number,
  options: ProbeAnswerOptions = {},
): Promise<ProbeAnswerDetail> {
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const answerTimeoutMs = options.answerTimeoutMs ?? DEFAULT_PROBE_ANSWER_TIMEOUT_MS;
  return new Promise((resolve) => {
    const socket = createConnection({ host: address, port });
    let settled = false;
    let connected = false;
    let received = "";
    let connectTimer: NodeJS.Timeout | null = null;
    let answerTimer: NodeJS.Timeout | null = null;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (answerTimer) clearTimeout(answerTimer);
      socket.destroy();
      resolve({ result, peerAccepted: connected });
    };

    connectTimer = setTimeout(() => finish("unknown"), connectTimeoutMs);
    // latin1 = 字节到字符一一对应，前缀判定不会因多字节解码而漂移。
    socket.setEncoding("latin1");
    socket.once("connect", () => {
      connected = true;
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      answerTimer = setTimeout(() => finish("refused"), answerTimeoutMs);
      socket.write(
        `GET ${PROBE_PATH} HTTP/1.1\r\n` +
          `Host: ${probeHostHeader(address, port)}\r\n` +
          "Connection: close\r\n\r\n",
      );
    });
    socket.on("data", (chunk: string) => {
      received += chunk;
      // 不足一个前缀：还可能凑出 HTTP/1.，继续等（预算兜底）。
      if (received.length < HTTP_RESPONSE_PREFIX.length) return;
      finish(received.startsWith(HTTP_RESPONSE_PREFIX) ? "open" : "refused");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      // 建连阶段的错误沿用旧语义（ECONNREFUSED / 其它）；建连之后（如写请求时对端 RST）
      // 是「对端不是本服务」的直接证据。
      if (!connected) finish(error.code === "ECONNREFUSED" ? "refused" : "unknown");
      else finish("refused");
    });
    socket.once("close", () => finish(connected ? "refused" : "unknown"));
  });
}

/** 只要三态的视图（socket 层接缝的常用形状）。 */
export async function probeAnswer(
  address: string,
  port: number,
  options: ProbeAnswerOptions = {},
): Promise<ProbeResult> {
  return (await probeAnswerDetailed(address, port, options)).result;
}

type Probe = (address: string, port: number) => Promise<ProbeResult>;
type CandidateProbe = (address: string, port: number) => Promise<ProbeAnswerDetail>;

interface ProbeSet {
  /** 候选地址：必须答得上 HTTP（假 accept 不算数）。 */
  candidate: CandidateProbe;
  /** loopback 自连复核 / 启动等待：握手即可。 */
  loopback: Probe;
  /**
   * 注入 seam 命中时为 true。为什么要有这个标记：注入面只表达三态（既有四条注入用例逐字不动），
   * 装不下 `peerAccepted`，也就没法区分「接了连接却沉默」与「压根没接上」——所以注入路径不做
   * 校准与复判，直接按注入探针自己的话收口。
   */
  injected: boolean;
}

/**
 * 两个探针的口径分工（本模块唯一的「怎么看对端」决策点）：
 *
 * - `candidate`：非 loopback 候选地址 ⇒ **必须答得上 HTTP**。只看握手会把 tun 型 VPN 客户端的
 *   假 accept 读成 open（见模块头注释的取证）。
 * - `loopback`：自连复核 ⇒ **握手即可**，与上面刻意不对称：① loopback 上不存在第三方 acceptor，
 *   能在这个地址握手成功的只可能是本进程自己监听的端口，握手已经是只够的判据；
 *   ② 再加一道 HTTP 要求只会多出一个假 negative。
 * - 注入 seam（`probe`）命中时两者共用注入的那个，且丢掉「对端接没接」这个细节（注入的是三态）。
 */
function resolveProbes(probe: Probe | undefined, timeoutMs: number): ProbeSet {
  if (probe) {
    return {
      injected: true,
      candidate: async (address, port) => ({
        result: await probe(address, port),
        peerAccepted: false,
      }),
      loopback: probe,
    };
  }
  return {
    injected: false,
    candidate: (address, port) =>
      probeAnswerDetailed(address, port, { connectTimeoutMs: timeoutMs }),
    loopback: (address, port) => probeHandshake(address, port, timeoutMs),
  };
}

interface ScanOutcome {
  open: boolean;
  undecided: boolean;
  /** 「接了连接却零字节」的候选：只有它们才可能是「我们的服务，只是刚才没空答」。 */
  suspects: string[];
}

/** 扫一轮候选地址：`open` 命中就短接，顺手带回不可判定与嫌疑名单。 */
async function scanCandidates(
  candidates: string[],
  port: number,
  probe: CandidateProbe,
): Promise<ScanOutcome> {
  const outcome: ScanOutcome = { open: false, undecided: false, suspects: [] };
  for (const address of candidates) {
    const detail = await probe(address, port);
    if (detail.result === "open") return { ...outcome, open: true };
    if (detail.result === "unknown") outcome.undecided = true;
    if (detail.peerAccepted) outcome.suspects.push(address);
  }
  return outcome;
}

/**
 * 复判嫌疑候选：静默只有在「服务自己答得比探测预算快」时才是证据。
 *
 * 「接了连接却零字节」有两个来源，只有靠「本服务现在答得上 HTTP 吗」才能分开：
 * ① tun 型 VPN 客户端的假 accept（永不回应）；
 * ② 本服务自己暂时答不上来（dev 编译窗口、启动期未 servable）。
 *
 * 所以先用 loopback 校准服务能不能答，再只对嫌疑地址复扫一轮——真绑在非 loopback 地址上的服务
 * 会因为这一轮被看见。少了这一段，实测后果是 fail-open：`next dev -H 0.0.0.0`（无密码）配上
 * tun 型 VPN 时，首轮候选探测撞上冷启动（首个请求 4.66s）⇒ refused ⇒ 误判 loopback ⇒
 * 局域网直接拿到 200。
 *
 * 返回 `null` 表示**校准没过**：服务自己都答不上 HTTP，静默不构成证据，此时不能下任何结论。
 */
async function rescanSuspects(
  suspects: string[],
  port: number,
  probes: ProbeSet,
): Promise<ScanOutcome | null> {
  const calibration = await probes.candidate("127.0.0.1", port);
  if (calibration.result !== "open") return null;
  return scanCandidates(suspects, port, probes.candidate);
}

/** 探针的完整结论：`scope` 之外还带回「这个结论可不可缓存」。 */
export interface BindScopeVerdict {
  scope: BindScope;
  /**
   * 探针把话说清了吗？false = 服务自己都没答上来（启动期请求还没被处理 / 它根本不是 HTTP），
   * 此时候选的静默不构成证据，因而**不能缓存**——缓存「暂时不知道」等于把这个进程永久钉在
   * open 上（实测 fail-open）。
   *
   * 代价写明：不缓存 ⇒ 下一个调用者重探一次。单次上限 = 候选数 ×（建连 + 应答预算），且只在
   * 「服务自己答不上 loopback HTTP」这一异常档发生；它一旦答得上，结论就 settle 并写进 memo，
   * 后续请求零成本。无 PORT 那一档不缓存但也不探测（直接返回），所以不会变成每次请求的开销。
   */
  settled: boolean;
}

export interface DetectBindScopeOptions {
  port?: string | null;
  interfaces?: () => NetworkInterfaceAddress[];
  probe?: Probe;
  /** 每个候选的**建连**预算（应答预算是常量，见 `DEFAULT_PROBE_ANSWER_TIMEOUT_MS`）。 */
  connectTimeoutMs?: number;
}

/**
 * 候选全不答、且服务在 loopback 上在听时，最后一句话能说什么。
 *
 * 两种情形到此已经没有别的解释：
 * - 没有嫌疑候选（没人接连接却沉默）⇒ 候选上的「不答」已经确定（refused / unknown）；
 * - 有嫌疑候选 ⇒ 只看下一轮复判，并且只信「服务自己答得上 HTTP」时的复判。
 */
async function concludeAllQuiet(
  first: ScanOutcome,
  port: number,
  probes: ProbeSet,
): Promise<BindScopeVerdict> {
  const quietScope: BindScope = first.undecided ? "unknown" : "loopback";
  // 注入 seam 的约定：注入的探针自己说了算，不再多探一次（既有四条注入用例逐字不变）。
  if (probes.injected) return { scope: quietScope, settled: true };
  if (first.suspects.length === 0) return { scope: quietScope, settled: true };

  const second = await rescanSuspects(first.suspects, port, probes);
  if (second === null) return { scope: "unknown", settled: false };
  if (second.open) return { scope: "non-loopback", settled: true };
  return {
    scope: first.undecided || second.undecided ? "unknown" : "loopback",
    settled: true,
  };
}

/**
 * 自连接探针：本进程是否能通过某个非 loopback 地址到达自己的服务端口。
 * 接口清单与探针都可注入（单测不碰真实网络）。
 */
export async function detectBindScopeVerdict(
  options: DetectBindScopeOptions = {},
): Promise<BindScopeVerdict> {
  const portRaw = options.port ?? process.env.PORT ?? null;
  const port = portRaw && /^\d+$/.test(String(portRaw).trim()) ? Number(portRaw) : null;
  if (!port) return { scope: "unknown", settled: false };

  const list = (options.interfaces ?? defaultInterfaces)();
  const candidates = [
    ...new Set(
      list
        .filter((entry) => !entry.internal && !isLoopbackAddress(entry.address))
        .map((entry) => entry.address),
    ),
  ];
  if (candidates.length === 0) return { scope: "loopback", settled: true };

  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probes = resolveProbes(options.probe, connectTimeoutMs);

  const first = await scanCandidates(candidates, port, probes.candidate);
  if (first.open) return { scope: "non-loopback", settled: true };

  // 候选全不答还得下结论：服务可能根本还没开始监听（启动早期，或用户 env 里预置了 PORT），
  // 也可能它就在这个端口上、只是不在任何非 loopback 地址上。用 loopback 自连复核：
  // 连得上 = 服务确实在听（握手判据，理由见 resolveProbes 的不对称）。
  const loopback = await probes.loopback("127.0.0.1", port);
  if (loopback !== "open") return { scope: "unknown", settled: false };

  return concludeAllQuiet(first, port, probes);
}

/** 三态视图（既有接口面，测试与外部调用用它）：`settled` 只在 `detectBindScopeVerdict` 上。 */
export async function detectBindScope(
  options: DetectBindScopeOptions = {},
): Promise<BindScope> {
  return (await detectBindScopeVerdict(options)).scope;
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
    probe?: Probe;
    pollMs?: number;
  },
): Promise<boolean> {
  const port = typeof options.port === "string" ? Number(options.port) : options.port;
  if (!Number.isInteger(port) || port <= 0) return false;
  const timeoutMs = options.timeoutMs ?? 3000;
  const pollMs = options.pollMs ?? 25;
  // 这里保持**握手**判据（与候选探针刻意不对称）：目标恒为 127.0.0.1，不存在第三方 acceptor
  // 会假接；而「等端口开始监听」不该被 HTTP 应答权限影响（带 WORKSPLICE_PASSWORD 时的 401、
  // 探测路径被谁挡掉，都与「是否已 listening」无关）。
  const probe =
    options.probe ??
    ((address: string, targetPort: number) =>
      probeHandshake(address, targetPort, DEFAULT_PROBE_TIMEOUT_MS));
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
 *
 * `options` 只给测试注入判定层用（`proxy.ts` / 启动闸都不传）。
 *
 * 两处口径：
 * - 配了密码时不再探测——姿态与 bind 无关（配了密码走 Basic Auth，loopback 上也没变）；
 * - **只在探针把话说清时缓存**：启动闸那一次探不到 HTTP 应答（`register()` 未返回前 Next 只接
 *   连接、不处理请求，实测零字节），那一档只能是 unknown。把它缓存下来会把「暂时不知道」变成这个
 *   进程永久的口径——实测后果：真绑 `0.0.0.0` 的 dev 服务被判成 open，局域网直接拿到 200。
 *   不缓存 ⇒ 第一个真实请求上重判（那时请求已经能被处理），结论照常落在请求门的 503 上。
 */
export async function getAccessPosture(
  options: DetectBindScopeOptions = {},
): Promise<AccessPosture> {
  if (globalThis.__workspliceAccessPosture) return globalThis.__workspliceAccessPosture;
  const passwordEnabled = isWebPasswordEnabled();
  if (passwordEnabled) {
    globalThis.__workspliceAccessPosture = decideAccessPosture({
      passwordEnabled: true,
      bind: "unknown",
    });
    return globalThis.__workspliceAccessPosture;
  }
  const verdict = await detectBindScopeVerdict(options);
  const posture = decideAccessPosture({ passwordEnabled: false, bind: verdict.scope });
  if (verdict.settled) globalThis.__workspliceAccessPosture = posture;
  return posture;
}

/** 测试钩子：清掉 memo（生产进程不需要）。 */
export function resetAccessPostureCache(): void {
  globalThis.__workspliceAccessPosture = undefined;
}
