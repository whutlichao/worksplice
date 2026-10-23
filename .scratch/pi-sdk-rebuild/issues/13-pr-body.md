## Summary

按 ADR-0007 收敛 models/skills/plugins 的存储边界，只补注释与行为级回归测试，不改运行时语义。

```diff
 app/api/models-config/route.ts
+  // ADR-0007: writePrivateFileAtomicSync + invalidateModelsCache, not withLock
+
 app/api/skills/route.ts
+  // sunset: remove when SDK exposes updateSkill()
+
 app/api/
+├── models-config/route.test.mjs   # GET/PUT、原子落盘、缓存失效、双 auth 列表
+├── skills/route.test.mjs          # DefaultResourceLoader 读取、frontmatter 单行手术、错误码
+└── plugins/route.test.mjs         # DefaultPackageManager 列表、disable/enable 持久化、安全边界
```

- `models.json` 写入仍是「`writePrivateFileAtomicSync` 原子写 + PUT 后显式 `invalidateModelsCache`」；未使用、未新增 `SettingsManager.withLock`。
- 未改 schema、SDK 版本、依赖，也未改任何响应形状。
- 同票复核：skills → `DefaultResourceLoader`（`lib/skills-service.ts:8-9`），plugins → `DefaultPackageManager`（`app/api/plugins/route.ts:210,239`），model-scope → `resolveModelScopeWithDiagnostics`（`lib/model-scope.ts:71`），`thinkingLevelPins` 由 `scoped.thinkingLevel` 回传（`lib/model-scope.ts:85-88`）。未发现缺口。

## Evidence

- **Before（变异测试，隔离副本，恢复后 sha256 校验一致）:**
  - 去掉 `invalidateModelsCache()` → `actual: 1, expected: 2`（缓存刷新测试失败）
  - frontmatter 手术多写一行 → skills 逐字保留测试失败（diff 显示 `extra: mutation`）
  - disable 后去掉 `settingsManager.flush()` → `actual: false, expected: true`（插件持久化测试失败）
- **After:** `node --test app/api/models-config/*.test.mjs app/api/skills/*.test.mjs app/api/plugins/*.test.mjs` → 15 tests, 15 pass
- `npm run typecheck` → clean
- `npm run lint` → 0 errors（1 条既有 warning：`hooks/useI18n.tsx:61`）
- `env -u DEEPSEEK_API_KEY npm test` → 1566 tests, 1566 pass（baseline 1551/1551；若保留 shell 中的 `DEEPSEEK_API_KEY`，baseline 为 1550/1551，原因是 `lib/model-listing.test.mjs` 断言无环境凭据时无可用模型）
- `grep -n "sunset" app/api/skills/route.ts` → 56
- 双轴 review：Standards 的 2 条硬项（注释语言、500 断言）已修复；Spec 无阻断项（详见票据 Answer）

## Merge Danger

**Door:** two-way — 无 schema、持久化格式或 API 形状变更；两条注释 + 三个测试文件，回滚即还原。

**Blast Radius:** narrow — 仅 `app/api/models-config`、`app/api/skills`、`app/api/plugins` 的测试面与注释；运行时行为不变。

## Closes

`.scratch/pi-sdk-rebuild/issues/13-sdk-storage-delegation.md`（本地票据，无 GitHub issue）
