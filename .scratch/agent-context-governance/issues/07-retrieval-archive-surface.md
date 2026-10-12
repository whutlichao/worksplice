# 检索面扩到归档会话原文

Type: task
Status: resolved

## Question

在既有服务层检索入口上扩面，让归档会话原文（含 compact summary）与消息正文同源可检索，
成员面 `search` op 与人类搜索 UI 两个消费面同步生效，权限沿用 channel membership。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 B2（归档原文可检索并可定位）、B3（summary 随同一检索面
  覆盖）、B4（检索权限沿用 channel membership）、B9（不新增工具、不改权限模型）；对应裁决 D2
  （检索入口沿用既有服务层与两个消费面扩面、模型主动声明触发、不引入应用层自动注入）与 D3
  （现状语义显式化：成员只检索所在频道，owner 面维持 Owner 语义）。
- 改动面：服务层入口 [`search.ts:24-51`](../../../lib/domain/collab/search.ts#L24-L51)（成员 scoping
  在 [`search.ts:36-51`](../../../lib/domain/collab/search.ts#L36-L51)）；两个消费面＝成员面 `search`
  op（[`member-ops.ts:575-586`](../../../lib/agent-loop/member-ops.ts#L575-L586)）与人类面
  `GET /api/search`（[`route.ts`](../../../app/api/search/route.ts)）。归档侧索引由票 06 提供。
- 不变量：不注册新工具（不重开
  [ADR-0013 决策一](../../../docs/adr/0013-http-corridor-caller-identity.md#L5)）；检索触发维持模型
  主动声明 op，不引入应用层自动注入；不新增 ACL 层、不按 workspace 分区、不做全库可检索；不改变
  协作消息不可变语义；回交形状（每轮最多一次观察相）由票 08 收口断言。

## Acceptance

- B2：经两个消费面（成员面 `search` op、人类搜索 UI）以归档内容中的关键事实发起检索，命中返回该
  归档会话原文并可定位到具体归档会话；同一事实在归档＋索引前不可经检索面命中。
- B3：同一检索入口能命中 summary 文本；不存在只索引 summary 的独立面。
- B4：成员面非成员频道命中数为 0（含归档面），结果与其频道可见面同构；owner 面维持 Owner 语义不变。
- B9：工具集锁定条目不变；`search` op 的声明式触发不变。
- 证据形式：扩展既有测试——[`search.test.mjs`](../../../lib/domain/collab/search.test.mjs)、
  [`search-route.test.mjs`](../../../lib/domain/collab/search-route.test.mjs)、
  [`member-ops.test.mjs`](../../../lib/agent-loop/member-ops.test.mjs)、
  [`loop-ops.test.mjs`](../../../lib/agent-loop/loop-ops.test.mjs)；含归档命中的权限断言。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。

## Answer

已按票面实施检索面扩面（spec B2/B3/B4/B9、D2/D3），base 提交 `2569817`：

- **服务层**（[`lib/domain/collab/search.ts`](../../../lib/domain/collab/search.ts)）：既有入口 `searchMessages`
  扩面为同时检索 `messages` 与 `session_archive_index`（票 06），返回
  `SearchHit = MessageSearchHit | ArchiveSearchHit` 联合（`source` 判别）；归档命中携带
  `archive_id` / `source_path` / `entry_index` / `entry_type`（可定位到具体归档会话与条目）+
  `agent` 归属（成员名解析，供消费面呈现）；limit 收敛语义不变（`[1, MAX_SEARCH_LIMIT]`），两来源
  **交替合并**（各自内部顺序不变）、limit 收口合并后的总条数。
- **归档命中的权限语义**（票面授权自行裁定，现留痕）：归档索引行只有 `agent_id`、没有频道维度 →
  成员面按「该成员自己的归档」过滤（`agent_id === opts.memberId`；归档副本归属该 agent 私有，
  D1/B7），owner 面无过滤（Owner 语义不变，D3）；不新增 ACL 层、不按 workspace 分区、不做全库检索。
  两来源都沿用「DB LIMIT 之后过滤」的宁少不泄口径（作用域命中超过取数上限时可能少拿，不可见内容
  不会多拿）；未新增 SQL 面。
- **成员面 `search` op**（[`member-ops.ts`](../../../lib/agent-loop/member-ops.ts)）：观察相归档行
  `[archived session of @<agent>, archive <archive id>, entry <N> (<entry_type>)]: snippet`；snippet
  截断 240、每轮最多一次观察相、声明式触发均不变（B8/B9）；`loop.ts` 未动。
- **人类面**：[`app/api/search/route.ts`](../../../app/api/search/route.ts) 薄封装透传（无面级过滤）；
  [`components/SearchView.tsx`](../../../components/SearchView.tsx) 归档命中行标明来源
  （`search.archive` 徽标「归档会话」）+ 归属 agent + 归档定位 token（短 id#条目行号，`title` 为源文件
  路径）；归档行无频道深链 → 不可点、不新造路由（票面「最小可用」）；i18n 新增 `search.archive`
  （en/zh-CN 双包）。
- **不变量**：未注册新工具 / 新 op（不重开 ADR-0013）、无应用层自动注入、未改权限模型、未动协作消息
  不可变语义、未碰 `loop.ts` 注入预算（票 08）、未改 `lib/session-archive.ts`（票 06）与
  `agent-lifecycle.ts` / `agent-runtime.ts`（票 09）、未新增 schema、未改 docs。
- **测试**：+11 例——[`search.test.mjs`](../../../lib/domain/collab/search.test.mjs) 4（B2 归档前不可命中 /
  归档后可定位、B3 summary 同面命中、B4 成员只命中自己的归档、消息/归档交替合并与 limit）；
  [`loop-ops.test.mjs`](../../../lib/agent-loop/loop-ops.test.mjs) 3（归档前 no matches、成员面命中自己的
  归档且不泄漏他人、summary 命中）；[`member-ops.test.mjs`](../../../lib/agent-loop/member-ops.test.mjs) 1
  （观察相归档行格式）；[`search-route.test.mjs`](../../../lib/domain/collab/search-route.test.mjs) 1
  （薄封装不按来源过滤）；[`SearchView.test.mjs`](../../../components/SearchView.test.mjs) 2（归档行渲染
  + i18n 双包）。
- **质量门禁**：`npm run typecheck` ✓；`npm run lint` 0 error（仅 `hooks/useI18n.tsx:61` 一条存量 warning，
  非本票文件）；`npm test` 基线 **1435/1435**（同 base `2569817` 的独立 worktree 复核）→ 本票后
  **1446/1446**（+11）。
- **code-review 双轴（对最终 diff 跑）**：Standards 轴 1 条硬缺口记录——CONTEXT.md 词表未收录
  「归档会话」；票面「不改 docs」约束下不处理，留后续 docs 票（与 spec.md「文档漂移集中留 docs 票」
  一致）。其余 judgement call 有意保留并注明理由（`searchMessages` 名与入口保留 = B9「入口仍是现有
  服务层检索函数」；两来源 fetch→filter→合并同形不抽公共件；UI/观察相各自格式化定位列；测试夹具
  局部拷贝沿仓库惯例）。Spec 轴无缺失、无越界；1 条可达性 finding 已修复（owner 默认 limit=20 时
  消息命中可能把归档命中整挤出 → 改用交替合并并补「消息超 limit 不挤没归档」断言）；1 条解释性裁决
  留痕（成员面归档过滤设计，见上）。
- **PR**：[#177](https://github.com/whutlichao/worksplice/pull/177)（body 路径：
  `/Users/apple/orca/workspaces/worksplice/context-governance-07-pr-body.md`），head 与最终提交一致
  （实现 `7e924fb` + 评审修复 `799a6b0` + 本 Answer 回填提交）。票 09 的 PR 号暂未知（其分支尚未
  推送），合并顺序由协调者处理。

## Comments

- 红→绿证据：`search.test.mjs` 先写 B2 用例（归档后 `hits.length` 期望 1、实得 0，`0 !== 1` 失败），
  实现后转绿；成员面 3 例红（归档行落入消息分支，观察相输出 `#undefined @unknown in thread of
  undefined`）；SearchView 2 例红（无来源徽标/定位 token）；route 守卫例直接绿（路由本就未变，锁
  「不按来源过滤」）。
- 并行协议遵守：未改 `lib/agent-lifecycle.ts` / `lib/agent-runtime.ts` / `lib/session-archive.ts`；
  实施过程无决策类提问（归档过滤形态按票面「具体形态你裁定」处理并已在上文留痕）；按 preamble 节奏
  发送 heartbeat，各检查点 `check` 无 coordinator follow-up。
- 已知取舍：成员面归档取数上限 50 条，他人归档命中 >50 条时本人命中可能少拿（与消息面同一「宁少
  不泄」口径，不新增 SQL 面）；人类面深链维持消息语义，归档命中只给行内定位 token（不新造路由）。
