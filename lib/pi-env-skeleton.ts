/**
 * pi 配置根的**初始化动作**（issue #226）：只补缺，不覆盖。
 *
 * 输入是目标目录（不是隐式读环境变量），写盘经注入的文件系统接口 —— 测试用临时目录，
 * 不需要动本机 `~/.pi/agent`。
 *
 * 四条硬约束（违反任何一条都会变成「配置事故」或「悄悄改用户的机器」）：
 *
 * 1. **已存在的文件逐字节不动**：只 `create` 不 `write` —— 写入用 `flag: "wx"`
 *    （独占创建），文件已存在时内核直接拒绝，没有读改写、没有合并、没有备份覆盖。
 * 2. **幂等**：连跑两次，第二次的改动清单为空。
 * 3. **只碰目标目录**：所有路径都由 agentDir 拼出；动作不读 `process.cwd()`。
 * 4. **不装 CLI、不改 PATH、不下载任何东西**：本模块没有任何 spawn / 网络调用点。
 *    bundled CLI 已随包存在（`bin: { pi: dist/bundle/cli.js }`），且在空目录里跑也不写配置，
 *    所以「装一个 CLI」既不解决问题，又会加深「PATH 上的 1.5.2 与内置版共享同一个目录」的歧义。
 *
 * 不迁移、不修复**已存在但内容损坏**的配置文件：那是另一件事（风险更高），
 * 本动作只判定「缺什么」并补齐。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PiAgentDirSkeletonKind = "file" | "directory";

export interface PiAgentDirSkeletonEntry {
  /** 相对 agentDir 的路径。 */
  path: string;
  kind: PiAgentDirSkeletonKind;
  /** 仅 `kind === "file"`：新建时的初始内容（最保守的空壳）。 */
  contents?: string;
}

/**
 * 骨架清单 = pi 在配置根里读写的那几样东西的空壳 + `sessions/`。
 *
 * 内容刻意最小：`settings.json` / `auth.json` 是 `{}`，`models.json` 是 `{"providers": {}}`
 * （与 `app/api/models-config/route.ts` 的空态读法同形）。刻意**不**写
 * `defaultProvider` / `defaultModel` —— 替用户选模型是越权。
 */
export const PI_AGENT_DIR_SKELETON: readonly PiAgentDirSkeletonEntry[] = [
  { path: "settings.json", kind: "file", contents: "{}\n" },
  { path: "models.json", kind: "file", contents: '{\n  "providers": {}\n}\n' },
  { path: "auth.json", kind: "file", contents: "{}\n" },
  { path: "sessions", kind: "directory" },
];

/** 注入式文件系统（唯一写盘面）。 */
export interface PiEnvSkeletonFileSystem {
  exists(path: string): boolean;
  /** 递归创建目录（已存在不算错）。 */
  makeDirectory(path: string): void;
  /** 独占创建文件：已存在必须拒绝，绝不覆盖。 */
  writeNewFile(path: string, contents: string): void;
}

export interface PiEnvSkeletonResult {
  agentDir: string;
  /** 本次**真正**创建的项（相对路径；目录带尾 `/`）。第二次执行必然为空。 */
  created: string[];
}

export const nodePiEnvSkeletonFileSystem: PiEnvSkeletonFileSystem = {
  exists: (path) => existsSync(path),
  makeDirectory: (path) => {
    mkdirSync(path, { recursive: true });
  },
  // `mode: 0o600` + `flag: "wx"`：auth.json 里会有凭证，且已存在的文件一个字节都不碰。
  writeNewFile: (path, contents) => {
    writeFileSync(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  },
};

function displayPath(entry: PiAgentDirSkeletonEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function wrapSkeletonError(error: unknown, agentDir: string): Error {
  const code = (error as NodeJS.ErrnoException).code;
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(
    `cannot initialise the pi agent dir at ${agentDir}: ${message}`,
    { cause: error },
  );
  if (code) (wrapped as NodeJS.ErrnoException).code = code;
  return wrapped;
}

/**
 * 干跑：列出此刻初始化动作会补的项（不写盘）。空数组 = 骨架已就绪。
 */
export function planPiAgentDirSkeleton(
  agentDir: string,
  fileSystem: PiEnvSkeletonFileSystem = nodePiEnvSkeletonFileSystem,
): string[] {
  return PI_AGENT_DIR_SKELETON.filter(
    (entry) => !fileSystem.exists(join(agentDir, entry.path)),
  ).map(displayPath);
}

/**
 * 补缺。返回本次真正创建的项（幂等：第二次为空）。
 *
 * 已存在的路径一律跳过（不区分它是文件还是目录 —— 用户的东西不归我们判断）。
 */
export function initializePiAgentDir(
  agentDir: string,
  fileSystem: PiEnvSkeletonFileSystem = nodePiEnvSkeletonFileSystem,
): PiEnvSkeletonResult {
  try {
    fileSystem.makeDirectory(agentDir);
  } catch (error) {
    throw wrapSkeletonError(error, agentDir);
  }

  const created: string[] = [];
  for (const entry of PI_AGENT_DIR_SKELETON) {
    const full = join(agentDir, entry.path);
    if (fileSystem.exists(full)) continue;
    try {
      if (entry.kind === "directory") fileSystem.makeDirectory(full);
      else fileSystem.writeNewFile(full, entry.contents ?? "");
    } catch (error) {
      // 与我们同时创建同一路径是唯一可以放过的失败：它的结果与我们要的一致。
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw wrapSkeletonError(error, agentDir);
    }
    created.push(displayPath(entry));
  }
  return { agentDir, created };
}
