# 01: i18n 客户端模块 process polyfill 实例化崩溃（lib/i18n/format.ts）

**What to build:** 修复 Next.js 16.2.12 (Turbopack) dev 环境下首页 Runtime Error：`lib/i18n/format.ts` 引用 `process.env.NODE_ENV` 导致 Turbopack 往 app-client bundle 注入 `next/dist/build/polyfills/process.js` polyfill 模块，实例化时报 "module factory is not available"，整页不可用。修复后：首页正常加载渲染、i18n 翻译行为不回归（含 dev 下缺失翻译 console.warn 的既有行为）、附回归测试，`npm test` 全绿。

**Blocked by:** 无。

**Status:** pending

## 症状（用户报告原文）

- **Error Type:** Runtime Error
- **Error Message:**

```text
Module [project]/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript) was instantiated because it was required from module [project]/lib/i18n/format.ts [app-client] (ecmascript), but the module factory is not available.
This is often caused by a stale browser cache, misconfigured Cache-Control headers, or a service worker serving outdated responses.
To fix this, make sure your Cache-Control headers allow revalidation of chunks and review your service worker configuration. As an immediate workaround, try hard-reloading the page, clearing the browser cache, or unregistering any service workers.

    at module evaluation (lib/i18n/format.ts:34:9)
    at module evaluation (hooks/useI18n.tsx:5:1)
    at Home (app/page.tsx:8:7)
```

- **Code frame（format.ts:34）:**

```ts
32 |   const message = messages[locale]?.[key] ?? messages.en?.[key];
33 |   if (message === undefined) {
> 34 |     if (process.env.NODE_ENV !== "production") console.warn(`[i18n] Missing translation: ${key}`);
     |         ^
35 |     return key;
36 |   }
37 |   return interpolateMessage(message, params);
```

- **Next.js version:** 16.2.12 (Turbopack)

## 排查线索（非定论，按前置 skill 先建回路再下结论，禁止照单收）

- 崩溃点是 `lib/i18n/format.ts` 的 `translateMessage` 内对 `process.env.NODE_ENV` 的裸引用；该 module 被 `hooks/useI18n.tsx` → `app/page.tsx` 链路拉进 app-client bundle。
- 报错文案归因于 stale cache / service worker，但需先证明：清缓存 + 重启 dev server 后是否稳定复现。稳定复现则不是缓存，是构建产物问题。
- 候选方向（各自验证，不预判）：
  1. 纯 stale chunk——硬刷新/重启 dev server 即愈（若如此，需要找到"为什么会产生 stale"，仍是缺陷）；
  2. Turbopack 对客户端模块裸引 `process` 的 polyfill 注入缺陷——修法是把 dev-only 分支改写为可被静态消除/内联替换的形态（例如 Next 官方支持的客户端安全写法），使客户端 bundle 不再依赖 `next/dist/build/polyfills/process.js`；
  3. 依赖版本缺陷（next 16.2.12）——查官方 repo issue 佐证后决定升级或绕行。
- 无论哪条路，修完客户端 bundle 不得再 require process polyfill 模块，或该 polyfill 能正常实例化。

## 约束

- 前置 skill：`diagnosing-bugs`（`~/.pi/agent/skills/diagnosing-bugs/SKILL.md`）——**先建 tight 反馈回路（必红），无回路不许猜**；修完留回归测试；`[DEBUG-]` 打扫干净。
- 验证手段：`npm run dev`（port 30142）+ ego-browser（`skill("ego-browser")`，heredoc 驱动）打开首页复现/验证；改完代码**必须重启 dev server 再验证**（热重载对部分场景不可靠）。**禁止运行 `next build`**（会污染 `.next/` 并破坏 `npm run dev`）。
- tight 回路候选形态：ego-browser 打开 `http://localhost:30142` 抓 console/page error（红 = 错误复现）；修后同回路转绿 = 页面加载成功且错误消失。红色证据（错误文本/截图路径）与绿色证据都要留档进 Answer。
- 回归测试落点：优先纯函数/模块级测试（沿用仓库既有 `node --test *.test.mjs` seam）；若修复是构建层配置，用可在 CI 里跑的断言（如对源码形态或配置的断言）锁行为，并在 Answer 说明局限。
- Typecheck：`node_modules/.bin/tsc --noEmit`；Lint：`npm run lint` 在任务 worktree 内对改动文件做增量对照（改前改后基线），不跑全仓归因。
- 术语：用 codebase-design 词汇（module/interface/depth/seam/adapter），禁 room 等 CONTEXT.md 禁词；UI 不新增 emoji。
- **票据协议**：worker 只在本票文件 append `## Answer`；Status/Blocked by 收敛权归 coordinator（验收时统一改），worker 不动。
- **单分支**：所有改动（代码 + Answer）只落在任务 worktree；完工前 `git status` 确认干净（注意 pi-lens deferred format 可能异步落地纯格式改动，等它出现后再收口），commit 推分支 + `gh pr create`。

## 验收（coordinator 执行）

- [ ] ego-browser 打开首页：正常渲染、无 process polyfill Runtime Error、语言切换可用
- [ ] 缺失翻译的 dev 警告行为不回归（或明确记录行为变化）
- [ ] tight 回路先红后绿，证据留档 Answer
- [ ] 回归测试存在且 `npm test` 全绿；`tsc --noEmit` 干净；lint 增量无新增
- [ ] 无 `[DEBUG-]` 残留；worktree 干净；Answer 含 Review 小节

## Answer

（worker 完成后 append）
