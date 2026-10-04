// 测试隔离守卫（C 票）：测试文件不得打开**默认数据目录**。
//
// 为什么：`npm test` 绝不能碰用户 live 数据目录（`~/.worksplice` 或 `WORKSPLICE_DATA_DIR` 指向的目录）——
// 哪怕只是 SQLite 的 WAL/共享内存写入，也会把真实库的 mtime 顶到当前，让人分不清"测试跑过"与
// "用户数据被动过"；在 CI / 他人机器上更是"意外创建默认库"。测试要么显式把临时目录传给
// `openDataDb`/`openSqliteAdapter`，要么先把 `globalThis.__workspliceDb` 指向临时库（业务模块经单例
// `getDb()` 读它）。默认目录解析本身用 `resolveDataDir()` 断言（纯函数，不碰文件系统）。
//
// 机械判据：扫全部 `*.test.mjs`，出现**无参**的 `openDataDb` / `openSqliteAdapter` / `getDb` 调用即失败。
//
// 局限（写清楚，别给假安全感）：
//   - 文本判据：看不见动态调用（`const open = mod.openDataDb; open()`）与包装函数；
//   - 只看测试文件，不看 `scripts/`（`seed-demo.mjs` 之类的默认目录拒绝语义在各自脚本内）；
//   - 覆盖不到"经业务模块间接落到单例、但没先装 `globalThis.__workspliceDb`"的写法；
//   - 注释行按整行跳过（`//` / `*` / `/*` 开头的行），所以行尾注释里的调用形态不会被判出。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/** `npm test` 覆盖的源码树；每个树里按 `<tree>` 下任意层级的 `*.test.mjs` 收录。 */
const TEST_ROOTS = ["lib", "app", "components", "hooks"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

/**
 * 被禁的形态：无参调用。字符串拼接构造正则，避免本文件自己的源码把判据喂成假阳性。
 * 名字里的括号用全角，同样是为了不撞上这条正则。
 */
const FORBIDDEN = [
  { label: "openDataDb（无参）", source: "open" + "DataDb\\s*\\(\\s*\\)" },
  { label: "openSqliteAdapter（无参）", source: "open" + "SqliteAdapter\\s*\\(\\s*\\)" },
  { label: "getDb（无参）", source: "get" + "Db\\s*\\(\\s*\\)" },
].map((entry) => ({ ...entry, re: new RegExp(entry.source) }));

function listTestFiles(root) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(current, entry.name));
      } else if (entry.name.endsWith(".test.mjs")) {
        found.push(path.join(current, entry.name));
      }
    }
  };
  walk(root);
  return found;
}

/** 行首是注释的行整行跳过（判据是文本形态，注释里写调用形态不算违规——除非写在行尾注释里）。 */
function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function scanFile(file) {
  const hits = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    for (const { label, re } of FORBIDDEN) {
      if (re.test(line)) hits.push(`${file}:${index + 1} ${label}`);
    }
  });
  return hits;
}

test("测试文件不得无参打开默认数据目录（否则会碰用户 live 数据目录）", () => {
  const repoRoot = process.cwd();
  const files = TEST_ROOTS.flatMap((tree) =>
    fs.existsSync(path.join(repoRoot, tree)) ? listTestFiles(path.join(repoRoot, tree)) : [],
  );
  assert.ok(files.length > 0, "没扫到任何测试文件——测试根目录判据失效了");

  const hits = files.flatMap(scanFile);
  assert.deepEqual(
    hits,
    [],
    "测试文件出现无参开库调用（会落到默认数据目录）：\n" +
      hits.join("\n") +
      "\n改成显式传临时目录（openDataDb(tmpDir)），或先把 globalThis.__workspliceDb 指向临时库。",
  );
});
