// 沙箱的 pi 侧装配：把成员 shell 的执行换成「沙箱里跑同一条命令」，并把 env 收在同一处。
//
// 与 `tool-path-guard-extension.ts` 同一条接缝、同一形状：worksplice 自己的 pi 扩展工厂经
// **既有**的 `resourceLoaderOptions.extensionFactories` 注册一个同名 `bash` 定义覆盖内置实现
// （ADR-0012 决策一：「不重开 ADR-0011 的注入点决策，只是把同一接缝用在第二个工具上」），
// `lib/rpc/session.ts` 的 RPC 面（人类 `!bash` 走同一条路）另外拿到同一份 operations——
// **两处共用同一份判定**（决策三：沙箱跟随会话归属的成员，规则是会话属性而非工具属性）。
//
// 为什么判据落在 `operations` 上而不是命令文本上：`operations.exec` 拿到的是整条命令字符串，
// 但这里**不看它**——沙箱把整棵子进程树关进内核的允许面里，命令里写什么、载荷藏在哪个文件、
// 用哪个解释器都不影响判定（ADR-0012 决策一）。
//
// env 收口（ADR-0013 决策三）落在同一个包装上，因为 RPC 面没有 spawnHook
// （`executeBashWithOperations` 只传 `{onData, signal}`、落 `env ?? getShellEnv()` 兜底），
// 唯一杠杆就是这一层：所以 `exec` **总是显式构造 env**，不做「上游给了就转交」。
//
// 自己做 spawn 而不是复用 pi 的 `createLocalBashOperations`：后者是包根导出的，但它把
// 「用哪个可执行文件 + 哪些前缀参数」硬编码在 `resolveShellConfig` 里，没有接缝可注入沙箱；
// 而 `BashOperations` 是 pi 自己文档化为「可替换执行后端」的接缝（`bash.d.ts`：
// "Override these to delegate command execution to remote systems"）。因此这里镜像 pi 的进程
// 监督语义（`dist/utils/shell.js` 的 killProcessTree、`dist/utils/child-process.js` 的
// waitForChildProcess 与它的 stdio 空闲宽限），逐条在下方注明出处，避免行为漂移。

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import { constants as osConstants } from "node:os";
import {
  createBashToolDefinition,
  getShellConfig,
  type BashOperations,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  bashBoundaryText,
  bashUnavailableMessage,
  explainBashFailure,
  gateBashSandbox,
  planBashSandbox,
  resolveBashSandbox,
  resolveWorksplicePorts,
  sandboxLaunch,
  stripWorkspliceEnv,
  type BashSandboxPlan,
  type BashSandboxResolution,
  type WorksplicePortResolution,
} from "./bash-containment.ts";
import type { PathGuardScope } from "./tool-path-guard.ts";

/** pi 自己的最大超时（`dist/core/tools/bash.js` 的 MAX_TIMEOUT_MS），逐字镜像以保住错误文本。 */
const MAX_TIMEOUT_MS = 2_147_483_647;
/** 归因用的输出采样上限：只认签名（`Operation not permitted` / `EPERM`），不需要整份输出。 */
const FAILURE_SIGNATURE_BYTES = 64 * 1024;
/** pi 的 `EXIT_STDIO_GRACE_MS`（`dist/utils/child-process.js`）：见 waitForChildProcess 的注释。 */
const EXIT_STDIO_GRACE_MS = 100;

export interface BashContainmentDeps {
  /** 平台（`process.platform` 同名取值），注入以便在集成测试里穷举 fail-closed 姿态。 */
  platform?: string;
  /** 进程自己的 TMPDIR。 */
  tmpdir?: string;
  /** **用户**家目录（工具链缓存挂在这里）。 */
  userHome?: string;
  /** 沙箱可执行文件的存在性探测（测试注入 fake）。 */
  fileExists?: (candidate: string) => boolean;
  /** pi 的 `settingsManager.getShellPath()`：沙箱里跑的仍是用户配置的 shell。 */
  shellPath?: string;
  /**
   * pi 的 `settingsManager.getShellCommandPrefix()`：工具面必须显式带上它——同名覆盖是整条定义
   * 替换，漏传这一项会让用户的 shell 前缀（如 `shopt -s expand_aliases`）在工具面静默失效。
   * RPC 面由 `executeBash` 自己应用同一项，两处各应用一次、不重复前缀。
   */
  commandPrefix?: string;
  /**
   * 本进程实际监听的 worksplice 端口（ADR-0013 决策五第 ③ 环）：由 `resolveWorksplicePorts`
   * 从 `process.env.PORT` 推导（Next 在 `listening` 里写真实绑定端口）。注入只为让集成测试
   * 穷举「推导不出」与「封另一个端口」两条分支；生产路径永远走推导——端口是每个实例的事实，
   * 人类可以 `-p` / `PORT=` 改它。
   */
  worksplicePorts?: WorksplicePortResolution;
}

/** 一次会话的沙箱装配：工具面与 RPC 面共用的那一份（决策三）。 */
export interface ContainedBash {
  scope: PathGuardScope;
  /** **有效**结论：两个前提（机制 + 端口推导）合取后的结果（`gateBashSandbox`）。 */
  resolution: BashSandboxResolution;
  /** 本进程实际监听、被封在沙箱外的 worksplice 端口。 */
  ports: WorksplicePortResolution;
  plan: BashSandboxPlan;
  /** 注册期就写进工具描述的边界文本（决策四：边界先于撞墙）。 */
  boundary: string;
  shellPath?: string;
  commandPrefix?: string;
  /** 两个 shell 面用的同一份 operations。 */
  operations: BashOperations;
}

/** 由该成员的判定域装配沙箱（决策一：入参是 `pathGuardScopeFor` 的产物，不新造目录解析）。 */
export function createContainedBash(scope: PathGuardScope, deps: BashContainmentDeps = {}): ContainedBash {
  const platform = deps.platform ?? process.platform;
  // 两个前提各自在本模块里算一次，合取在这里（ADR-0012 决策五 + ADR-0013 决策五第 ③ 环）：
  // 拿不到沙箱、或机制封不了单个端口、或推导不出本进程实际监听的端口 ⇒ 都不激活 bash。
  // 合成一个**有效 resolution** 后，下游三处（fail-closed 拒绝文本 / 工具描述 / 档位展示）不变。
  const ports = deps.worksplicePorts ?? resolveWorksplicePorts();
  const resolution = gateBashSandbox(
    resolveBashSandbox({
      platform,
      fileExists: deps.fileExists ?? ((candidate) => fs.existsSync(candidate)),
    }),
    ports,
  );
  const plan = planBashSandbox(scope, {
    platform,
    tmpdir: deps.tmpdir ?? os.tmpdir(),
    userHome: deps.userHome ?? os.homedir(),
    blockedPorts: ports.ports,
  });
  const operations: BashOperations = {
    exec: (command, cwd, options) => {
      const contained: ContainedBash = { scope, resolution, ports, plan, boundary, operations };
      return execInSandbox({ command, cwd, options, contained });
    },
  };
  const boundary = bashBoundaryText(scope, resolution, ports);
  return {
    scope,
    resolution,
    ports,
    plan,
    boundary,
    ...(deps.shellPath ? { shellPath: deps.shellPath } : {}),
    ...(deps.commandPrefix ? { commandPrefix: deps.commandPrefix } : {}),
    operations,
  };
}

/**
 * 一次沙箱内的命令执行。
 *
 * 三条纪律：
 * 1. **fail-closed**（决策五）：拿不到沙箱就拒绝执行，绝不落到裸本地实现；
 * 2. **always-env**：`env` 由本层构造（剥 `WORKSPLICE_*`），不把上游的 env 原样转交；
 * 3. **可读归因**（决策四）：EPERM / exit 134 在返回前被归因成带允许根的文本，注进输出流。
 */
async function execInSandbox(input: {
  command: string;
  cwd: string;
  options: Parameters<BashOperations["exec"]>[2];
  contained: ContainedBash;
}): Promise<{ exitCode: number | null }> {
  const { command, cwd, options, contained } = input;
  const { scope, resolution, plan, shellPath } = contained;
  const sandbox = resolution.sandbox;
  if (!resolution.available || !sandbox) {
    throw new Error(bashUnavailableMessage(resolution));
  }
  const { onData, signal, timeout, env } = options;
  if (signal?.aborted) throw new Error("aborted");
  const timeoutMs = resolveTimeoutMs(timeout);
  const shellConfig = getShellConfig(shellPath);
  try {
    await access(cwd, fs.constants.F_OK);
  } catch {
    throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
  }

  const launch = sandboxLaunch(sandbox, plan);
  const fromStdin = shellConfig.commandTransport === "stdin";
  const argv = [
    ...launch.args,
    shellConfig.shell,
    ...(fromStdin ? shellConfig.args : [...shellConfig.args, command]),
  ];
  const received: string[] = [];
  let receivedBytes = 0;
  const observe = (chunk: Buffer) => {
    if (receivedBytes < FAILURE_SIGNATURE_BYTES) {
      received.push(chunk.toString("utf-8"));
      receivedBytes += chunk.length;
    }
    onData(chunk);
  };

  const child = spawn(launch.command, argv, {
    cwd,
    // pi 同款：Unix 上自成进程组，超时/中止时能按组杀掉整棵树。
    detached: process.platform !== "win32",
    // 总是显式构造：上游没给（RPC 面）时以 process.env 为底，再按命名空间剥 WORKSPLICE_*。
    // pi 的 `getShellEnv()` 额外把 pi 自己的 bin 目录塞进 PATH；那一项没有公开导出，本包装
    // 不复刻——对成员 shell 的唯一影响是 `pi` 自身可能不在 PATH 上（已知差异，非安全面）。
    env: stripWorkspliceEnv(env ?? process.env),
    stdio: [fromStdin ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (fromStdin) {
    child.stdin?.on("error", () => {});
    child.stdin?.end(command);
  }

  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    if (child.pid) killProcessTree(child.pid);
  };
  try {
    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (child.pid) killProcessTree(child.pid);
      }, timeoutMs);
    }
    child.stdout?.on("data", observe);
    child.stderr?.on("data", observe);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const exitCode = await waitForChildProcess(child);
    if (signal?.aborted) throw new Error("aborted");
    if (timedOut) throw new Error(`timeout:${timeout}`);
    const resolved =
      exitCode ?? (child.signalCode ? 128 + (osConstants.signals[child.signalCode] ?? 0) : 1);
    const attribution = explainBashFailure({ exitCode: resolved, output: received.join("") }, scope, sandbox);
    if (attribution) onData(Buffer.from(`\n${attribution}\n`));
    return { exitCode: resolved };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/** pi 的 `resolveTimeoutMs` 同款（`dist/core/tools/bash.js`）：错误文本逐字镜像。 */
function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds");
  }
  const timeoutMs = timeout * 1000;
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_MS / 1000} seconds`);
  }
  return timeoutMs;
}

/**
 * pi 的 `killProcessTree` 同款（`dist/utils/shell.js`）：进程组 SIGKILL，组杀失败退回杀单进程。
 * Windows 的 taskkill 分支不复刻——Windows 没有沙箱，fail-closed 下永远走不到 spawn
 * （`execInSandbox` 在起进程之前就拒绝了）。
 */
function killProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 进程已经死了。
    }
  }
}

/**
 * pi 的 `waitForChildProcess` 同款（`dist/utils/child-process.js`）。
 *
 * 那条 stdio 空闲宽限是 pi#5303 的修复，不是随手写的：子进程 `exit` 之后，继承它 stdout/stderr
 * 的后代仍可能在写（例如 `nohup` 出去的东西），此时立刻 resolve 会 close 掉管道、把尾部输出
 * 静默截断。所以 `exit` 之后等管道静默（每次有新数据就重新计时），而不是等一个从 exit 起算的
 * 固定截止时间。
 */
function waitForChildProcess(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let postExitTimer: ReturnType<typeof setTimeout> | undefined;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;

    const cleanup = () => {
      if (postExitTimer) {
        clearTimeout(postExitTimer);
        postExitTimer = undefined;
      }
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("end", onStdoutEnd);
      child.stderr?.removeListener("end", onStderrEnd);
      child.stdout?.removeListener("data", onData);
      child.stderr?.removeListener("data", onData);
    };
    const finalize = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(code);
    };
    const maybeFinalizeAfterExit = () => {
      if (!exited || settled) return;
      if (stdoutEnded && stderrEnded) finalize(exitCode);
    };
    const armIdleTimer = () => {
      if (postExitTimer) clearTimeout(postExitTimer);
      postExitTimer = setTimeout(() => finalize(exitCode), EXIT_STDIO_GRACE_MS);
    };
    const onData = () => {
      if (exited && !settled) armIdleTimer();
    };
    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };
    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      exited = true;
      exitCode = code;
      maybeFinalizeAfterExit();
      if (!settled) armIdleTimer();
    };
    const onClose = (code: number | null) => {
      finalize(code);
    };

    child.stdout?.once("end", onStdoutEnd);
    child.stderr?.once("end", onStderrEnd);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}

/**
 * 注册同名 `bash` 覆盖定义（ADR-0011 决策四的形态，用在第二个工具上）：定义本体由 pi 的 factory
 * 生成，只在 `description` 上追加该成员的允许根（决策四：边界先于撞墙），其余字段逐字保留。
 *
 * **不设 `defaultActive: false`**——与六个文件工具刻意相反：bash 在 `PRESET_DEFAULT` 里是名义成员，
 * 覆盖定义必须照旧在会话启动时自动激活，否则成员的默认档位会悄悄少一个工具（档位构成不归本票改）。
 */
export function registerContainedBashTool(
  pi: ExtensionAPI,
  options: { cwd: string; contained: ContainedBash },
): void {
  const { contained } = options;
  const definition = createBashToolDefinition(options.cwd, {
    operations: contained.operations,
    ...(contained.commandPrefix ? { commandPrefix: contained.commandPrefix } : {}),
  });
  pi.registerTool({
    ...definition,
    description: `${definition.description}\n\n${contained.boundary}`,
  });
}

/** 内联扩展名；`builtin:` 前缀使它在诊断里读起来就是 worksplice 自己的东西。 */
export const BASH_CONTAINMENT_EXTENSION = "builtin:worksplice-bash-containment";

/** 经 `resourceLoaderOptions.extensionFactories` 注册的扩展工厂（与路径守卫同一条接缝）。 */
export function bashContainmentExtensionFactory(options: {
  cwd: string;
  contained: ContainedBash;
}): ExtensionFactory {
  return (pi) => registerContainedBashTool(pi, options);
}

/** `resourceLoaderOptions.extensionFactories` 的 `InlineExtension` 条目；hidden 不进扩展列表。 */
export function bashContainmentExtension(options: {
  cwd: string;
  contained: ContainedBash;
}): { name: string; factory: ExtensionFactory; hidden: boolean } {
  return {
    name: BASH_CONTAINMENT_EXTENSION,
    factory: bashContainmentExtensionFactory(options),
    hidden: true,
  };
}
