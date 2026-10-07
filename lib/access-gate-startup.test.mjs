import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 源码级断言档（`docs/engineering-standards.md` §2.1「路由源码级断言」同款形状）：
// 这条防线锁的不是运行时行为，而是**构建期形状**——instrumentation.ts 被 Next 无条件双编译进
// edge layer（`next/dist/build/entries.js` 的 edgeServer 分支），那一遍扫的是
// 「静态 import 图 + 文件体本身」，**不认** `register()` 里的 `NEXT_RUNTIME` 运行时守卫
// （issue #101）。所以顶层多一个 Node 内置 import、或 `process.exit` 写回文件体，噪音就回来，
// 而且不起 dev server 根本发现不了。
//
// 为什么不起 dev server 断言：起一次十几秒、要占端口、要清 `.next/dev`；而要断言的东西是源码
// 形状，`readFile` 就够——正是 §2.1 说的「不值得起 HTTP server」。dev server 级的端到端证据
// 在 `.scratch/edge-instrumentation-warnings/evidence/repro.sh`（红 10 条 / 绿 0 条，一次性）。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/**
 * 抹掉注释但**保留行列位置**（用空格替掉每个非换行字符）。
 * 契约说的是「可执行代码里不许出现」，而文件头的告警注释恰恰要点名 `process.exit`
 * ——不抹注释，这条断言会被自己的说明书绊倒。
 * 行注释的 `[^:]` 前视是为了放过 `http://` 这类 URL（宁可漏判，也不把代码吃掉）。
 */
function stripComments(source) {
  const blankOut = (match) => match.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    .replace(/(^|[^:])\/\/.*$/gm, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/** 逐行编号 + 挑出命中行，给断言失败时当证据用。 */
function offendingLines(source, predicate) {
  return source
    .split("\n")
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => predicate(line));
}

const instrumentationRaw = read("instrumentation.ts");
const instrumentation = stripComments(instrumentationRaw);
const startupGate = read("lib/access-gate-startup.ts");

test("instrumentation 顶层不出现任何静态 import（类型 import 除外：编译期擦除，edge 看不见）", () => {
  const offenders = offendingLines(
    instrumentation,
    (line) => /^import\s/.test(line) && !/^import\s+type\s/.test(line),
  );

  assert.deepEqual(
    offenders,
    [],
    "顶层静态 import 会把 Node 内置拖进 edge 编译（issue #101）。要用的东西一律放进 " +
      "register() 守卫之后的 await import(...)。命中行：\n" +
      offenders.map(([, text]) => `  ${text}`).join("\n"),
  );
});

test("instrumentation 不静态引用任何 node: 内置模块", () => {
  const offenders = offendingLines(
    instrumentation,
    (line) => /(from|require\()\s*\(?\s*["']node:/.test(line),
  );

  assert.deepEqual(
    offenders,
    [],
    "node: 内置模块不支持 Edge Runtime。命中行：\n" +
      offenders.map(([, text]) => `  ${text}`).join("\n"),
  );
});

test("instrumentation 文件体不含 process.exit（它必须待在守卫之后动态 import 的模块里）", () => {
  const offenders = offendingLines(instrumentation, (line) => line.includes("process.exit"));

  assert.deepEqual(
    offenders,
    [],
    "process.exit 写在 instrumentation 的文件体里，edge 那遍编译照样看得见（与 import 链无关）。命中行：\n" +
      offenders.map(([, text]) => `  ${text}`).join("\n"),
  );
});

test("准入闸的动态 import 排在 NEXT_RUNTIME 守卫之后（守卫在前 = 只有 node 才可能走到它）", () => {
  const guard = instrumentation.indexOf('process.env.NEXT_RUNTIME !== "nodejs"');
  const dynamic = instrumentation.indexOf('await import("@/lib/access-gate-startup")');

  assert.ok(guard >= 0, "instrumentation 找不到 NEXT_RUNTIME 守卫");
  assert.ok(
    dynamic >= 0,
    'instrumentation 找不到准入闸的动态 import（应写成 await import("@/lib/access-gate-startup")）',
  );
  assert.ok(guard < dynamic, "准入闸的动态 import 排到了 NEXT_RUNTIME 守卫之前");
});

test("启动闸模块仍是 fail-closed 的三分支（端口未知 / 还没 listening / closed 退出）", () => {
  assert.match(startupGate, /export async function enforceAccessGateAtStartup/);
  assert.match(startupGate, /server port unknown at startup/, "端口未知的放行分支被弄丢了");
  assert.match(
    startupGate,
    /server not listening yet at startup/,
    "尚未 listening 的放行分支被弄丢了",
  );
  assert.match(startupGate, /posture === "closed"/);
  assert.match(
    startupGate,
    /process\.exit\(1\)/,
    "fail-closed 的出口没了——非 loopback + 无凭证必须拒绝启动（ADR-0013 决策二）",
  );
});

test("启动闸从判定层取结论，判定层不反向依赖它（职责分层且不成环）", () => {
  assert.match(
    startupGate,
    /from "\.\/access-gate\.ts"/,
    "启动闸必须走判定层的结论，不自己另探一次 bind",
  );

  const judgment = read("lib/access-gate.ts");
  assert.ok(
    !judgment.includes("access-gate-startup"),
    "判定层反向依赖启动闸会成环（且会把启动期的 process.exit 拖回判定层的 import 图）",
  );
});
