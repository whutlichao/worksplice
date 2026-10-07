# 01: 任务历史列表 React 重复 key 报错（跨 channel 同号任务）

**What to fix:** 浏览器控制台报 `Encountered two children with the same key, \`1\``，组件栈指向 `components/AgentDetailPanel.tsx` 任务历史列表的 `key={task.number}`。

**Blocked by:** 无。

**Status:** resolved

## 症状

打开 agent 详情面板 → 可观测性「任务历史」卡片 → 控制台报重复 key；该 agent 在两个 channel 各有 `#1` 任务时出现。

## 根因（tight 回路证实，非照单收）

- **分支 (a) 跨 channel 同号 —— 成立。** `number` 是 channel 内序号（`lib/domain/collab/tasks.ts` `nextTaskNumber(message.target_id)`），而 `listAgentTasks` 聚合该 agent 在**多个 channel** 的任务。一次性探针（临时数据目录，已删）造出「一个 agent 在两个 channel 各有一个 #1 任务」，`listAgentTasks` 返回 2 条，`numbers: [1, 1] → duplicate number? true`。
- **分支 (b) 同 id 出现两次 —— 已证伪。** `listTasksForAgent` 是 `SELECT DISTINCT tasks.*`（`lib/data/sqlite.ts`），同一任务不可能返回两行；探针输出 `ids distinct? true`、`anchor ids distinct? true`。故数据侧不需要去重，`lib/domain/collab/observability.ts` 零改动。

## 修复

- `components/AgentDetailPanel.tsx`：任务历史行 `key={task.number}` → `key={task.anchor.id}`。
- 顺带把该列表原样抽成同文件的纯展示组件 `TaskHistoryList({ tasks, t })`，让 node 侧测试能用 fixture 直接喂数据做渲染级断言（SSR 丢弃 key、仓库无 jsdom ⇒ 需要这个 seam）。**抽取用等价探针验证过渲染输出逐字节相同**（临时文件，已删）。
- 可见文案/样式零改动；时间线渲染（`key={entry.id}`）与其他组件零改动；channel 名不加进行内（另一个产品决定，票外）。

## 唯一标识的选择：为什么是锚点消息 id

候选：① `task.anchor.id` ② `task.id` ③ `${task.channelId}:${task.number}`。

- ② 需要把 `id` 加进组件侧 `ObservabilityData.tasks` 的本地 interface（wire 里本来有，但本地没声明）——为一个 key 扩 interface 不划算。
- ③ 唯一性依赖「number 在 channel 内唯一」这条**运行时性质**（`createTask` 取 max+1）。它是真性质，但比 DB 约束软。
- ① 锚点 id 就是 `tasks.message_id`，而该列有 **UNIQUE** 约束 ⇒ 全局唯一的硬不变式；且已在本地 interface 里，零扩面。选 ①。

## 验收

- [x] tight 回路先红后绿（node + 真浏览器两处）
- [x] `node --test "components/**/*.test.mjs"` 120/120；`npm test` 全量 1075/1075
- [x] `npm run typecheck` 退出码 0；`npm run lint` 改动文件零新增问题
- [x] Standards + Spec 双轴 review（见下）
- [x] 无 `[DEBUG-]` 残留、临时文件已删

## Answer

### 实现决策

- key 改用 `task.anchor.id`（理由见上）。
- 抽出 `TaskHistoryList({ tasks, t })`：`t` 由面板注入（沿用 `components/ChatInput.tsx` 既有的 `t: (key: string) => string` 写法），组件本身不用 hook，因此测试可直接当普通函数调用取真实元素树。
- 不做任何数据侧去重（分支 b 已证伪）。

### 验证命令结果

**node 侧 tight 回路**（`node --test --test-timeout=60000 components/AgentDetailPanel.test.mjs`，~0.4s）：

单变量回退 key 那一行后的红：

```text
✖ task history rows get unique keys when two channels each hold task #1 (1.342ms)
ℹ tests 12 / pass 11 / fail 1
  AssertionError [ERR_ASSERTION]: duplicate sibling keys under TaskHistoryList>null: ["1"]
```text

恢复修复后的绿：

```text
✔ task history rows get unique keys when two channels each hold task #1 (0.740ms)
✔ task history renders both same-number tasks from different channels (0.568ms)
ℹ tests 12 / pass 12 / fail 0
```text

**真浏览器复验**（ego lite + `next dev -p 30143` + 临时数据目录，已删；**未跑 `next build`、未碰 `~/.worksplice`**）：

- RED 对照（key 退回 `task.number`）：`duplicate-key warnings: 6`，首条即 `Encountered two children with the same key, \`1\``（dev server 日志同步出现 `[browser] Encountered two children with the same key, \`1\``）——顺带证明 console 捕获链路本身是通的，不是「捕获不到所以 0」。
- GREEN（修复后）：面板仍渲染两行 `#1 task in chan-b` / `#1 task in chan-a`，`duplicate-key warnings: 0`、`console.error count: 0`。

**门禁**：

- `node --test "components/**/*.test.mjs"` → `tests 120 / pass 120 / fail 0`
- `npm test`（全量）→ `tests 1075 / pass 1075 / fail 0`
- `npm run typecheck` → 退出码 0
- `npm run lint` → 改动前基线与改后一致：`hooks/useI18n.tsx:61` 那条既有 `react-hooks/exhaustive-deps` warning（0 error）；`npx eslint components/AgentDetailPanel.tsx components/AgentDetailPanel.test.mjs` → 0 problem
- `grep DEBUG-` → 两个文件零残留；临时探针（数据探针 / 等价探针 / dev server / 临时数据目录）全删

### 交付

- 分支：`whutlichao/agent-task-key`；PR：**#102**（https://github.com/whutlichao/worksplice/pull/102）；commit `86799cc`。
- coordinator 的 live 数据实证与本票结论一致：agent Susan (7e308574) 参与 secretary-office #1（thread 进展者）、secretary-office #2（锚点作者）、#all #1（锚点作者），number 集合 {1,2,1} ⇒ key=1 撞。据此把回归 fixture 的第二条改成 `owner: null`，代表「非认领支线命中」的任务；参与支线本身在 panel 这一层不可见（列表项不带该字段），已在 fixture 注释里点明。
- 真浏览器双向复验 coordinator 本不要求，本 worker 顺手做了（见上），G-impl 可直接采信或重跑。

### Review 小节（双轴，worker 自审，未合并两轴）

**Standards**（依据 `docs/engineering-standards.md` §1/§2/§5、`AGENTS.md`、`CONTEXT.md`）：

- §1 注释简体中文、标识符英文 ✓；未新增 UI 图标/emoji ✓；未直连 DB、未动分层 ✓；无 `any` ✓。
- §2.1 组件断言用既有 harness（jiti + `renderToStaticMarkup`）+ `node:test`/`assert/strict`、零新依赖（已确认仓库无 jsdom / react-test-renderer）✓。
- §2.2 三条门禁全绿 ✓。§5 留可验证产物（修复 + 单测 + 本文件）✓。
- smell baseline：`Mysterious Name`/`Duplicated Code`/`Feature Envy`/`Shotgun Surgery` 均无；`Primitive Obsession`（key 仍是裸 string）**有意不加**新类型——`anchor.id` 本就是 message id string，造 `TaskKey` 属过度设计。
- ⚠️ 判断题（豁免，理由在案）：`TaskHistoryList` 的抽取严格说不是修 bug 的必要条件，只改一行 key 也能修好；抽取的**唯一**动机是 spec 要求的渲染级断言在 SSR+无 jsdom 下无处落脚。它保持 locality（同文件、纯展示、无新抽象层、`t` 注入沿用既有写法），故判定为「加深测试面」而非 Speculative Generality。
- ⚠️ 自审发现并已处理：断言初版还要求静态 children 也带 key，与 React 实际规则不符（静态 children 合法无 key），会误报；已收紧为「只查重复」。
- ⚠️ 自审发现并已保留（点名）：组件 JSDoc 里写了「拆出来是为了让 node 侧测试能…」，把测试动机写进生产代码注释。与 `ThreadPanel.tsx` 注明 `THREAD_POLL_MS` 理由的既有习惯一致，故保留；若评审偏好生产注释不承载测试理由，可删该句、不影响行为。

**Spec**（逐条对票）：

- key 由任务唯一标识派生、不再用裸 `number` ✓（分支 a 修法）；分支 b 已证伪故不动数据侧 ✓。
- 「不改可见文案/样式（除 key 本身）」✓——等价探针逐字节比对 + 浏览器两行都在。
- 「不动时间线渲染 / 不动其他组件」✓——diff 仅 `components/AgentDetailPanel.tsx` + 其测试文件，均在授权面内。
- 「channel 名不加进行内」✓（票外产品决定）。
- 回归测试：既有 node:test 风格、加进既有测试文件、无新依赖、key 唯一性契约 + 渲染级断言 ✓。
- 纪律项：`bun install`（未 `npm install`）✓、未 `next build` ✓、live DB 只 `-readonly` 查询、探针与浏览器验证全部走 mkdtemp 数据目录 ✓、未跑 prettier/eslint --fix 等整文件重写命令 ✓。
- 已知缺口（不影响验收）：node 侧拿不到 React 的报警本身（报警只存在于 client dev 渲染器，已核实该字符串只在 `react-dom-client.development.js`），故红证据是「key 唯一性契约 + 元素树」等价物，真浏览器复验另行补做并已完成。