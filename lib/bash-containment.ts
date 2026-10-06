// 沙箱（Sandbox）——成员 shell 的判定层：判据落到**进程**而不是命令文本。
//
// 领域词见 CONTEXT.md：沙箱 = 成员 shell 落在操作系统层面的约束，进程只能碰到允许根
// （加上只读系统面与它自己的临时目录），清单外的任何路径都碰不到；与路径守卫**同源**，
// 用同一份允许根，区别只在判据的落点（ADR-0011 判一次文件调用，本模块判进程能 open 什么）。
//
// 这个模块是**纯的**（只有 node 的 fs/path 与类型导入，不碰 SDK、不起进程）：
//   - profile / bind 清单是数据，可以穷举断言「清单内逐条在册、清单外逐条不在册」；
//   - 平台矩阵由调用方注入 fileExists，所以在 macOS 上也能穷举 Windows / 无 bwrap 的形态。
// 真沙箱的执行在 lib/bash-containment-extension.test.mjs 的集成层。
//
// 四条被本层钉住的纪律（ADR-0012）：
//   决策一 —— 允许面由与路径守卫同一份判定派生（入参就是 pathGuardScopeFor 的产物），
//             不新造第二套目录解析（ADR-0007 决策 5）。
//   决策二 —— allow-only（清单内可达、其余一律不可达）＋ 用户级凭证不进清单。
//   决策四 —— 越界机制换成内核的 EPERM / exit 134，但这一层把它归因成可读文本，
//             并把该成员的允许根写进注册期的工具描述（边界先于撞墙）。
//   决策五 —— 平台 fail-closed：拿不到沙箱就没有 bash（这里只回答「拿不拿得到」）。

import fs from "node:fs";
import path from "node:path";
import type { PathGuardScope } from "./tool-path-guard.ts";

/** 沙箱机制：一个可执行文件 + 它给子命令加的前缀参数。 */
export interface BashSandbox {
  kind: "sandbox-exec" | "bwrap";
  command: string;
}

/**
 * 平台适配的结论（ADR-0012 决策五）。
 * `available: false` 时 `reason` 是给人看的原因，同时被三处复用：fail-closed 的拒绝文本、
 * 工具描述、档位展示的解释——三处说同一句话，避免「静默不一致」。
 */
export interface BashSandboxResolution {
  available: boolean;
  sandbox?: BashSandbox;
  reason?: string;
}

/**
 * 允许面清单（ADR-0012 决策二）：清单 = 成员允许根 + 系统只读面 + 进程自己的 TMPDIR +
 * 只读工具链缓存。分「只读目录 / 只读单文件 / 可写目录」三组，是因为写面必须是**更窄**的一组：
 * 系统面与缓存只读，只有允许根与 TMPDIR 可写。
 */
export interface BashSandboxSurfaces {
  readOnlyDirs: readonly string[];
  /** 只读单文件：`~/.gitconfig` 这类用户级**非凭证**配置（实测 `git --version` 都要读它）。 */
  readOnlyFiles: readonly string[];
  writableDirs: readonly string[];
}

/**
 * 一次会话的沙箱计划：两个平台的形态都由它派生（macOS 的 SBPL 文本、Linux 的 bind 清单），
 * 外加显式不变式所需的数据目录与成员家目录。计划由允许根算出一次，随会话持有。
 */
export interface BashSandboxPlan {
  profile: string;
  surfaces: BashSandboxSurfaces;
  dataDir: string;
  homeDir: string;
}

export interface BashSandboxPlanInput {
  /** 平台字符串（`process.platform` 的同名取值），注入以便穷举。 */
  platform: string;
  /** 进程自己的 TMPDIR（`os.tmpdir()`）：node 一类工具要能写它。 */
  tmpdir: string;
  /** **用户**家目录（`os.homedir()`）：工具链缓存挂在这里，成员自己的家目录在允许根里。 */
  userHome: string;
}

const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";
/** bwrap 的常见落点（发行版差异大，逐一探测；一个都没有就 fail-closed）。 */
const BWRAP_CANDIDATES: readonly string[] = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"];
const DEV_WRITE_LITERALS = ["/dev/null", "/dev/stdout", "/dev/stderr"];

/**
 * 平台矩阵（**本机未验证**的项照实标注）：
 * - macOS：`/usr/bin/sandbox-exec`（实测可用、deprecated、profile 漏规则时子进程 SIGABRT）；
 * - Linux：`bwrap`（**本机没有、未验证**——生成有实现、测试只断言形态，不声称覆盖）；
 * - Windows 及其余平台：无对应物 → fail-closed。
 */
export function resolveBashSandbox(input: {
  platform: string;
  fileExists: (candidate: string) => boolean;
}): BashSandboxResolution {
  const { platform, fileExists } = input;
  if (platform === "darwin") {
    if (!fileExists(SANDBOX_EXEC_PATH)) {
      return { available: false, reason: `macOS sandbox-exec not found at ${SANDBOX_EXEC_PATH}` };
    }
    return { available: true, sandbox: { kind: "sandbox-exec", command: SANDBOX_EXEC_PATH } };
  }
  if (platform === "linux") {
    const command = BWRAP_CANDIDATES.find((candidate) => fileExists(candidate));
    if (!command) {
      return { available: false, reason: "bubblewrap (bwrap) is not installed" };
    }
    return { available: true, sandbox: { kind: "bwrap", command } };
  }
  return { available: false, reason: `no OS-level sandbox on ${platform}` };
}

/** 本机适配（唯一读取 ambient 状态的地方；矩阵本身在 `resolveBashSandbox` 里穷举）。 */
export function detectBashSandbox(): BashSandboxResolution {
  return resolveBashSandbox({ platform: process.platform, fileExists: (candidate) => fs.existsSync(candidate) });
}

/**
 * 允许面清单（ADR-0012 决策二）。三类条目的来源分别是：
 * - 系统只读面：进程起得来（dyld、共享库、时区、`/etc`）所必需；
 * - 只读工具链缓存：`~/.bun` / `~/.npm` / `~/.npm-global` / `~/.cache` 一类
 *   （只读！成员装不了全局包、也写不了 npm 的 cacache——这是 allow-only 的已知代价）。
 *   `~/.local` **不收**：它不只是工具链（`~/.local/share/keyrings` 是 Linux 的密钥环落点），
 *   一并收进去会把「keychain 类不进清单」这条报价变成空话。
 * - 可写面：成员允许根 + 进程自己的 TMPDIR。
 *
 * **用户级凭证不进清单**：`~/.ssh`、`~/.config/gh`、`~/Library/Keychains` 等一律不在册
 * （ADR-0012 决策二：拿用户私钥/token 换 `git push` 权更坏；正解是每成员凭证落自己家目录，另票）。
 * 代价已知且响亮：成员 shell 不能 `git push` / `gh pr create`。
 */
export function bashSandboxSurfaces(
  scope: PathGuardScope,
  input: BashSandboxPlanInput,
): BashSandboxSurfaces {
  const systemReadOnly = input.platform === "linux"
    ? ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/lib32", "/etc", "/opt"]
    : ["/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/etc", "/dev",
      "/private/var/db", "/var/db", "/usr/local", "/opt/homebrew"];
  const toolchainCaches = [".bun", ".npm", ".npm-global", ".cache"]
    .map((entry) => path.join(input.userHome, entry));
  return {
    readOnlyDirs: [...systemReadOnly, ...toolchainCaches],
    // `~/.gitconfig` 在册的唯一理由：冒烟清单要求 `git --version` 能跑，而它启动时就要读它。
    // 它是用户级**非凭证**配置；凭证（`~/.ssh`、`~/.config/gh`、keychain）仍然不进清单。
    readOnlyFiles: [path.join(input.userHome, ".gitconfig")],
    writableDirs: [...scope.allowedRoots, input.tmpdir],
  };
}

/**
 * 由允许根派生一次会话的沙箱计划（ADR-0012 决策一：与路径守卫同一份判定）。
 * `scope` 就是 `pathGuardScopeFor(member, dataDir)` 的产物——本函数不解析任何目录，
 * 只把判定结果渲染成两个平台的形态。
 */
export function planBashSandbox(scope: PathGuardScope, input: BashSandboxPlanInput): BashSandboxPlan {
  const surfaces = bashSandboxSurfaces(scope, input);
  return {
    surfaces,
    dataDir: scope.dataDir,
    homeDir: scope.homeDir,
    profile: sandboxExecProfile({ surfaces, dataDir: scope.dataDir, homeDir: scope.homeDir }),
  };
}

/**
 * macOS 的 allow-only profile（SBPL）。
 *
 * 形状（顺序是契约，逐条有理由）：
 *   1. `(deny default)` —— 清单外一律不可达，这是 allow-only 与 deny-list 的分水岭；
 *   2. 进程面：`process*`（起子进程）、`mach-lookup` / `ipc-posix-shm`（运行时服务）、
 *      `sysctl-read`、`network*`（本形态**不封网络**：成员面封端口是 ADR-0013 决策五的后续票，
 *      本票只登记依赖，不做它；这里写 `network*` 是为了不在无声之中把网络一并关掉）。
 *   3. 读面：`(literal "/")` + 只读目录与允许根（写面是它的子集）+ 只读单文件；
 *   4. **数据目录显式不变式**：allow 之后 `(deny file-read* (subpath <dataDir>))`，
 *      再 `(allow file-read* (subpath <homeDir>))` 把成员自己家目录这条**更窄**的条目重新开口。
 *      SBPL 的语义是「更具体的规则胜出、同宽度时后写的胜出」，所以顺序即契约：
 *      成员若被绑定到包含数据目录的项目目录（人类可以这么绑），数据目录仍然不可达，
 *      而他自己的家目录照常可达——与路径守卫的同一条不变式。
 *   5. 写面同理（只允许根与 TMPDIR），数据目录再 deny 一次、家目录再 reopen 一次。
 *   6. `file-read-metadata` 只开在**清单路径的祖先**上：realpath 一类操作要逐级 stat 祖先
 *      （`lstat "/Users"` 被拒时 node 直接 EPERM），但不放宽成「全树可 stat」。
 *
 * 路径一律按「用户写法 + realpath」两形在册：`/tmp` 与 `/private/tmp`、`/var` 与
 * `/private/var` 这类分叉在 macOS 上是常态，只写一形会在另一形上误拦。
 */
export function sandboxExecProfile(input: {
  surfaces: BashSandboxSurfaces;
  dataDir: string;
  homeDir: string;
}): string {
  const readDirs = expandForms([...input.surfaces.readOnlyDirs, ...input.surfaces.writableDirs]);
  const readFiles = expandForms(input.surfaces.readOnlyFiles);
  const writeDirs = expandForms(input.surfaces.writableDirs);
  const metadataDirs = expandForms([
    ...readDirs.flatMap(ancestorsOf),
    ...expandForms([input.dataDir, input.homeDir]).flatMap(ancestorsOf),
  ]);
  const subpaths = (entries: readonly string[]) => entries.map((entry) => `(subpath "${entry}")`).join(" ");
  const literals = (entries: readonly string[]) => entries.map((entry) => `(literal "${entry}")`).join(" ");

  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow signal (target self))",
    "(allow network*)",
    `(allow file-read* (literal "/") ${subpaths(readDirs)} ${literals(readFiles)})`,
    `(deny file-read* ${subpaths(expandForms([input.dataDir]))})`,
    `(allow file-read* ${subpaths(expandForms([input.homeDir]))})`,
    `(allow file-read-metadata (literal "/") ${subpaths(metadataDirs)})`,
    `(allow file-write* ${literals(DEV_WRITE_LITERALS)} ${subpaths(writeDirs)})`,
    `(deny file-write* ${subpaths(expandForms([input.dataDir]))})`,
    `(allow file-write* ${subpaths(expandForms([input.homeDir]))})`,
  ].join("\n") + "\n";
}

/**
 * 沙箱给子命令加的前缀参数。
 *
 * - macOS：`sandbox-exec -p <profile>`，其后跟真正的 shell 与命令。
 * - Linux：`bwrap` 的 bind 清单。**本机没有 bwrap、未验证**——这里生成的是形态，
 *   不是已覆盖的平台（Ticket 05 的 Answer 与集成层测试都照实标注）。语义与 SBPL 同源：
 *   先 `--unshare-all` 构造一个空的新命名空间（allow-only 由构造保证，不需要 deny 规则），
 *   再逐个 `--ro-bind-try`/`--bind-try` 把清单挂进去（`-try`：清单里有不存在的路径
 *   （如未安装的 `~/.bun`）时 bwrap 容忍缺失、而不是每条命令都启动失败）；
 *   数据目录用空 `--tmpfs` 遮罩，最后把成员自己家目录 bind 回来——与 SBPL 的
 *   「deny 之后 reopen」同一条不变式，`--tmpfs` 的落点必须在允许根之后。
 */
export function sandboxLaunch(sandbox: BashSandbox, plan: BashSandboxPlan): { command: string; args: string[] } {
  if (sandbox.kind === "sandbox-exec") {
    return { command: sandbox.command, args: ["-p", plan.profile] };
  }
  const args = ["--die-with-parent", "--unshare-all", "--share-net", "--proc", "/proc", "--dev", "/dev"];
  for (const dir of expandForms(plan.surfaces.readOnlyDirs)) {
    args.push("--ro-bind-try", dir, dir);
  }
  for (const dir of expandForms(plan.surfaces.writableDirs)) {
    args.push("--bind-try", dir, dir);
  }
  for (const dir of expandForms([plan.dataDir])) {
    args.push("--tmpfs", dir);
  }
  for (const dir of expandForms([plan.homeDir])) {
    args.push("--bind-try", dir, dir);
  }
  return { command: sandbox.command, args };
}

/**
 * env 收口（ADR-0013 决策三）：命名空间一刀切剥 `WORKSPLICE_*`。
 *
 * **不带成员判定分支**——写成 `if (是成员会话) 剥` 的话，任何一条归属信息缺失的路径就是泄漏路径，
 * 而「归属缺失」正是要处理的失效形态。
 *
 * pi 故意暴露的五项（`PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` /
 * `PI_REASONING_LEVEL`）不在这个命名空间里，因此天然保留——pi 的 bash 工具 guideline 明确
 * 告诉模型可以读它们。只有 `WORKSPLICE_PASSWORD` 是真秘密；其余 `WORKSPLICE_*` 并非机密，
 * 按命名空间一刀切只是省心。
 */
export function stripWorkspliceEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // 展开一份拷贝再按命名空间删键（不碰调用方的对象：`process.env` 是全局单例）。
  // 这里的 `as` 是类型层的事实陈述，不是运行期的放宽：Next 的类型增强把 `NODE_ENV` 声明成必填
  // （构建期事实），而环境变量表在运行期就是「键 → 值（可缺省）」。
  const stripped = { ...env } as NodeJS.ProcessEnv;
  for (const key of Object.keys(stripped)) {
    // 大小写不敏感：Windows 的环境变量名不区分大小写，命名空间一刀切要覆盖这种写法。
    if (key.toUpperCase().startsWith("WORKSPLICE_")) delete stripped[key];
  }
  return stripped;
}

/**
 * 越界失败的可读化（ADR-0012 决策四：机制替换，意图不变）。
 *
 * 两种失效形态要认出来：
 * - `exit 134`（SIGABRT、无 stderr）——sandbox-exec 漏关键规则时子进程的失败签名，
 *   最容易被模型读成「命令本身有 bug」；
 * - 输出里的 `Operation not permitted` / `EPERM`——内核拒绝，不是文件权限问题。
 *
 * 归因文本给出该成员的允许根，与路径守卫的 D7 意图一致：让调用方知道边界、一次自我纠正，
 * 而不是对着 `Operation not permitted` 反复换路径烧轮次（`MUST_RESPOND_FAILURE_CAP = 2`）。
 * 普通失败（非零退出但不是这两类）返回 null——不冒充沙箱、不静默改写任何东西。
 */
export function explainBashFailure(
  input: { exitCode: number; output: string },
  scope: PathGuardScope,
  sandbox?: BashSandbox,
): string | null {
  const aborted = input.exitCode === 134;
  const denied = input.exitCode !== 0 && /operation not permitted|EPERM/i.test(input.output);
  if (!aborted && !denied) return null;
  const mechanism = sandbox?.kind ?? "the OS sandbox";
  const signature = aborted
    ? `exit 134 (SIGABRT) with no output is what a child process does when the sandbox profile misses ` +
      `a rule it needs — the command did not run outside the sandbox`
    : `the kernel denied a path: the "Operation not permitted" / EPERM above comes from the sandbox, ` +
      `not from file permissions`;
  return [
    `[worksplice sandbox: ${mechanism}] ${signature}`,
    boundaryListing(scope),
    `Outside that list nothing is reachable from this shell (worksplice's data directory, other members' ` +
      `homes, and your user's credentials included). Retrying with another path spelling, another ` +
      `interpreter, or another variable fails the same way.`,
  ].join("\n");
}

/**
 * 工具面与 RPC 面共用的沙箱状态（展示层用）：由平台适配结论直接派生。
 * `available: false` 时 `reason` 说出「本平台拿不到沙箱」——它同时出现在工具描述与拒绝文本里
 * （同一事实的两处呈现），不允许两处各说各的（ADR-0012 决策五）。
 */
export interface BashContainmentStatus {
  available: boolean;
  mechanism: "sandbox-exec" | "bwrap" | null;
  reason: string | null;
}

export function containmentStatus(resolution: BashSandboxResolution): BashContainmentStatus {
  return {
    available: resolution.available,
    mechanism: resolution.sandbox?.kind ?? null,
    reason: resolution.reason ?? null,
  };
}

/**
 * 注册期就带在工具描述里的边界（ADR-0012 决策四「边界先于撞墙」）：
 * 模型在动手之前就知道自己的允许根与越界的失败形态；平台没有沙箱时，同一段文本说明
 * 「bash 未激活」以及原因（决策五：不允许静默不一致）。
 */
export function bashBoundaryText(scope: PathGuardScope, resolution: BashSandboxResolution): string {
  const mechanism = resolution.sandbox
    ? `this shell runs inside an allow-only OS sandbox (${resolution.sandbox.kind})`
    : `bash is not activated on this platform: ${resolution.reason}`;
  const outcome = resolution.sandbox
    ? `Everything outside the paths below is unreachable: the kernel answers "Operation not permitted", ` +
      `and a process missing a required rule aborts with exit 134.`
    : `Every command is refused instead of being run unconfined; do not retry the tool expecting it to work.`;
  return [`Sandbox: ${mechanism}. ${outcome}`, boundaryListing(scope)].join("\n");
}

/** fail-closed 的拒绝文本：拿不到沙箱就不激活 bash（决策五）。可用时返回空串。 */
export function bashUnavailableMessage(resolution: BashSandboxResolution): string {
  if (resolution.available) return "";
  return [
    `bash is not activated: ${resolution.reason}`,
    `worksplice refuses to run shell commands without an OS-level sandbox (macOS: sandbox-exec, ` +
      `Linux: bwrap), so this member has no shell on this platform.`,
  ].join(" ");
}

function boundaryListing(scope: PathGuardScope): string {
  const heading = scope.memberName ? `allowed roots for ${scope.memberName}:` : "allowed roots:";
  return [heading, ...scope.allowedRoots.map((root) => `  - ${root}`)].join("\n");
}

/**
 * 路径的两形（用户写法 + realpath）展开，去重后排序（profile 文本因此是确定性的）。
 *
 * realpath 解析不到（路径还不存在、形态异常）时只保留原形——判定层已有的 fail-closed
 * 不在这里重复：清单少一条的代价是「成员的活干不成」，不是「成员读到不该读的」。
 */
function expandForms(paths: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const candidate of paths) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    forms.add(normalizeRoot(candidate));
    try {
      forms.add(normalizeRoot(fs.realpathSync.native(candidate)));
    } catch {
      // 解析不到就只留原形。
    }
  }
  return [...forms].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 祖先链（不含自身，含 `/`）：`file-read-metadata` 要逐级 stat 才能 realpath。 */
function ancestorsOf(target: string): string[] {
  const ancestors: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

function normalizeRoot(candidate: string): string {
  const normalized = path.normalize(candidate);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}
