// 路径守卫（Path Guard）——判定一次文件工具调用是否落在该成员的**允许根**内。
//
// 领域词见 CONTEXT.md：允许根 = 成员自己的家目录 + 它显式绑定的项目目录（若有）；
// 路径守卫 = 只做准入判定，不做文件 IO 的任何替代实现（读、写、编辑、搜索、枚举、
// 截断、diff 渲染全部留给 pi 的 operations 默认实现）。
//
// 这个模块是**零 SDK 依赖**的：只有 node 的 fs/path 与类型导入。判定矩阵（根内 / 根外 /
// 前缀陷阱 / 符号链接 / 不存在的深层目标 / 根列表异常 fail-closed）因此可以被穷举测试。
//
// ADR-0011 决策一：根的构成复用 ADR-0001 的既有判定（lib/data/dirs.ts 的 agentHomeDir），
// 不新造第二套目录解析；成员行由调用方解析好传进来（本模块不经 lib/domain/collab 读成员）。
//
// ADR-0011 决策六（三条硬要求，逐条对应实现）：
//   1. realpath —— pi 的路径解析只归一化、不 realpath，所以根内指向根外的符号链接会通过
//      纯前缀判定。判定取「最深存在的祖先」做 realpath，再把不存在的尾段拼回去
//      （write 新建文件的常见形态）。
//   2. path.relative —— 不用 startsWith：否则根 /a/b 会让 /a/bc 通过。
//   3. fail-closed —— 判定自身出错（根列表为空/无法解析、路径不是绝对路径、realpath 异常）
//      一律拒绝，不降级放行。守卫出 bug 时的失效方向必须是「成员干不成活」，不是「成员读到不该读的」。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentHomeDir } from "./data/dirs.ts";
import type { MemberRow } from "./data/types.ts";

const { homedir } = os;

/**
 * 一次会话的判定域（ADR-0011 决策一：会话创建时算一次并随会话持有）。
 *
 * `dataDir` 是 ADR-0011 决策二那条显式不变式的载体：**数据目录树下永不可达**，
 * 唯一例外是 `homeDir` —— 成员自己的家目录恰在被排除的父目录下，作为一条**更窄的、
 * 单独的白名单条目**被显式开口。措辞上区分的正是这两件事：排除的是「数据目录这个根
 * 本身可整棵可达」，不是「这个根下不许有任何路径」。
 */
export interface PathGuardScope {
  /** 允许根：成员自己的家目录 + 显式绑定的项目目录（若有）。 */
  allowedRoots: readonly string[];
  /** 数据目录（`~/.worksplice`）：其树下永不作为可达范围，`homeDir` 除外。 */
  dataDir: string;
  /** 本成员自己的家目录（数据目录树下的更窄条目）。 */
  homeDir: string;
  /** 拒绝报错里署名的成员名（可缺省，缺省时清单不再署名）。 */
  memberName?: string;
}

export interface PathGuardDecision {
  allowed: boolean;
  /** 拒绝理由：含被拒的绝对路径与该成员当前的允许根清单（ADR-0011 决策五）。 */
  message?: string;
}

/**
 * 允许根的构成（ADR-0011 决策一）：`[ 成员自己的家目录, 显式绑定的项目目录（若有） ]`。
 *
 * 家目录取 `agentHomeDir`（ADR-0001 的派生规则）；`member.workspace_path` 由数据层读取侧
 * 按**当前**数据目录重推（家目录派生绑定不落库绝对路径），所以这里不需要再判一次
 * `isDerivedAgentHomePath`：重推后的值等于家目录时由去重收口。
 */
export function allowedRootsFor(member: MemberRow, dataDir: string): string[] {
  const homeDir = agentHomeDir(dataDir, member.id, member.name);
  const roots: string[] = [homeDir];
  const bound = member.workspace_path;
  if (bound && path.isAbsolute(bound) && !samePath(bound, homeDir)) {
    roots.push(bound);
  }
  return roots;
}

/** 会话级判定域：根的构成 + 数据目录不变式所需的两个锚点。 */
export function pathGuardScopeFor(member: MemberRow, dataDir: string): PathGuardScope {
  return {
    allowedRoots: allowedRootsFor(member, dataDir),
    dataDir,
    homeDir: agentHomeDir(dataDir, member.id, member.name),
    ...(member.name ? { memberName: member.name } : {}),
  };
}

/**
 * 判定一条绝对路径是否落在该成员的允许根内。
 *
 * 守卫拿到的路径已经是 pi 解析后的绝对路径（六个工具都在触碰 `ops.*` 之前解析），
 * 所以非绝对路径不是「合法的相对形态」，而是「判定对象不成立」——fail-closed 拒绝。
 * `~` 展开、`@` 前缀裁剪、macOS 文件名变体回退都发生在 pi 那一侧，守卫不吃这些结果。
 */
export function isWithinAllowedRoots(
  absolutePath: string,
  scope: PathGuardScope,
): PathGuardDecision {
  try {
    if (typeof absolutePath !== "string" || !path.isAbsolute(absolutePath)) {
      return deny(absolutePath, scope);
    }
    const roots = usableRoots(scope.allowedRoots);
    if (roots.length === 0) {
      // 根列表为空 = 该成员任何路径都不可达。这不是放行的理由（fail-closed）。
      return deny(absolutePath, scope);
    }
    const target = realpathDeepestExisting(absolutePath);
    if (!roots.some((root) => isInside(target, root))) {
      return deny(absolutePath, scope);
    }
    // 显式不变式（ADR-0011 决策二）：数据目录树下的路径永不可达，成员自己的家目录除外。
    // 之所以判在**目标**侧而不只过滤根列表，是因为根本身可以落在数据目录树外却把它包住
    // （例如显式绑定的项目目录是数据目录的父目录），也可能经符号链接解析到数据目录里。
    // `dataDir` 形态不对时无法证明这条不变式，同样 fail-closed。
    if (!isAbsolutePath(scope.dataDir)) {
      return deny(absolutePath, scope);
    }
    const dataRoot = realpathDeepestExisting(scope.dataDir);
    if (isInside(target, dataRoot)) {
      const ownHome = isAbsolutePath(scope.homeDir) ? realpathDeepestExisting(scope.homeDir) : null;
      if (!ownHome || !isInside(target, ownHome)) {
        return deny(absolutePath, scope);
      }
    }
    return { allowed: true };
  } catch {
    // realpath 抛错、根列表形态异常等：判定自身出错一律拒绝。
    return deny(absolutePath, scope);
  }
}

/** 判定并抛出（`ops.*` 的准入判定走这里；抛出的错误经 pi 变成 isError 工具结果）。 */
export function assertWithinAllowedRoots(absolutePath: string, scope: PathGuardScope): void {
  const verdict = isWithinAllowedRoots(absolutePath, scope);
  if (!verdict.allowed) throw new Error(verdict.message);
}

/**
 * 搜索根的准入判定（find / grep 的 `path` 参数）。
 *
 * 为什么这两个工具需要一层 ops 之外的判定（对 ADR-0011 决策四的事实修正）：
 * - `find` 只在提供了 `operations.glob` 时才走 ops 分支（pi 的 `find.js`: `if (customOps?.glob)`），
 *   否则走 `spawn(fd)` 遍历——判定一次都到不了；
 * - `grep` 的 `ops.isDirectory` 异常被 pi 自己的 catch 改写成 `Path not found`（`grep.js`），
 *   调用仍被拒、绝对路径也在，但**允许根清单**到不了模型。
 *
 * 这里拿到的还是模型给的原始字符串（绝对/相对/`~`/`@`/`file://`），所以要按 pi 的
 * `resolveToCwd` 同源形态解析一次再判：`~` 与 `file://` 用同一个 node 原语、开头的 `@` 与 pi 的
 * `stripAtPrefix` 同款裁掉、相对路径用同一个 `path.resolve(cwd, ...)` 语义。绝对形态的原文也会
 * 一并判一次（两者都在根内才放行），这样归一化差异不会变成「我只判了归一化后的那一侧」。
 */
export function assertSearchRootWithinAllowedRoots(
  rawSearchRoot: unknown,
  cwd: string,
  scope: PathGuardScope,
): void {
  const raw = typeof rawSearchRoot === "string" && rawSearchRoot.length > 0 ? rawSearchRoot : ".";
  let candidates: string[];
  try {
    candidates = path.isAbsolute(raw)
      ? [...new Set([resolvePathForGuard(raw, cwd), raw])]
      : [resolvePathForGuard(raw, cwd)];
  } catch {
    // 解析不出（畸形 file:// 等）：fail-closed 拒绝，与判定自身出错同款处置。
    throw new Error(pathGuardMessage(raw, scope));
  }
  for (const candidate of candidates) {
    assertWithinAllowedRoots(candidate, scope);
  }
}

/**
 * pi 的 `resolveToCwd` 的同源形态（只用做搜索根判定，不参与 ops 判定）：
 * `~` 展开（同一个 `os.homedir()`）、`file://` 转换（同一个 `fileURLToPath`）、
 * 相对路径按会话 cwd 解析（同一个 `path.resolve` 语义）。
 *
 * 不镜像的部分是「只改字形、不改包含关系」的归一步（unicode 空格、Windows shell 路径）——
 * 它们最多让同一目录下的文件名写法不同，不会把根内路径变成根外；绝对形态的原文另判一次后，
 * 连这层差异也不影响结论。
 */
export function resolvePathForGuard(rawPath: string, cwd: string): string {
  const expanded = stripAtPrefix(expandHome(rawPath));
  const fromUrl = expanded.startsWith("file://") ? fileURLToPath(expanded) : expanded;
  return path.isAbsolute(fromUrl) ? path.resolve(fromUrl) : path.resolve(cwd, fromUrl);
}

function expandHome(rawPath: string): string {
  if (rawPath === "~") return homedir();
  if (rawPath.startsWith("~/")) return path.join(homedir(), rawPath.slice(2));
  return rawPath;
}

/** pi 的 `stripAtPrefix`：开头的 `@` 要裁掉，否则 `@/etc/passwd` 会被当成 cwd 下的相对名。 */
function stripAtPrefix(rawPath: string): string {
  return rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
}

/**
 * 拒绝文本（ADR-0011 决策五）：说出哪个绝对路径被拒 + 该成员当前的允许根清单。
 *
 * 给出清单是为了让模型一次自我纠正，而不是反复换路径重试烧轮次（MUST_RESPOND_FAILURE_CAP = 2）。
 * 拒绝**不静默改写**路径、**不静默截断**内容——两者都会让模型拿到「看起来能用」的错误答案。
 */
export function pathGuardMessage(absolutePath: string, scope: PathGuardScope): string {
  const heading = scope.memberName
    ? `allowed roots for ${scope.memberName}:`
    : "allowed roots:";
  return [
    `path outside this agent's allowed roots: ${absolutePath}`,
    heading,
    ...scope.allowedRoots.map((root) => `  - ${root}`),
  ].join("\n");
}

function deny(absolutePath: string, scope: PathGuardScope): PathGuardDecision {
  return { allowed: false, message: pathGuardMessage(absolutePath, scope) };
}

function isAbsolutePath(candidate: unknown): candidate is string {
  return typeof candidate === "string" && candidate.length > 0 && path.isAbsolute(candidate);
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

/** 可用的根：非绝对路径条目无法判定，整条丢弃；全丢光时调用方按 fail-closed 拒绝。 */
function usableRoots(roots: readonly string[] | undefined): string[] {
  if (!Array.isArray(roots)) return [];
  return roots.filter(isAbsolutePath).map(realpathDeepestExisting);
}

/**
 * 取路径中**最深的存在的祖先**做 realpath，再把不存在的尾段按原样拼回。
 *
 * 目标不存在是 `write` 的常见形态（新建深层文件），此时父目录才是有意义的判定对象；
 * 父目录是符号链接时 realpath 会把解析结果暴露出来，越界因此拦得住。
 * `realpathSync.native` 与 pi 的 macOS 文件名变体回退（NFD / 花引号）对齐：两者都看
 * 文件系统里的真实名字。
 */
function realpathDeepestExisting(target: string): string {
  let current = path.resolve(target);
  const missing: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return missing.length > 0 ? path.join(real, ...missing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Cannot resolve path: ${target}`);
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** 包含判定用相对路径差：结果为空串、不以 `..` 开头、且不是绝对路径，才算落在根内。 */
function isInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
