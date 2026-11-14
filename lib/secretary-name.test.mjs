import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * 引导期默认秘书名字的**唯一来源**（评审 finding：字面量 `"Susan"` 曾有三份）。
 *
 * 接缝 = 三个既有导出（数据层迁移常量 / 协作服务层身份名 / UI 侧启动助手判定）都指向同一
 * 常量，且字面值只写在那个零依赖模块里——名字不进任何身份判定（秘书 = 全局首席，见
 * `secretary-identity.ts`），但仍必须一处修改、处处一致。
 */

const names = await import("./secretary-name.ts");
const { LEGACY_CHIEF_MEMBER_NAME } = await import("./data/schema.ts");
const { SUSAN_MEMBER_NAME } = await import("./domain/collab/secretary-identity.ts");
const { SUSAN_NAME } = await import("./secretary-bootstrap.ts");

test("既有三个导出都指向模块里的唯一常量（数据层 / 协作域 / UI 侧）", () => {
  assert.equal(typeof names.SECRETARY_DEFAULT_NAME, "string");
  assert.ok(names.SECRETARY_DEFAULT_NAME.length > 0);
  assert.equal(LEGACY_CHIEF_MEMBER_NAME, names.SECRETARY_DEFAULT_NAME);
  assert.equal(SUSAN_MEMBER_NAME, names.SECRETARY_DEFAULT_NAME);
  assert.equal(SUSAN_NAME, names.SECRETARY_DEFAULT_NAME);
});

test("字面值只写在唯一来源里：三个消费方都不再自带一份", async () => {
  for (const file of [
    "./data/schema.ts",
    "./domain/collab/secretary-identity.ts",
    "./secretary-bootstrap.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf-8");
    assert.doesNotMatch(
      source,
      /"\s*Susan\s*"/,
      `${file} 不得再写一份名字字面值（改为引用 lib/secretary-name.ts）`,
    );
  }
});

test("唯一来源是零依赖模块（client-safe：UI 侧导入不拖服务端依赖）", async () => {
  const source = await readFile(new URL("./secretary-name.ts", import.meta.url), "utf-8");
  // 只看代码，不看注释（注释里正解释着「为什么不能引」）
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(code, /^\s*import\s/m, "不得有任何 import（含 type）");
  assert.doesNotMatch(code, /require\(|better-sqlite3|node:/);
});
