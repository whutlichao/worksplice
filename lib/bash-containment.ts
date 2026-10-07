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
  /**
   * 这个机制**能不能按端口过滤网络面**（ADR-0013 决策五第 ③ 环依赖它）。
   *
   * macOS 的 SBPL 能：`(deny network* (remote ip "*:<port>"))` 只封那一个端口。
   * bwrap 不能：它对网络只有 `--share-net`（原样共享主机栈）与 `--unshare-net`（整个网络栈换掉）
   * 两档，没有「只封一个端口」的中间形态，而 `--unshare-net` 会连出网一起封死——
   * 成员要能 `npm install`、拉依赖、访问外部服务，出网不能封。所以 Linux 侧这一维是 `false`。
   */
  canFilterPort: boolean;
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
  /**
   * 要封的端口：**本进程实际监听的 worksplice 端口**（`resolveWorksplicePorts` 的产物）。
   * 空列表 ⇒ 网络面整体封死（见 `sandboxExecProfile`），不是「不封」。
   */
  blockedPorts?: readonly number[];
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
    return {
      available: true,
      sandbox: { kind: "sandbox-exec", command: SANDBOX_EXEC_PATH, canFilterPort: true },
    };
  }
  if (platform === "linux") {
    const command = BWRAP_CANDIDATES.find((candidate) => fileExists(candidate));
    if (!command) {
      return { available: false, reason: "bubblewrap (bwrap) is not installed" };
    }
    return { available: true, sandbox: { kind: "bwrap", command, canFilterPort: false } };
  }
  return { available: false, reason: `no OS-level sandbox on ${platform}` };
}

/** 本机适配（唯一读取 ambient 状态的地方；矩阵本身在 `resolveBashSandbox` 里穷举）。 */
export function detectBashSandbox(): BashSandboxResolution {
  return resolveBashSandbox({ platform: process.platform, fileExists: (candidate) => fs.existsSync(candidate) });
}

/** worksplice 自己监听的端口（ADR-0013 决策五第 ③ 环「成员 → 本端口关闭」的输入）。 */
export interface WorksplicePortResolution {
  /** 实际监听端口（升序去重）；空数组 = 推导不出，走 fail-closed 分支。 */
  ports: number[];
  /** `ports` 为空时给 fail-closed 文本用的一句话原因。 */
  reason?: string;
}

/**
 * 从服务进程推导 worksplice 自己监听的端口。
 *
 * **推导，不硬编码**：源是 `process.env.PORT`，而 `PORT` 由 Next 在 `listening` 事件里写成
 * **真实绑定**的那个端口（`next/dist/server/lib/start-server.js:296`；dev 下请求端口被占时
 * Next 自动改端口，写进去的也是改过的那个）。所以 `npm run dev`、`npx worksplice`、
 * `npx worksplice -p 4041`、`PORT=4041 npx worksplice`、以及四条 npm 脚本，全都跟着实例走。
 *
 * 仓库里读同一个变量的地方共三处，各有各的理由，**都不适合拿来当本函数的兜底**：
 * `bin/worksplice-options.js:25`（启动参数解析，持默认 `30142`——回退它等于把端口硬编码回来，
 * 正是本函数要避免的）、`instrumentation.ts` 的启动门（要轮询等待 Next 写入）、
 * `lib/access-gate.ts` 的准入闸（宽松解析，未知返回 `unknown` 让请求门兜着）。
 *
 * **为什么不能硬编码**：实测教训——某成员的速查里记的 base URL 是 `30141`，实际监听 `30142`，
 * 而 `30141`/`30143` 都没监听。端口是**每个实例**的事实，不是仓库的常量。
 *
 * **推导不出来就是推导不出来**（`ports: []` + 可读原因）：调用方据此 fail-closed（不激活 bash），
 * 本函数**不**退回「不封」——不封等于洞开着。
 */
export function resolveWorksplicePorts(env: NodeJS.ProcessEnv = process.env): WorksplicePortResolution {
  const raw = env.PORT;
  const port = parsePort(raw);
  return port === null
    ? {
        ports: [],
        reason:
          "worksplice's own HTTP port could not be determined from the server process " +
          "(Next writes the real bound port into PORT on `listening`), so there is no port to deny " +
          "and this member gets no shell — a shell without a port filter could still reach " +
          "worksplice's un-sandboxed HTTP surface",
      }
    : { ports: [port] };
}

/**
 * `PORT` → 端口号。**刻意比别处更严**：这是本模块第三份端口解析（另两份在
 * `bin/worksplice-options.js` 的启动参数与 `lib/access-gate.ts` 的准入闸），但它们的宽松语义不能搬来：
 * 启动参数解析错时 Next 自己会报错，准入闸错时还有请求门兜着，而这里错一次就是「封错端口」或
 * 「没封端口」——后者直接是洞开着。所以非整数、非 1..65535 一律 null，交给 fail-closed，不猜。
 */
function parsePort(raw: string | undefined): number | null {
  const trimmed = String(raw ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * 激活成员沙箱的**两个前提**（ADR-0012 决策五 ＋ ADR-0013 决策五第 ③ 环）：
 *   ① 拿得到 OS 级沙箱（票 05 的平台矩阵）；
 *   ② 该机制能按端口过滤，且**推导得出本进程实际监听的端口**。
 *
 * 任一不成立就返回 `available: false` + 可读原因，**而不是**降级成「不封端口的沙箱」——
 * 不封等于成员仍能走到 `POST /api/agent/[id]` 的未沙箱裸执行（ADR-0013 残留 #1）。
 * fail-closed 的后果沿用票 05 已有的那一条通路：不激活 bash + 同一句原因出现在拒绝文本、
 * 工具描述与档位展示三处（同一个函数算出来，下游三处不变）。
 *
 * 这也是「同一事实不写两处」的落点：端口推导与机制能力各在本模块里算一次，
 * 装配处（`lib/bash-containment-extension.ts`）只调这一个函数拿到有效结论。
 */
export function gateBashSandbox(
  resolution: BashSandboxResolution,
  ports: WorksplicePortResolution,
): BashSandboxResolution {
  if (!resolution.available || !resolution.sandbox) return resolution;
  if (!resolution.sandbox.canFilterPort) {
    return {
      available: false,
      reason:
        `${resolution.sandbox.kind} cannot deny a single port (it either shares the host network or ` +
        `replaces it wholesale), so a shell behind it could still reach worksplice's own HTTP surface; ` +
        `the port filter is required, so bash is not activated on this platform`,
    };
  }
  if (ports.ports.length === 0) return { available: false, reason: ports.reason };
  return resolution;
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
    profile: sandboxExecProfile({
      surfaces,
      dataDir: scope.dataDir,
      homeDir: scope.homeDir,
      blockedPorts: input.blockedPorts ?? [],
    }),
  };
}

/**
 * macOS 的 allow-only profile（SBPL）。
 *
 * 形状（顺序是契约，逐条有理由）：
 *   1. `(deny default)` —— 清单外一律不可达，这是 allow-only 与 deny-list 的分水岭；
 *   2. 进程面：`process*`（起子进程）、`mach-lookup` / `ipc-posix-shm`（运行时服务）、
 *      `sysctl-read`、`network*`（**出网照常**：成员要能 `npm install`、拉依赖、访问外部服务）。
 *   3. **按端口封 worksplice 自己**（ADR-0013 决策五第 ③ 环）：紧跟 `(allow network*)` 之后写
 *      `(deny network* (remote ip "*:<port>"))`——**只封这一个端口**，同机其它 loopback 服务不动、
 *      出网不动（`docs/agent-bash-containment-form.md:238` 实测形态；`localhost:*` 的写法会把
 *      出网一起封掉，本形态不使用）。成员于是连不上 app 端口，`POST /api/agent/[id]` 的
 *      `{"type":"bash"}`（未沙箱的裸执行、进门一律按 Owner）对成员关闭。
 *      `blockedPorts` 为空 ⇒ 写 `(deny network*)` **整体封死**而不是退回 allow：「推导不出端口就
 *      不封」等于把洞开着，而那正是 fail-closed 要避免的形态（那时 bash 本来就不激活，见 `gateBashSandbox`）。
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
  blockedPorts: readonly number[];
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
    ...networkRules(input.blockedPorts),
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
 * 网络面那两行（顺序即契约：先放开出网，再按端口收窄）。
 *
 * 有可封的端口 ⇒ `(allow network*)` + `(deny network* (remote ip "*:<p>")…)`：
 * 出网照常、同机其它 loopback 不动，只有 worksplice 自己的端口被内核拒绝。
 * 没有可封的端口 ⇒ 只写 `(deny network*)`：**整体封死**而不是退回放开。
 */
function networkRules(blockedPorts: readonly number[]): string[] {
  const ports = [...new Set(blockedPorts)].sort((a, b) => a - b);
  if (ports.length === 0) return ["(deny network*)"];
  const filters = ports.map((port) => `(remote ip "*:${port}")`).join(" ");
  return ["(allow network*)", `(deny network* ${filters})`];
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
 * 模型在动手之前就知道自己的允许根、封掉的 worksplice 端口与越界的失败形态；平台没有沙箱
 * （或机制封不了单个端口）时，同一段文本说明「bash 未激活」以及原因（决策五：不允许静默不一致）。
 *
 * `ports` **必填**（推导失败时传空数组的 resolution）：可选参数会允许调用方静默漏掉端口那一句，
 * 而那一句正是「边界先于撞墙」的一部分——漏传不报错，只让模型白撞几轮墙。
 */
export function bashBoundaryText(
  scope: PathGuardScope,
  resolution: BashSandboxResolution,
  ports: WorksplicePortResolution,
): string {
  const mechanism = resolution.sandbox
    ? `this shell runs inside an allow-only OS sandbox (${resolution.sandbox.kind})`
    : `bash is not activated on this platform: ${resolution.reason}`;
  const outcome = resolution.sandbox
    ? `Everything outside the paths below is unreachable: the kernel answers "Operation not permitted", ` +
      `and a process missing a required rule aborts with exit 134.`
    : `Every command is refused instead of being run unconfined; do not retry the tool expecting it to work.`;
  // 端口规则也进边界文本（决策四「边界先于撞墙」）：成员 curl app 端口会被内核拒绝，
  // 那条未沙箱的执行入口对它是关着的——与其让它一轮轮撞墙，不如注册期就说清。
  const portRule = ports.ports.length > 0
    ? `worksplice's own HTTP port (${ports.ports.join(", ")}) is unreachable from this shell too — the ` +
      `kernel refuses the connection, so reaching worksplice over HTTP is not a workaround for anything ` +
      `here; act through your reply actions instead.`
    : "";
  return [
    [`Sandbox: ${mechanism}. ${outcome}`, portRule].filter(Boolean).join(" "),
    boundaryListing(scope),
  ].filter(Boolean).join("\n");
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
