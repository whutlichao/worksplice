/**
 * 编译期注入的全局常量（next.config.ts 的 `compiler.define`，各构建期注入不同值）。
 *
 * 客户端源码禁止出现 `process` 词素：Turbopack dev 会为任何 process 引用
 * 向 app-client 模块注入 `next/dist/build/polyfills/process.js` 死导入
 * （PURE 标注不阻止 dev 下执行），模块求值期即解析该模块；
 * 而 dev chunk URL 不含内容哈希，SW/HTTP 缓存投喂旧 chunk 时该 polyfill 的
 * module factory 失配，报 "module factory is not available" 整页崩溃。
 * 详见 .scratch/i18n-process-fix/issues/01。
 */
declare const __WS_DEV__: boolean;

/** 应用版本（package.json version，next.config.ts 注入；与旧 NEXT_PUBLIC_APP_VERSION 同源）。 */
declare const __WS_APP_VERSION__: string;
