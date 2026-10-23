import assert from "node:assert/strict";
import test from "node:test";

/**
 * UI 文案分层守卫（i18n 内容层 ticket）：本次从组件里迁进 i18n 包的键必须在
 * en / zh-CN 两套语言包同时存在——防止"只加了一套"或退回硬编码。
 * （不校验两包整体键集对等：存量包本就不等长，本次不动既有文案。）
 */

const { enLocale } = await import("./messages/en.ts");
const { zhCNLocale } = await import("./messages/zh-CN.ts");

test("skills project-directory label exists in both packages", () => {
  assert.equal(
    enLocale.messages["i18n.projectDirectoryPath"],
    ".pi/skills/ (project directory)",
  );
  assert.equal(
    zhCNLocale.messages["i18n.projectDirectoryPath"],
    ".pi/skills/（项目目录）",
  );
});

/**
 * agent 生命周期按钮回归守卫：中文界面下的重启 / 会话重置 / 完整重置及其直接
 * 提示文案必须是中文，不得回退成 en 包里的英文值。
 */
test("agent lifecycle labels are localized in zh-CN", () => {
  const expected = {
    "agent.restart": "重启",
    "agent.sessionReset": "会话重置",
    "agent.fullReset": "完整重置",
    "agent.fullResetSharedHint":
      "当前绑定共享项目目录，完整重置不可用（请用会话重置）",
    "agent.stoppedHint": "离线 = 已停止响应，身份仍在；可随时重启激活",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(zhCNLocale.messages[key], value, `${key} 应为中文文案`);
    assert.doesNotMatch(
      zhCNLocale.messages[key],
      /Restart|Session reset|Full reset/,
      `${key} 不应含英文原文`,
    );
  }
});
