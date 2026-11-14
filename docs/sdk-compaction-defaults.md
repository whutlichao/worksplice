# SDK compaction 默认值核验（pi-coding-agent 1.5.2）

> 票 #241 的核验记录。只记录已安装 SDK 的事实，不新增应用层 compaction 配置，也不编造 token 节省数字。

## 核验对象

- 包：`@earendil-works/pi-coding-agent@1.5.2`（`package.json` 精确锁定，安装产物在 `node_modules/`）
- 核验日期：2026-11-14

## 来源与读数

- 公共导出：`DEFAULT_COMPACTION_SETTINGS`（`dist/index.d.ts` / `dist/index.js`）
- 源码同值：
  - `dist/core/compaction/compaction.js` 的 `DEFAULT_COMPACTION_SETTINGS`
  - `dist/core/settings-defaults.js` 的 `SETTINGS_DEFAULTS.compaction`
- 默认值：
  - `enabled: true`
  - `reserveTokens: 16384`
  - `keepRecentTokens: 20000`

可执行核验见 `lib/sdk-compaction-defaults.test.mjs`：它从已安装包的公共导出读取三者并逐字断言，同时固定核验版本为 1.5.2。

## 边界

- worksplice 不覆写这些默认值、不写用户 `settings.json`、不复制 SDK 的 compaction 实现，也不新增 reset / 摘要表。
- 压缩状态复用只读统计口径：`lib/session-stats.ts` 的 `compactionCount` / `compactionTokens`，经可观测面板展示。
- 本记录不附带 token 节省估算：没有实测依据，不编造数字。
