import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";

/**
 * 票 #241：SDK compaction 默认值核验（不新增应用层 compaction 配置）。
 *
 * 来源是**已安装**的 pi-coding-agent 1.5.2：
 * - `dist/core/compaction/compaction.js` 的 `DEFAULT_COMPACTION_SETTINGS`
 * - `dist/core/settings-defaults.js` 的 `SETTINGS_DEFAULTS.compaction`
 * 两者同值；这里经包的公共导出读取，避免把源码行号当运行期契约。
 */
const sdkPackage = JSON.parse(
  readFileSync(
    new URL("../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url),
    "utf8",
  ),
);

test("SDK 1.5.2 compaction defaults are enabled / reserve 16384 / keepRecent 20000", () => {
  assert.equal(sdkPackage.version, "1.5.2", "核验对象是当前安装的 1.5.2");
  assert.deepEqual(DEFAULT_COMPACTION_SETTINGS, {
    enabled: true,
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
  });
});
