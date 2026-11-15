import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

/**
 * Ticket 04 AC5 guard：`lib/domain/collab/index.ts` 是 协作域的**完整有效 mock seam**。
 *
 * - 子模块全集**动态发现**（目录里的 `*.ts`，排除 `*.test.*` 与 `index.ts`），不再手抄清单：
 *   手抄的清单会在新增模块时静默过时——新模块不加防护，正是本守卫要防的漂移。
 * - 每个子模块的每个 `import * as` 运行时导出，index 面都必须包含同名且**同一绑定**
 *   （`strictEqual` 指向同一函数/常量，证明 `export *` 汇合无歧义、整个 协作域可在一个 seam mock）。
 * - index.ts 源码须对每个子模块都有 `export * from "./<sub>.ts"`，且只对这些子模块有——两个方向
 *   都断言（目录多一个 / 清单多一个都红）。类型导出在 TS-strip 下不产生运行时值，无法在运行时
 *   同绑定断言，故用源码行守卫补位——类型层面的汇合完整性由 `tsc` 保证。
 * - AC7 守卫：`getDb()` 不在此面（归 `lib/data/db-singleton.ts`）。
 *
 * 说明：node:test 命名空间导入（`import * as`）在 .mjs + TS-strip 下可用；运行时命名空间只含
 * 值导出（函数/常量），接口/type alias 被擦除，故 `Object.keys(sub)` 只覆盖值导出，符合 seam 语义。
 */

const SUBMODULE_DIR = new URL("./", import.meta.url);
const INDEX_SOURCE = await readFile(new URL("./index.ts", import.meta.url), "utf-8");

/**
 * 子模块全集的**下限**：防止「目录读空了测试照样绿」（读目录的守卫最大的失败模式是静默退化成空转）。
 * 这是一个下限而非精确值——新增子模块不必回到本文件改数字，那正是动态发现要消除的维护点。
 */
const MIN_SUBMODULES = 27;

/**
 * 子模块全集 = 目录里的 `*.ts`，排除 `index.ts` 自身与测试文件。
 * 传入目录参数是为了能用一次性临时目录取证「发现确实在读目录」（见下方反例用例）。
 */
async function discoverSubmodules(dir = SUBMODULE_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.includes(".test."))
    .filter((name) => name !== "index.ts")
    .map((name) => name.slice(0, -".ts".length))
    .sort();
}

/** `index.ts` 源码里的 `export * from "./<sub>.ts";` 清单（唯一可解析的汇合事实）。 */
function exportedSubmodules(source) {
  return [...source.matchAll(/export \* from "\.\/([\w.-]+)\.ts";/g)]
    .map((match) => match[1])
    .sort();
}

/**
 * 双向比对（纯函数）：两个方向各自列出漂移项。
 * 抽成纯函数是为了用**假输入**取证两个方向都红——不必为了证明守卫有效去临时改 `index.ts`。
 */
function compareSubmoduleSets(discovered, exported) {
  const discoveredSet = new Set(discovered);
  const exportedSet = new Set(exported);
  return {
    /** 目录里有、index 面没有（新模块忘了汇合） */
    missingFromIndex: discovered.filter((name) => !exportedSet.has(name)),
    /** index 面有、目录里没有（模块删了/改名了，export 行成了悬挂引用） */
    missingFromDirectory: exported.filter((name) => !discoveredSet.has(name)),
  };
}

const isConsistent = (diff) =>
  diff.missingFromIndex.length === 0 && diff.missingFromDirectory.length === 0;

const DISCOVERED = await discoverSubmodules();
const EXPORTED = exportedSubmodules(INDEX_SOURCE);

// ---------------------------------------------------------------------------
// seam 完整性：动态发现 + 双向比对
// ---------------------------------------------------------------------------

test("submodule discovery is not empty (a guard that reads nothing would pass silently)", () => {
  assert.ok(
    DISCOVERED.length >= MIN_SUBMODULES,
    `只发现 ${DISCOVERED.length} 个协作域子模块（下限 ${MIN_SUBMODULES}）——目录读取退化或过滤写错了`,
  );
  assert.ok(EXPORTED.length > 0, "index.ts 里没有解析到任何 export * ——解析式写错了");
});

test("discovered submodules and index.ts `export *` list agree in both directions", () => {
  const diff = compareSubmoduleSets(DISCOVERED, EXPORTED);
  assert.deepEqual(
    diff.missingFromIndex,
    [],
    `这些子模块在目录里但 index.ts 没有 export *（seam 不完整）：${diff.missingFromIndex.join(", ")}`,
  );
  assert.deepEqual(
    diff.missingFromDirectory,
    [],
    `index.ts 对不存在的子模块写了 export *（悬挂引用）：${diff.missingFromDirectory.join(", ")}`,
  );
});

test("双向比对对两个方向的漂移都会判红（用假输入取证，不改 index.ts）", () => {
  assert.equal(isConsistent(compareSubmoduleSets(DISCOVERED, EXPORTED)), true);

  // 方向 1：目录多一个（新模块没加 export *）
  const extraInDirectory = compareSubmoduleSets([...DISCOVERED, "brand-new-module"], EXPORTED);
  assert.deepEqual(extraInDirectory.missingFromIndex, ["brand-new-module"]);
  assert.deepEqual(extraInDirectory.missingFromDirectory, []);
  assert.equal(isConsistent(extraInDirectory), false, "目录多一个必须判红");

  // 方向 2：清单多一个（模块被删/改名，export 行悬挂）
  const extraInIndex = compareSubmoduleSets(DISCOVERED, [...EXPORTED, "removed-module"]);
  assert.deepEqual(extraInIndex.missingFromIndex, []);
  assert.deepEqual(extraInIndex.missingFromDirectory, ["removed-module"]);
  assert.equal(isConsistent(extraInIndex), false, "清单多一个必须判红");
});

test("discovery really reads a directory (one-off temp dir, filter semantics)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "worksplice-seam-discovery-"));
  try {
    for (const name of ["alpha.ts", "beta.ts", "beta.test.mjs", "index.ts", "gamma.mjs"]) {
      await writeFile(path.join(dir, `${name}`), "", "utf-8");
    }
    const found = await discoverSubmodules(pathToFileURL(`${dir}/`));
    // `.test.*` / `index.ts` / 非 `.ts` 都不算子模块
    assert.deepEqual(found, ["alpha", "beta"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("each submodule's runtime exports are re-exported by index with identical binding", async () => {
  const index = await import("./index.ts");
  // index 面不能为空（守护"全 undefined"的伪通过）
  assert.ok(Object.keys(index).length > 0, "index 面不应为空");

  for (const subName of DISCOVERED) {
    const sub = await import(`./${subName}.ts`);
    const subKeys = Object.keys(sub);

    // 每个子模块都应有至少一个运行时导出（函数/常量），否则本断言无法证明 seam 完整性
    assert.ok(
      subKeys.length > 0,
      `${subName} 无任何运行时导出，seam 断言退化为空转（tsc 已保证类型面）`,
    );

    for (const name of subKeys) {
      assert.ok(
        name in index,
        `index 面缺少子模块 ${subName} 的导出「${name}」——seam 不完整`,
      );
      // 同一绑定：如果 index 是 `export *` 直通，两者指向同一个函数/常量对象
      assert.strictEqual(
        index[name],
        sub[name],
        `index 面的「${name}」（来自 ${subName}）与子模块非同绑定——疑似同名歧义汇合`,
      );
    }
  }
});

test("getDb is NOT exposed on the index seam (belongs to lib/data/db-singleton.ts)", async () => {
  const index = await import("./index.ts");
  assert.equal("getDb" in index, false, "getDb 不应出现在 collab index 面");
});

/**
 * 动态发现补上来的**真缺口**（票 collab-debt-sweep）：`task-reference` 原来不在 index 面。
 *
 * 这条用例把发现钉成事后可读的事实（而不是只靠上面那个通式循环）：`handoff-trigger` 已经
 * re-export 了 `parseTaskReferenceNumbers`，所以它「本来就绿」；真正新覆盖到的是
 * `hasTaskReference`。两个都要同一绑定，且两条路径同源。
 */
test("task-reference 的两个导出都在 seam 上且同一绑定（re-export 不会掩盖新覆盖的那一个）", async () => {
  const index = await import("./index.ts");
  const taskReference = await import("./task-reference.ts");
  const handoffTrigger = await import("./handoff-trigger.ts");

  assert.deepEqual(Object.keys(taskReference).sort(), ["hasTaskReference", "parseTaskReferenceNumbers"]);
  for (const name of Object.keys(taskReference)) {
    assert.ok(name in index, `index 面缺少 task-reference 的导出「${name}」`);
    assert.strictEqual(index[name], taskReference[name], `「${name}」在 index 面必须与 task-reference 同一绑定`);
  }
  // 两条路径同源：handoff-trigger 只是把同一个函数再导出一次，不是第二份实现。
  assert.strictEqual(
    handoffTrigger.parseTaskReferenceNumbers,
    taskReference.parseTaskReferenceNumbers,
    "handoff-trigger 的 re-export 必须指向 task-reference 的同一个函数",
  );
});

/**
 * §1「协作域唯一导入面」守卫（#247 review 修复）：消费方一律 `from "@/lib/domain/collab"`，
 * **不按子路径逐个导入**子模块——子模块是内部实现，逐个子路径导入会把 seam 拆成 N 个可 mock
 * 的入口，测试与生产的依赖面各说各话。
 *
 * 扫描面 = `app/` / `components/` / `hooks/` / `lib/` 下的生产源码；排除协作域自身的
 * 子模块互引（它们必须用相对路径直引，不经索引回环）。
 */
test("consumers import the collab domain through the index seam only (no subpath imports)", async () => {
  const repoRoot = new URL("../../../", import.meta.url);
  const SELF_DIR = new URL("./", import.meta.url);
  const violations = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        if (child.href === SELF_DIR.href) continue;
        await walk(child);
        continue;
      }
      if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
      const source = await readFile(child, "utf-8");
      if (/from\s+"@\/lib\/domain\/collab\/[^"]+"/.test(source)) {
        violations.push(child.pathname.replace(repoRoot.pathname, ""));
      }
    }
  }

  for (const dirName of ["app/", "components/", "hooks/", "lib/"]) {
    await walk(new URL(dirName, repoRoot));
  }

  assert.deepEqual(
    violations,
    [],
    `这些文件按子路径导入了协作域（改为 from "@/lib/domain/collab"）：${violations.join(", ")}`,
  );
});
