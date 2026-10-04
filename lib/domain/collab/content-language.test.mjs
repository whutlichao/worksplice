import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { BUILTIN_CHANNEL_ID } from "../../data/schema.ts";

/**
 * 内容层语言守卫（i18n 内容层 ticket）：产品自己生成、落库进房间 / 写进 agent 家目录 /
 * 进模型上下文的内容一律**英文硬编码**（与 reminder 系统消息同一先例），不得出现 CJK——
 * 本文件是防回潮守卫。分层规则见 docs/i18n.md：UI 文案走 i18n 包 / 产品内容英文硬编码 /
 * 注释与仓库文档中文 / 内部解析用字符串保留。
 */

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "worksplice-content-language-"),
);
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const CJK = /[\u4e00-\u9fff]/;

const { buildMemoryTemplate, MEMORY_FILE_NAME } = await import(
  "../../data/dirs.ts"
);
const {
  SUSAN_MEMBER_NAME,
  SECRETARY_WELCOME_CONTENT,
  notifySecretaryWelcome,
} = await import("./event-messages.ts");
const {
  OFFICE_CHANNEL_NAME,
  OFFICE_CHANNEL_DESCRIPTION,
  SUSAN_DESCRIPTION,
  SECRETARY_GUIDE_FILE_NAME,
  secretaryManualDir,
} = await import("./secretary-init.ts");
const { createAgent } = await import("./members.ts");
const { createChannel } = await import("./channels.ts");
const { listMessages } = await import("./messages.ts");

function lastMessage(targetId) {
  const page = listMessages(targetId);
  return page.messages[page.messages.length - 1];
}

test("agent home MEMORY outline is English (content layer)", () => {
  const withRole = buildMemoryTemplate("bob", "helper");
  const withoutRole = buildMemoryTemplate("bob", "");
  for (const [label, text] of [
    ["with description", withRole],
    ["without description", withoutRole],
  ]) {
    assert.doesNotMatch(text, CJK, `${label}: outline must stay CJK-free`);
  }
  assert.match(withRole, /^# bob/);
  assert.match(withRole, /## Role\n\nhelper/);
  assert.match(withRole, /## Current work/);
  assert.match(withRole, /## Workflow/);
  assert.match(withRole, /## Skills/);
  assert.match(withRole, /## Tools/);
  assert.match(withRole, /## Other/);
  assert.match(withoutRole, /## Role\n\n## Current work/);
});

test("event messages are English (content layer)", () => {
  createAgent({ name: SUSAN_MEMBER_NAME });
  createAgent({ name: "alice" });
  assert.equal(
    lastMessage(BUILTIN_CHANNEL_ID).content,
    "@Susan New member @alice joined the channel",
  );

  const channel = createChannel({ name: "language-guard" });
  assert.equal(
    lastMessage(channel.id).content,
    "@Susan New channel #language-guard created",
  );

  notifySecretaryWelcome(channel.id);
  assert.equal(
    lastMessage(channel.id).content,
    "@Susan Welcome aboard — this is your office channel",
  );
  assert.equal(
    SECRETARY_WELCOME_CONTENT,
    "@Susan Welcome aboard — this is your office channel",
  );

  for (const message of listMessages(channel.id).messages) {
    assert.doesNotMatch(message.content, CJK, `event message: ${message.content}`);
  }
});

test("secretary identity constants are English (product naming)", () => {
  assert.equal(OFFICE_CHANNEL_NAME, "secretary-office");
  assert.equal(OFFICE_CHANNEL_DESCRIPTION, "1:1 workspace for the secretary");
  assert.doesNotMatch(OFFICE_CHANNEL_NAME, CJK);
  assert.doesNotMatch(OFFICE_CHANNEL_DESCRIPTION, CJK);
  assert.doesNotMatch(SUSAN_DESCRIPTION, CJK);
});

test("secretary manual assets are English (whole-file CJK scan, doc-filename refs allowed)", () => {
  // 白名单：只放行「对 docs/ 下仓库文档的引用」里的文件名 token（文件名本身可能含 CJK）——
  // 先剔除这些 token 再扫描，行内其余 CJK（说明文字、示例内容）一律判失败。
  const docPathToken = /[^\s`()\[\]，。；：！？]*[\u4e00-\u9fff][^\s`]*\.(md|ts|tsx|mjs|js|json)\b/g;
  const manualDir = secretaryManualDir();
  for (const fileName of [MEMORY_FILE_NAME, SECRETARY_GUIDE_FILE_NAME]) {
    const text = fs.readFileSync(path.join(manualDir, fileName), "utf8");
    const offenders = text
      .split("\n")
      .map((line, index) => ({
        line: index + 1,
        text: line.replace(docPathToken, ""),
      }))
      .filter(({ text: stripped }) => CJK.test(stripped));
    assert.deepEqual(
      offenders,
      [],
      `${fileName} must not contain CJK (except doc filename references)`,
    );
  }
});
