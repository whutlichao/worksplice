# 01: i18n 客户端模块 process polyfill 实例化崩溃（lib/i18n/format.ts）

**What to build:** 修复 Next.js 16.2.12 (Turbopack) dev 环境下首页 Runtime Error：`lib/i18n/format.ts` 引用 `process.env.NODE_ENV` 导致 Turbopack 往 app-client bundle 注入 `next/dist/build/polyfills/process.js` polyfill 模块，实例化时报 "module factory is not available"，整页不可用。修复后：首页正常加载渲染、i18n 翻译行为不回归（含 dev 下缺失翻译 console.warn 的既有行为）、附回归测试，`npm test` 全绿。

**Blocked by:** 无。

**Status:** resolved

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

- [x] ego-browser 打开首页：正常渲染、无 process polyfill Runtime Error、语言切换可用（worker 在 worktree 30143 浏览器级实证；coordinator 合并后在 main 30142 复核）
- [x] 缺失翻译的 dev 警告行为不回归（回归测试锁定 + typeof 兜底语义等同，行为变化已记录）
- [x] tight 回路先红后绿，证据留档 Answer
- [x] 回归测试存在且 `npm test` 全绿（coordinator 独立重跑 461/461）；`tsc --noEmit` 干净；lint 增量无新增（coordinator 独立对照）
- [x] 无 `[DEBUG-]` 残留（grep 零命中）；worktree 收口净（pi-lens 空行残差随本 commit 收敛）；Answer 含 Review 小节（Standards+Spec 双轴）

## Answer

### 结论

崩溃因果链（实证，非推断）：① Turbopack 16.2.12 dev 会为客户端模块源码中的**任意 `process` 词素**注入 `next/dist/build/polyfills/process.js` 死导入——即使 `process.env.NODE_ENV` 已被内联替换（format.ts 编译体里 NODE_ENV 已变为 `"TURBOPACK compile-time truthy", 1`，但模块顶部仍残留一条求值期会执行的 `/*#__PURE__*/ ctx.i(polyfill)` 导入）；② dev chunk URL **不含内容哈希**（`lib_0-52byo._.js` 内容变化 md5 `420ad21…→36b413…`、跨重启，URL 均不变）；③ 浏览器存在残留生产 service worker（worksplice 发布形态即 `next start`，同源端口 30142 注册过 SW）时，sw.js 对 `/_next/static/` 的 cache-first **无视** dev 下发的 `Cache-Control: no-cache, must-revalidate`，投喂旧 chunk 体 → 模块 factory 注册图与新 import 失配 → 首个求值的 process 引用模块处抛 "module factory is not available"，整页不可用。即：bundle 单独不崩（清缓存+冷启动稳定绿，已在 30142 双路径验证），必须叠加「SW 投喂旧 chunk」才崩——错误文案自身的 cache/service-worker 归因成立。

### 紧回路与红/绿证据

回路命令（agent-runnable、秒级、确定性）：`node scripts/check-i18n-client-polyfill.mjs [baseUrl]`——断言 app-client 编译产物中 format.ts 模块不再 require process polyfill 模块（票据点名的崩溃位本体）。

- **红（修前，worktree dev server）**：`polyfill 模块导入存在: true → RED: format.ts 客户端模块仍 require process polyfill（死导入，模块求值期执行）`，exit=1。编译体证据：format.ts 工厂体含 `__turbopack_context__.i("…/next/dist/build/polyfills/process.js [app-client] (ecmascript)")`，且 PwaRegistration 同病（NODE_ENV/NEXT_PUBLIC_ 全部内联替换、register 路径已 `//TURBOPACK unreachable`，polyfill 死导入仍在）。
- **绿（修后，重启 dev server）**：`polyfill 模块导入存在: false → GREEN`，exit=0；全 chunk 扫描：app 侧 chunk（lib/PwaRegistration）polyfill 导入清零，仅剩 7 个 next 内部 chunk（`0k-k_next_dist_*`、`node_modules__pnpm_*`，零 app 模块工厂）。
- **浏览器级（origin 127.0.0.1:30143，ego-browser）**：修后首页完整渲染、无 Runtime Error、无 factory 文案；语言切换 en↔zh 双向可用（`<select>` locale 切换，`document.documentElement.lang` 与 UI 文案同步）；**dev SW 自清理实证**：手工注册 SW（模拟残留生产 SW）→ 载入修后页面 → `getRegistrations()` 归 0，Cache Storage 保留但无 SW 拦截。
- **崩溃类实证（修后残余面归因）**：SW 缓存填充（44 entries @16.2.12）→ 临时降级 next@16.2.11（模块 id 全变）→ 重启重载 → 页面挂死，overlay 报 "Module [next@16.2.12_…/compiled/react/jsx-dev-runtime.js [app-client]] was instantiated because it was required from module [project]/hooks/useI18n.tsx [app-client] (ecmascript), but the module factory is not available"——与用户报错**同形态同链路**（用户缺失的是 format.ts 所需的 polyfill，本实验缺失的是旧 next 路径的 jsx-dev-runtime；require 方同为 useI18n）。复原 next@16.2.12 → 重启重载 → 页面恢复、无错误、SW 维持 0 注册（自愈闭环）。注：该实验证明崩溃类根在投喂层（SW×非内容哈希 URL），修复后 app 代码不再是脆弱点，残余暴露面收窄到 next 内部 chunk 自身。
- 清缓存矩阵：30142（热 server 与冷启动 server、清浏览器缓存 + 硬刷新）均稳定绿 → 排除候选 1（纯 stale chunk 即愈）与「确定性 bundle 缺陷」，实锤需 SW 叠加。

### 修复内容（adapter：编译期常量隔离 `process` 词素）

- `next.config.ts`：新增 `compiler.define`——`__WS_DEV__`（由配置加载期 `NODE_ENV` 派生，`next dev`=true / `next build`=false；与旧内联替换语义完全一致）与 `__WS_APP_VERSION__`（同 package.json version，替代客户端的 `process.env.NEXT_PUBLIC_APP_VERSION` 读取）。`compiler.define` 在 16.2.12 走 `getDefineEnv` → SWC/Turbopack 路径，且内置键冲突有守卫。
- `lib/build-env.d.ts`（新）：两个编译期常量的环境声明接口（module-level ambient declare）。
- `lib/i18n/format.ts:34`（点名崩溃位）：`process.env.NODE_ENV !== "production"` → `typeof __WS_DEV__ === "undefined" || __WS_DEV__`。typeof 兜底保持纯 Node（node --test）下回落为 dev——与旧 `NODE_ENV` 未设时的行为逐字一致；bundle 化后 dev=warn、prod=静默，均不变。
- `components/PwaRegistration.tsx`：两处 process 引用（NODE_ENV 门 + NEXT_PUBLIC_APP_VERSION）改走编译期常量，客户端模块 process 词素清零；dev 分支由「直接 return」改为「注销同源残留 SW 后 return」——根因层治理：dev 永不积累 SW，生产注册路径不变（生产仍按 version 注册）。
- `scripts/check-i18n-client-polyfill.mjs`（新）：上述紧回路，可 CI/agent 直跑。

**行为变化**：① dev 环境下 PwaRegistration 会注销残留 SW（新卫生行为，其余不变）；② 纯 Node 测试环境下缺译 warn 维持触发（旧行为一致）；③ 生产构建产物警告分支依旧静默。其余 i18n 行为零变化。

### 回归测试

`lib/i18n/format.test.mjs` 新增 3 个用例并连同既有 i18n 测试挂进 `npm test`（package.json 增 `lib/i18n/*.test.mjs`）：① 源码形态断言（format.ts 去 注释后无 `process` 词素 + 使用 `__WS_DEV__`；PwaRegistration 同；next.config 定义两常量）——票据许可的「配置/源码形态断言」seam；② 行为锁定（globalThis stub `__WS_DEV__`=true → warn 触发且文案含 `[i18n] Missing translation:`；=false → 静默）。局限：源码形态断言不跑 Turbopack，注入消除由紧回路（需 dev server）与浏览器实证补足。

### 验证

- `npm test`：**461/461 pass**（含新回归 + 新挂 i18n 测试）；`node_modules/.bin/tsc --noEmit`：**干净**；`npm run lint` 改动文件（format.ts/format.test.mjs/PwaRegistration.tsx/next.config.ts/build-env.d.ts/回路脚本）：**0 新增**（pi-lens advisory 为 format.ts 既有 4 条，非本次新增）。
- pi-lens deferred format 已异步落地（全改动文件重排版），落盘后全量复验依旧全绿；`[DEBUG-]` 残留 grep 零命中；git 状态仅含上述 6 文件。
- 端口协调：per coordinator 裁定，30142 归 main checkout 不动，本任务回路全程在 worktree `npm run dev -- -p 30143`。

### Review

- **Standards 轴**：术语用 module/interface/adapter/seam（编译期常量= bundler 注入的编译期接口，format.ts/PwaRegistration= 被隔离的调用方）；无禁词；无 emoji；[DEBUG-] 清零；票据协议遵守（仅 append 本节，Status/Blocked by 未动）；单分支单 worktree。
- **Spec 轴**：验收逐条——首页正常渲染 ✓；无 process polyfill Runtime Error ✓（Loop B 绿 + 浏览器实证）；语言切换可用 ✓；缺译 dev warn 不回归 ✓（测试锁定 + typeof 兜底语义等同）；紧回路先红后绿 ✓（证据如上）；npm test/tsc/lint ✓；无 [DEBUG-] 残留 ✓；worktree 收口净 ✓。
- **残余风险（如实）**：① next 内部 chunk 仍引用 polyfill（next 自有产物，未触碰）；next 版本翻转 × SW 投喂仍可致 dev 崩溃（落点在 next 内部）——但 dev SW 自清理使投喂源不可持续，崩溃类被根因层抑制；② 已中毒且当轮即崩的浏览器（React 未挂载则注销不执行）需一次性手动注销 SW（错误文案自身即此建议），此后 dev 自愈；③ 生产不受影响（webpack 构建、URL 含内容哈希、SW 注册路径不变）。
- **移交观察**：main checkout（30142）dev server 当前对 `/` 返回 Next 404 页（`<title>404: This page could not be found.</title>`，HTTP 404），疑其 `.next` 状态异常，非本票范围，建议 coordinator 侧自查。
- **用户一次性提示**：报错用户若当前浏览器已注册 SW，需手动注销一次（DevTools → Application → Service Workers → Unregister）或硬刷新；此后本修复的 dev 自清理接管。
