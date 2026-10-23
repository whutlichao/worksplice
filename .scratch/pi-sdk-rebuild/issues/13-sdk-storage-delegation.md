# 13 — model/skills/plugins 存储委托 SDK + model-scope thin adapter

**What to build:** 模型/技能/插件三类的存储与加载从 worksplice 自管收敛到 SDK 原生能力：models.json 增删改走 SettingsManager（withLock + invalidateModelsCache）、技能加载走 DefaultResourceLoader、插件管理走 DefaultPackageManager，ModelsConfig/SkillsConfig 面板降为薄封装（行为不变）；`model-scope` 委托 `resolveModelScopeWithDiagnostics` 的 thin adapter（`enabledModels` 全语法 `provider/modelId + :thinkingLevel`，thinkingLevelPins 随 `ScopedModel.thinkingLevel` 回传不自算）；`PATCH disable-model-invocation` 的 SKILL.md frontmatter 手术短期保留并标注 sunset（SDK 提供 updateSkill 后移除）。

**Blocked by:** 11 — cwd 互斥唯一事实来源（与 12 并行）

**Status:** resolved（2026-10-23）

- [x] ~~models.json 读写经 SettingsManager.withLock + invalidateModelsCache~~ **已由 ADR-0007 取代**：`models.json` 使用本仓 `lib/atomic-file` 的 `writePrivateFileAtomicSync` 原子写 + PUT 后显式 `invalidateModelsCache`（`SettingsManager.withLock` 全仓零调用点，不新增锁、不改写入语义）；全局模型面板行为不变（auth 双 provider 列表刷新规则不回归）
- [x] skills 加载经 DefaultResourceLoader（settings 路径/包技能/项目 `.agents/skills` 同口径），插件经 DefaultPackageManager；开关手术只改 `disable-model-invocation` frontmatter、sunset 注释标注
- [x] model-scope thin adapter 委托 SDK 解析（provider/modelId + `:thinkingLevel` 全语法），`thinkingLevelPins` 随 ScopedModel 回传，`enabledModels` 读写走 SettingsManager
- [x] 全量门禁 `tsc --noEmit + npm run lint + npm test` 全绿；models-config/skills/plugins 路由源码断言回归
- [ ] 手动③：配置面板手测——模型/技能/插件 增删改查与 auth 状态无退化 — **N/A**：隔离 worker 无已登录 GUI 面板，install/update 依赖网络与真实包管理器，无法稳定复现；对应行为改由三份 route 回归测试覆盖（见 Answer），不伪造手测

## Answer

**结论**：按 ADR-0007 收敛剩余项完成；运行时只加两处注释，未改任何写入/响应语义，新增 3 个行为级回归测试文件（15 用例）。

### 1. 存储边界（第 1 条按 ADR 改写）

- ADR：`docs/adr/0007-sdk-delegation-boundary.md`（accepted）——`models.json` 由本仓原子写落盘 + 显式 `invalidateModelsCache`；`SettingsManager.withLock` 全仓零调用点。
- 代码：`app/api/models-config/route.ts:24-27` 注释写明契约与 ADR 出处；`writeModelsJson` 仍走 `writePrivateFileAtomicSync`（`lib/atomic-file.ts`），PUT 仍调用 `invalidateModelsCache`（`lib/models-cache.ts:38`）。未新增锁，未改 schema。
- 回归：`app/api/models-config/route.test.mjs` — GET 原样读取/缺文件回退；PUT 清洗空模型 id、非模型字段逐字保留、文件 `0600`、无 `.tmp` 残留；PUT 后 `loadModelsWithCache` 重新加载（generation 失效）；双 auth provider 在 API-key/OAuth 两列表中的互斥点亮规则（auth 变化后的刷新规则）。

### 2. skills / plugins / model-scope 复核

- skills：`GET /api/skills` → `lib/skills-service.ts:8-9` `DefaultResourceLoader.reload`；未发现绕过路径。
- plugins：`app/api/plugins/route.ts:210-239` 用 `DefaultPackageManager` 解析/列出，disable/enable 经 `SettingsManager` packages + `flush()`；未发现绕过路径。
- model-scope：`lib/model-scope.ts:71` 委托 `resolveModelScopeWithDiagnostics`；`thinkingLevelPins` 由 `scoped.thinkingLevel` 回传（`:85-88`），未自算；未发现缺口。
- `PATCH /api/skills`：`app/api/skills/route.ts:56` `sunset: 待 SDK 提供 updateSkill() 后移除（ADR-0007）`；手术逻辑保留未删。

### 3. 测试证据

- 命中 selector：`node --test app/api/models-config/*.test.mjs app/api/skills/*.test.mjs app/api/plugins/*.test.mjs` → **15 tests / 15 pass**。
- 变异红证据（隔离临时改动，恢复后三文件 sha256 比对一致）：
  - 去掉 `invalidateModelsCache()` → 缓存刷新用例 `actual: 1, expected: 2` 失败；
  - frontmatter 手术多写一行 → skills 逐字保留用例失败（diff 出现 `extra: mutation`）；
  - disable 后去掉 `settingsManager.flush()` → 插件持久化用例 `actual: false, expected: true` 失败。
- skills 用例：enable 只插入一行、disable 后逐字还原原文；无 frontmatter 时创建；缺字段 400 / 文件不存在 404 / 越界路径 403。
- plugins 用例：`DefaultPackageManager` 列表与 missing 诊断；disable 落盘 `{source, extensions: [], …}` 且下一次 GET 为 disabled；enable 还原字符串条目；host/信任 403、content-type 415、缺字段 400。
- 门禁：
  - `npm run typecheck` → clean；
  - `npm run lint` → 0 errors（1 条既有 warning：`hooks/useI18n.tsx:61`）；
  - `env -u DEEPSEEK_API_KEY npm test` → **1566 tests / 1566 pass**；
  - 本 worktree base 基线（`3b86a28`）：同命令 1551 tests / 1551 pass；若保留 shell 的 `DEEPSEEK_API_KEY`，基线为 1550/1551（`lib/model-listing.test.mjs` 断言空模型表，属宿主环境注入，与本次改动无关）。

### 4. 双轴 review

- **Standards**：2 条硬项已修复——新注释统一简体中文；删除对 malformed JSON → 500 的断言（避免把跨路由错误码分歧钉成契约）。判断项保留并说明：临时 `PI_CODING_AGENT_DIR` 样板与既有测试一致；双 auth 矩阵由本票显式要求；原子写 `0600`/无 `.tmp` 由本票「原子落盘」显式要求；`route.test.mjs` 命名与嵌套路由先例 `app/api/members/[id]/transcript/route.test.mjs` 一致。
- **Spec**：无阻断项；残留风险——双 provider 列表断言在纯函数层，`/api/auth/*` 路由接线回归仍由既有 `lib/provider-listing.test.mjs` 与本票纯函数矩阵覆盖，未新增路由级接线测试（按票面「按现有函数可测部分」）。

### 5. 交付

- PR：#200（body：`.scratch/pi-sdk-rebuild/issues/13-pr-body.md`）
- Door：two-way（无 schema/持久化格式/API 形状变更）
