import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

/**
 * 办公室频道改名兼容（i18n 内容层 ticket，forward-only 不迁移存量）：
 * 新名 = `secretary-office`；旧名（「秘书办公室」）只用于**查找既有频道**，
 * 旧名频道已存在时复用、不重复建，欢迎事件落在被复用的频道里。
 */

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "worksplice-secretary-legacy-office-"),
);
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  initSecretaryFlow,
  OFFICE_CHANNEL_NAME,
  LEGACY_OFFICE_CHANNEL_NAMES,
  isOfficeChannelName,
} = await import("./secretary-init.ts");
const { listChannels, isChannelMember } = await import("./channels.ts");
const { listMessages } = await import("./messages.ts");
const { SECRETARY_WELCOME_CONTENT } = await import("./event-messages.ts");

test("legacy office channel (旧名) is reused, not duplicated", () => {
  assert.equal(
    LEGACY_OFFICE_CHANNEL_NAMES.includes(OFFICE_CHANNEL_NAME),
    false,
    "the new name must not be listed as a legacy name",
  );
  const legacyName = LEGACY_OFFICE_CHANNEL_NAMES[0];
  assert.ok(legacyName, "legacy office channel names non-empty");
  const legacy = globalThis.__workspliceDb.insertChannel({
    name: legacyName,
    type: "private",
    description: "legacy office",
  });

  const susan = initSecretaryFlow({
    provider: "test-provider",
    modelId: "test-model",
    thinkingLevel: "low",
  });

  assert.equal(
    listChannels().filter((c) => c.name === OFFICE_CHANNEL_NAME).length,
    0,
    "no new-name office channel is created when a legacy one exists",
  );
  const legacyOffices = listChannels().filter((c) =>
    LEGACY_OFFICE_CHANNEL_NAMES.includes(c.name),
  );
  assert.equal(legacyOffices.length, 1, "no duplicate office channel");
  assert.equal(legacyOffices[0].id, legacy.id, "legacy office reused");
  assert.equal(isChannelMember(legacy.id, susan.id), true);
  assert.equal(isChannelMember(legacy.id, OWNER_MEMBER_ID), true);

  const page = listMessages(legacy.id);
  assert.equal(
    page.messages[page.messages.length - 1].content,
    SECRETARY_WELCOME_CONTENT,
    "welcome event lands in the reused legacy office channel",
  );
});

test("both names present -> nothing is created twice and membership is repaired", () => {
  const officeCountBefore = listChannels().filter((c) =>
    isOfficeChannelName(c.name),
  ).length;
  const newOffice = globalThis.__workspliceDb.insertChannel({
    name: OFFICE_CHANNEL_NAME,
    type: "private",
    description: "second office (edge case)",
  });

  const susan = globalThis.__workspliceDb
    .listMembers()
    .find((m) => m.type === "agent" && m.name === "Susan");
  const welcomeCountBefore = listMessages(newOffice.id).messages.length;

  initSecretaryFlow();

  const offices = listChannels().filter((c) => isOfficeChannelName(c.name));
  assert.equal(
    offices.length,
    officeCountBefore + 1,
    "re-run creates no additional office channel",
  );
  assert.equal(isChannelMember(newOffice.id, susan.id), true);
  assert.equal(
    listMessages(newOffice.id).messages.length,
    welcomeCountBefore,
    "no duplicate welcome in the untouched edge-case channel",
  );
});
