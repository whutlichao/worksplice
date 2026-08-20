# 13 — model/skills/plugins 存储委托 SDK + model-scope thin adapter

**What to build:** 模型/技能/插件三类的存储与加载从 worksplice 自管收敛到 SDK 原生能力：models.json 增删改走 SettingsManager（withLock + invalidateModelsCache）、技能加载走 DefaultResourceLoader、插件管理走 DefaultPackageManager，ModelsConfig/SkillsConfig 面板降为薄封装（行为不变）；`model-scope` 委托 `resolveModelScopeWithDiagnostics` 的 thin adapter（`enabledModels` 全语法 `provider/modelId + :thinkingLevel`，thinkingLevelPins 随 `ScopedModel.thinkingLevel` 回传不自算）；`PATCH disable-model-invocation` 的 SKILL.md frontmatter 手术短期保留并标注 sunset（SDK 提供 updateSkill 后移除）。

**Blocked by:** 11 — cwd 互斥唯一事实来源（与 12 并行）

**Status:** ready-for-agent

- [ ] models.json 读写经 SettingsManager.withLock + invalidateModelsCache，全局模型面板行为不变（auth 双 provider 列表刷新规则不回归）
- [ ] skills 加载经 DefaultResourceLoader（settings 路径/包技能/项目 `.agents/skills` 同口径），插件经 DefaultPackageManager；开关手术只改 `disable-model-invocation` frontmatter、sunset 注释标注
- [ ] model-scope thin adapter 委托 SDK 解析（provider/modelId + `:thinkingLevel` 全语法），`thinkingLevelPins` 随 ScopedModel 回传，`enabledModels` 读写走 SettingsManager
- [ ] 全量门禁 `tsc --noEmit + npm run lint + npm test`（347 用例）全绿；models-config/skills/plugins 路由源码断言回归
- [ ] 手动③：配置面板手测——模型/技能/插件 增删改查与 auth 状态无退化