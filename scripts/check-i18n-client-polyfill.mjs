#!/usr/bin/env node
/**
 * [i18n-process-fix] 紧回路（Loop B）：断言 app-client 编译产物中
 * lib/i18n/format.ts 模块不再 require process polyfill 模块。
 *
 * 红 = format.ts 模块体内出现 next/dist/build/polyfills/process.js 的
 *      __turbopack_context__.i(...) 导入（Turbopack dev 对源码中任意
 *      process 词素注入的死导入，模块求值期即执行，运行时依赖
 *      next 内部 chunk 注册的 module factory——SW/缓存投喂旧 chunk 时
 *      factory 失配，即用户所报 "module factory is not available" 崩溃位）。
 * 绿 = 该导入消失（源码无 process 词素 → 无注入）。
 *
 * 用法：node scripts/check-i18n-client-polyfill.mjs [baseUrl]
 * 默认 baseUrl = http://127.0.0.1:30143（任务 worktree dev server）
 */
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:30143";

const html = await (await fetch(`${base}/`)).text();
const chunkUrls = [
 ...new Set(
  [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]),
 ),
];
assert.ok(
 chunkUrls.length > 0,
 "首页 HTML 中未找到任何 chunk 引用（server 是否正常？）",
);

for (const url of chunkUrls) {
 const body = await (await fetch(`${base}${url}`)).text();
 const marker = '[project]/lib/i18n/format.ts [app-client] (ecmascript)"';
 const start = body.indexOf(marker);
 if (start === -1) continue;
 // format.ts 模块工厂体（至下一个模块注册边界）——polyfill 导入位于工厂体顶部
 const moduleBody = body.slice(start, start + 200_000);
 const polyfillImport = moduleBody.includes(
  "polyfills/process.js [app-client] (ecmascript)",
 );
 console.log(`format.ts 模块所在 chunk: ${url}`);
 console.log(`  polyfill 模块导入存在: ${polyfillImport}`);
 if (polyfillImport) {
  console.error(
   "RED: format.ts 客户端模块仍 require process polyfill（死导入，模块求值期执行）",
  );
  process.exit(1);
 }
 console.log("GREEN: format.ts 客户端模块不再依赖 process polyfill 模块");
 process.exit(0);
}
console.error("FAIL: 未在任何 chunk 中找到 format.ts 模块工厂");
process.exit(2);
