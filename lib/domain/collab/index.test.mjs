import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Ticket 04 AC5 guard：`lib/domain/collab/index.ts` 是 协作域的**完整有效 mock seam**。
 *
 * - 每个子模块的每个 `import * as` 运行时导出，index 面都必须包含同名且**同一绑定**
 *   （`strictEqual` 指向同一函数/常量，证明 `export *` 汇合无歧义、整个 协作域可在一个 seam mock）。
 * - index.ts 源码须对每个子模块都有 `export * from "./<sub>.ts"`（类型导出在 TS-strip 下不产生
 *   运行时值，无法在运行时同绑定断言，故用源码行守卫补位——类型层面的汇合完整性由 `tsc` 保证）。
 * - AC7 守卫：`getDb()` 不在此面（归 `lib/data/db-singleton.ts`）。
 *
 * 说明：node:test 命名空间导入（`import * as`）在 .mjs + TS-strip 下可用；运行时命名空间只含
 * 值导出（函数/常量），接口/type alias 被擦除，故 `Object.keys(sub)` 只覆盖值导出，符合 seam 语义。
 */

// 全部 子模块（18 个，不含 index）——与 index.ts 底部 `export *` 清单一一对应。
const MODULES = [
  "attachments",
  "channels",
  "event-messages",
  "inbox",
  "members",
  "messages",
  "observability",
  "pinned",
  "reactions",
  "reads",
  "recurrence",
  "reminders",
  "rounds",
  "search",
  "secretary-auto-create",
  "secretary-init",
  "tasks",
  "wake",
];

const INDEX_SOURCE = await readFile(new URL("./index.ts", import.meta.url), "utf-8");

test("index seam covers exactly the 18 collab submodules via export *", () => {
  for (const sub of MODULES) {
    assert.ok(
      INDEX_SOURCE.includes(`export * from "./${sub}.ts";`),
      `index.ts 缺 ${sub} 的 export *（seam 不完整）`,
    );
  }
});

test("each submodule's runtime exports are re-exported by index with identical binding", async () => {
  const index = await import("./index.ts");
  // index 面不能为空（守护"全 undefined"的伪通过）
  assert.ok(Object.keys(index).length > 0, "index 面不应为空");

  for (const subName of MODULES) {
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
 * §1「协作域唯一导入面」守卫（#247 review 修复）：消费方一律 `from "@/lib/domain/collab"`，
 * **不按子路径逐个导入**子模块——子模块是内部实现，逐个子路径导入会把 seam 拆成 N 个可 mock
 * 的入口，测试与生产的依赖面各说各话。
 *
 * 扫描面 = `app/` / `components/` / `hooks/` / `lib/` 下的生产源码；排除协作域自身的
 * 子模块互引（它们必须用相对路径直引，不经索引回环）。
 */
test("consumers import the collab domain through the index seam only (no subpath imports)", async () => {
  const { readdir } = await import("node:fs/promises");
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
