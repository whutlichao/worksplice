// 路径守卫的 pi 侧装配：把准入判定包在 pi **自己造**的工具定义外面，经
// `resourceLoaderOptions.extensionFactories` 接缝注册同名定义覆盖内置实现（ADR-0011 决策四）。
//
// 同名覆盖是**整条定义替换**，不是字段级 merge：`_toolPromptSnippets` / `_toolPromptGuidelines`
// 从替换后的定义重新派生（pi 的 agent-session `_refreshToolRegistry`），所从六个定义一律由 pi 的
// factory 生成（`createReadToolDefinition(cwd, { operations })` 一类），手写会静默丢掉
// read 的 "Use read to examine files instead of cat or sed."、edit 的四条精确编辑准则与 diff 渲染。
//
// 守卫只做准入判定，不重写任何工具语义：pi 继续负责路径解析（`~` 展开、`@` 裁剪、macOS 文件名变体
// 回退）、读取、编辑的精确匹配、grep 的分片与截断、diff 渲染、mutation queue。ops 里那几行 fs 调用
// 与 pi 的默认实现同形（pi 没把它们做成公开导出），所以合法路径下行为逐字一致；判定规则本身完全
// 落在 lib/tool-path-guard.ts 里（本文件不写第二份规则）。

import fs from "node:fs";
import fsp from "node:fs/promises";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  type EditOperations,
  type ExtensionAPI,
  type ExtensionFactory,
  type GrepOperations,
  type LsOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { CODING_TOOL_NAMES } from "./tool-presets.ts";
import { assertSearchRootWithinAllowedRoots, assertWithinAllowedRoots, type PathGuardScope } from "./tool-path-guard.ts";

export interface GuardedFileOperations {
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
  grep: GrepOperations;
  ls: LsOperations;
}

/**
 * 工具名 → 「造定义并用 pi 自己造的定义注册」的闭包。这里只登记「有同名 factory 可覆盖」的工具：
 * 守卫覆盖的工具集合 = `CODING_TOOL_NAMES ∩ 本表的键`，**不另抄一份工具名单**
 * （ADR-0007 决策 5：同一事实不写两处）。`bash` 不在表内——它能执行任意 shell 命令，
 * 路径守卫对它无效，收口 bash 是另一张票的范围（ADR-0011 Consequences）。
 *
 * 每条闭包里 `registerTool` 拿到的都是**具体**定义类型；这一步不得不按工具分开写，因为
 * `registerTool` 的泛型参数在「六个不同 schema/details/render-state 的联合」上存在形参逆变
 * 冲突，而定义与自己的名字一一对应这个约束它的签名表达不了。
 */
const GUARDED_REGISTRARS: Record<
  string,
  (options: GuardedToolBuildOptions) => (pi: ExtensionAPI) => void
> = {
  read: ({ cwd, operations }) =>
    (pi) => pi.registerTool(presetSafeActivation(createReadToolDefinition(cwd, { operations: operations.read }))),
  write: ({ cwd, operations }) =>
    (pi) => pi.registerTool(presetSafeActivation(createWriteToolDefinition(cwd, { operations: operations.write }))),
  edit: ({ cwd, operations }) =>
    (pi) => pi.registerTool(presetSafeActivation(createEditToolDefinition(cwd, { operations: operations.edit }))),
  grep: ({ cwd, scope, operations }) => (pi) => {
    const definition = createGrepToolDefinition(cwd, { operations: operations.grep });
    const execute = definition.execute.bind(definition);
    const guarded: typeof definition = {
      ...definition,
      execute: async (toolCallId, input, signal, onUpdate, ctx) => {
        guardSearchRootCall(input, ctx?.cwd || cwd, scope);
        return execute(toolCallId, input, signal, onUpdate, ctx);
      },
    };
    pi.registerTool(presetSafeActivation(guarded));
  },
  find: ({ cwd, scope }) => (pi) => {
    // 不传 operations：pi 的 find 只在 `customOps?.glob` 为真时才用自定义 ops，否则一律走
    // `spawn(fd)` 的真实遍历（`find.js`）——传一个只有 `exists` 的 ops 等于给一个永远不会
    // 被调用的死参数（搜索根由上面那层定义级判定拉）。遍历语义全部是 pi 的。
    const definition = createFindToolDefinition(cwd);
    const execute = definition.execute.bind(definition);
    const guarded: typeof definition = {
      ...definition,
      execute: async (toolCallId, input, signal, onUpdate, ctx) => {
        guardSearchRootCall(input, ctx?.cwd || cwd, scope);
        return execute(toolCallId, input, signal, onUpdate, ctx);
      },
    };
    pi.registerTool(presetSafeActivation(guarded));
  },
  ls: ({ cwd, operations }) =>
    (pi) => pi.registerTool(presetSafeActivation(createLsToolDefinition(cwd, { operations: operations.ls }))),
};

interface GuardedToolBuildOptions {
  cwd: string;
  scope: PathGuardScope;
  operations: GuardedFileOperations;
}

/**
 * 搜索根的定义级准入判定（find / grep 专用）。
 *
 * 包装外形在两个工具的注册闭包里各写一遍（`execute` 必须 async，否则判定不过时会同步抛、
 * 而工具执行的调用方按 promise 契约接错误）：它们只有 `path?: string` 是共同的，schema /
 * details / render-state 类型各不相同，抽一个泛型包装器要么得申明 pi 未在包根导出的类型参数，
 * 要么引入一个类型系统验证不了的断言。两者共享的部分是**判定本身**（`guardSearchRootCall`），
 * 不共享的只有回调签名。
 *
 * 为什么这两个工具的搜索根需要一层 ops 之外的判定：pi 的 find 只在提供 `operations.glob` 时才走
 * ops 分支（`if (customOps?.glob)`），否则 `spawn(fd)` 遍历、ops 一次不碰；pi 的 grep 把自己的
 * `ops.isDirectory` 异常改写成 `Path not found`，调用仍被拒但丢掉允许根清单。所以这里补一次判定，
 * 用的还是同一份规则（`assertSearchRootWithinAllowedRoots` 内部调 `assertWithinAllowedRoots`）。
 *
 * 这里**不改写参数、不截断结果**：判定不过就报错，过了就把 pi 的原参数原样交给它自己的实现。
 * 其余四个工具的 ops 判定在触碰 fs 之前就已经生效，不需要这层。
 */
function guardSearchRootCall(input: { path?: string }, cwd: string, scope: PathGuardScope): void {
  assertSearchRootWithinAllowedRoots(input?.path, cwd, scope);
}

/**
 * `defaultActive: false`：同名覆盖的定位是「替代内置实现」，不是「新增一个默认激活的扩展工具」。
 * 否则 `reload` 的 `_buildRuntime({ includeAllExtensionTools: true })` 会把六个工具当成扩展工具
 * 自动激活，DEFAULT 档会悄悄长出 grep / find / ls——档位构成是票 03 的范围，这里不动。
 * 字段级补充，定义本体仍由 pi 的 factory 生成。
 */
function presetSafeActivation<T extends { defaultActive?: boolean }>(definition: T): T {
  return { ...definition, defaultActive: false };
}

/** 守卫覆盖的六个文件工具（read / write / edit / grep / find / ls），从唯一事实来源派生。 */
export const GUARDED_TOOL_NAMES: readonly string[] = CODING_TOOL_NAMES.filter(
  (name) => name in GUARDED_REGISTRARS,
);

/**
 * 把允许根判定包在五个工具的 `operations` 外面（read / write / edit / grep / ls；find 的 ops 不在
 * 默认路径上，见下）。这些工具在触碰 `ops.*` 之前已经把参数解析成绝对路径（read 的
 * `resolveReadPathAsync`、其余四个的 `resolveToCwd`），所以判定点与副作用点相邻，不存在
 * 「判过了但写到别处」的缝。
 *
 * `find.glob` 刻意**不提供**（也不传任何 find ops）：pi 的 find 在 `customOps?.glob` 存在时才用它，
 * 否则走 fd 的真实遍历（`find.js`），所以给 glob 等于自己重写一遍 glob 语义（含 gitignore 与 fd
 * 回退）——那是设计里明确不做的。find / grep 的搜索根另有一层定义级判定，见 `guardSearchRootCall`。
 */
export function guardFileOperations(scope: PathGuardScope): GuardedFileOperations {
  const admit = (absolutePath: string) => assertWithinAllowedRoots(absolutePath, scope);
  const guarded =
    <TArgs extends unknown[], TResult>(operation: (...args: TArgs) => TResult) =>
    async (...args: TArgs): Promise<Awaited<TResult>> => {
      admit(String(args[0]));
      const result = await operation(...args);
      return result;
    };

  const exists = guarded(async (absolutePath: string) => {
    try {
      await fsp.access(absolutePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  });

  return {
    read: {
      readFile: guarded((absolutePath: string) => fsp.readFile(absolutePath)),
      access: guarded((absolutePath: string) => fsp.access(absolutePath, fs.constants.R_OK)),
      detectImageMimeType: guarded((absolutePath: string) =>
        detectSupportedImageMimeTypeFromFile(absolutePath),
      ),
    },
    write: {
      writeFile: guarded((absolutePath: string, content: string) =>
        fsp.writeFile(absolutePath, content, "utf-8"),
      ),
      mkdir: guarded((dir: string) => fsp.mkdir(dir, { recursive: true }).then(() => {})),
    },
    edit: {
      readFile: guarded((absolutePath: string) => fsp.readFile(absolutePath)),
      writeFile: guarded((absolutePath: string, content: string) =>
        fsp.writeFile(absolutePath, content, "utf-8"),
      ),
      access: guarded((absolutePath: string) =>
        fsp.access(absolutePath, fs.constants.R_OK | fs.constants.W_OK),
      ),
    },
    grep: {
      isDirectory: guarded(async (absolutePath: string) => {
        const stats = await fsp.stat(absolutePath);
        return stats.isDirectory();
      }),
      readFile: guarded((absolutePath: string) => fsp.readFile(absolutePath, "utf-8")),
    },
    ls: {
      exists,
      stat: guarded((absolutePath: string) => fsp.stat(absolutePath)),
      readdir: guarded((absolutePath: string) => fsp.readdir(absolutePath)),
    },
  };
}

/**
 * 注册六个覆盖定义：每个名字取自己的闭包，工具名来自从唯一事实来源派生的 `GUARDED_TOOL_NAMES`。
 */
export function registerGuardedTools(
  pi: ExtensionAPI,
  options: { cwd: string; scope: PathGuardScope },
): void {
  const operations = guardFileOperations(options.scope);
  for (const name of GUARDED_TOOL_NAMES) {
    GUARDED_REGISTRARS[name]({ cwd: options.cwd, scope: options.scope, operations })(pi);
  }
}

/** 内联扩展名；`builtin:` 前缀使它在诊断里读起来就是 worksplice 自己的东西。 */
export const TOOL_PATH_GUARD_EXTENSION = "builtin:worksplice-tool-path-guard";

/**
 * 经 `resourceLoaderOptions.extensionFactories` 注册的扩展工厂（与
 * `forcedEmptySystemPromptExtension` 同一条接缝，ADR-0011 决策四）。
 *
 * 扩展在加载期对六个工具各注册一个同名定义，之后 `_refreshToolRegistry` 的同名覆盖规则
 * （custom tools 覆盖 base definitions）让注册表里的 `read` / `write` / ... 变成守卫版；
 * `lib/rpc/session.ts` 主流程零改动——工具名一个都没变。`reload()` 会重建整个注册表并
 * 重新执行内联工厂，所以守卫在会话重载后仍然在位。
 */
export function toolPathGuardExtensionFactory(options: {
  cwd: string;
  scope: PathGuardScope;
}): ExtensionFactory {
  return (pi) => registerGuardedTools(pi, options);
}

/** `resourceLoaderOptions.extensionFactories` 的 `InlineExtension` 条目；hidden 不进扩展列表。 */
export function toolPathGuardExtension(options: {
  cwd: string;
  scope: PathGuardScope;
}): { name: string; factory: ExtensionFactory; hidden: boolean } {
  return {
    name: TOOL_PATH_GUARD_EXTENSION,
    factory: toolPathGuardExtensionFactory(options),
    hidden: true,
  };
}
