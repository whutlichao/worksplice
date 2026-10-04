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
