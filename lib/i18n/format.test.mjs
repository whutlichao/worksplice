import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRelativeTime,
  interpolateMessage,
  translateMessage,
} from "./format.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

test("interpolates string and numeric parameters", () => {
  assert.equal(
    interpolateMessage("Hello, {name} ({count})", { name: "Pi", count: 2 }),
    "Hello, Pi (2)",
  );
});

test("falls back to English and returns the key when both are missing", () => {
  assert.equal(
    translateMessage("zh-CN", "common.ok", {
      en: { "common.ok": "OK" },
      "zh-CN": {},
    }),
    "OK",
  );
  assert.equal(
    translateMessage("zh-CN", "missing.key", { en: {}, "zh-CN": {} }),
    "missing.key",
  );
});

test("formats relative time using the selected locale", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    formatRelativeTime(new Date("2026-01-01T00:05:00.000Z"), "en", now),
    "in 5 minutes",
  );
  assert.equal(
    formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), "zh-CN", now),
    "1小时前",
  );
});

// ---- 回归（.scratch/i18n-process-fix/issues/01）：客户端源码不得出现 process 词素 ----

const here = dirname(fileURLToPath(import.meta.url));

function readSource(relativePath) {
  return readFileSync(join(here, relativePath), "utf8");
}

/** 剥离行/块注释后再断言——注入看的是代码词素，注释不触发，但文本断言不能误报注释。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Turbopack dev 会为客户端模块中任意 process 词素注入 polyfills/process.js 死导入
// （模块求值期执行）；dev chunk URL 不含内容哈希，旧 chunk 场景下 factory 失配
// 即 "module factory is not available" 整页崩溃。dev 判定一律走编译期常量 __WS_DEV__。
test("client-reachable i18n source contains no process token", () => {
  const source = stripComments(readSource("./format.ts"));
  assert.ok(
    !/\bprocess\b/.test(source),
    "format.ts 不得引用 process（会触发 Turbopack polyfill 注入）",
  );
  assert.ok(
    source.includes("__WS_DEV__"),
    "dev 判定应走 __WS_DEV__ 编译期常量",
  );
});

test("missing-translation warn fires in dev builds and stays silent in production builds", () => {
  const messages = { en: {}, "zh-CN": {} };
  const warns = [];
  const original = console.warn;
  console.warn = (line) => warns.push(String(line));
  try {
    globalThis.__WS_DEV__ = true;
    assert.equal(
      translateMessage("zh-CN", "missing.warn", messages),
      "missing.warn",
    );
    assert.equal(warns.length, 1);
    assert.ok(warns[0].includes("[i18n] Missing translation: missing.warn"));

    warns.length = 0;
    globalThis.__WS_DEV__ = false;
    assert.equal(
      translateMessage("zh-CN", "missing.silent", messages),
      "missing.silent",
    );
    assert.equal(warns.length, 0);
  } finally {
    delete globalThis.__WS_DEV__;
    console.warn = original;
  }
});

test("next.config injects __WS_DEV__ and __WS_APP_VERSION__ defines", () => {
  const source = readSource(join("..", "..", "next.config.ts"));
  assert.ok(source.includes("__WS_DEV__"), "next.config.ts 应定义 __WS_DEV__");
  assert.ok(
    source.includes("__WS_APP_VERSION__"),
    "next.config.ts 应定义 __WS_APP_VERSION__",
  );
  const registration = stripComments(
    readSource(join("..", "..", "components", "PwaRegistration.tsx")),
  );
  assert.ok(
    !/\bprocess\b/.test(registration),
    "PwaRegistration.tsx 不得引用 process",
  );
});
