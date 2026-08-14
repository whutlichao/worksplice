import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-secretary-auto-create-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  autoCreateSecretary,
  readDefaultModelFromSettings,
} = await import("./secretary-auto-create.ts");
const { SECRETARY_WELCOME_CONTENT, SUSAN_MEMBER_NAME } = await import("./event-messages.ts");
const { createChannel, listChannels, isChannelMember } = await import("./channels.ts");
const { deleteAgent } = await import("./members.ts");
const { listMessages } = await import("./messages.ts");
const { subscribeWake } = await import("./wake.ts");
const { OFFICE_CHANNEL_NAME, SECRETARY_GUIDE_FILE_NAME, secretaryManualDir } =
  await import("./secretary-init.ts");
const { MEMORY_FILE_NAME } = await import("../../data/dirs.ts");

const wakes = [];
const unsubscribe = subscribeWake((hint) => wakes.push(hint));
test.after(() => unsubscribe());

const configured = () => ({ provider: "test-provider", modelId: "test-model" });
const noModel = () => null;
const manualDir = secretaryManualDir();

function anySusanRow() {
  return globalThis.__workspliceDb.getMemberByName(SUSAN_MEMBER_NAME);
}

function liveSusan() {
  return globalThis.__workspliceDb
    .listMembers()
    .find((m) => m.name === SUSAN_MEMBER_NAME && m.type === "agent");
}

function offices() {
  return listChannels().filter((c) => c.name === OFFICE_CHANNEL_NAME);
}

function lastMessage(targetId) {
  const page = listMessages(targetId);
  return page.messages[page.messages.length - 1];
}

test("readDefaultModelFromSettings: configured settings -> pair", () => {
  const agentDir = path.join(root, "agent-settings");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-test", theme: "dark" }),
    "utf8",
  );
  assert.deepEqual(readDefaultModelFromSettings(agentDir), {
    provider: "openai",
    modelId: "gpt-test",
  });
});

test("readDefaultModelFromSettings: missing file / missing keys / bad json -> null", () => {
  const agentDir = path.join(root, "agent-settings-empty");
  fs.mkdirSync(agentDir, { recursive: true });
  assert.equal(readDefaultModelFromSettings(agentDir), null, "no settings.json");
  fs.writeFileSync(path.join(agentDir, "settings.json"), "{}", "utf8");
  assert.equal(readDefaultModelFromSettings(agentDir), null, "no default keys");
  fs.writeFileSync(path.join(agentDir, "settings.json"), "{ not json", "utf8");
  assert.equal(readDefaultModelFromSettings(agentDir), null, "bad json");
});

test("defaultModel null -> skip + server log, no state change, no error", () => {
  assert.equal(anySusanRow(), undefined);
  const logs = [];
  const original = console.warn;
  console.warn = (msg) => logs.push(String(msg));
  try {
    const outcome = autoCreateSecretary({ resolveDefaultModel: noModel });
    assert.deepEqual(outcome, { created: false, reason: "no-default-model" });
  } finally {
    console.warn = original;
  }
  assert.equal(anySusanRow(), undefined, "no member created");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /secretary auto-create skipped/);
  assert.equal(offices().length, 0, "no office channel created");
});

test("init failure -> throws before any state change (non-fatal by contract)", () => {
  const original = process.env.SECRETARY_MANUAL_DIR;
  process.env.SECRETARY_MANUAL_DIR = path.join(root, "no-such-manual-dir");
  try {
    assert.throws(
      () => autoCreateSecretary({ resolveDefaultModel: configured }),
      /Secretary manual asset missing/,
    );
  } finally {
    if (original === undefined) delete process.env.SECRETARY_MANUAL_DIR;
    else process.env.SECRETARY_MANUAL_DIR = original;
  }
  assert.equal(anySusanRow(), undefined, "no member created on failure");
});

test("first startup auto-creates Susan via the full init flow", () => {
  createChannel({ name: "public-room" });
  createChannel({ name: "private-room", type: "private" });
  wakes.length = 0;

  const outcome = autoCreateSecretary({ resolveDefaultModel: configured });
  assert.deepEqual(outcome, { created: true });

  // 身份：名字/描述落库，模型取 defaultModel，thinkingLevel 继承全局默认（null）
  const susan = liveSusan();
  assert.ok(susan, "Susan created");
  assert.equal(anySusanRow().id, susan.id);
  assert.equal(susan.deleted, 0);
  assert.equal(susan.model_provider, "test-provider");
  assert.equal(susan.model_id, "test-model");
  assert.equal(susan.thinking_level, null);
  assert.ok(susan.workspace_path, "home dir assigned");

  // 手册：MEMORY.md 速查 + SYSTEM-GUIDE.md 落盘（内容 = 02/03 内容资产逐字节）
  const memory = fs.readFileSync(path.join(susan.workspace_path, MEMORY_FILE_NAME), "utf8");
  const guide = fs.readFileSync(path.join(susan.workspace_path, SECRETARY_GUIDE_FILE_NAME), "utf8");
  assert.equal(memory, fs.readFileSync(path.join(manualDir, MEMORY_FILE_NAME), "utf8"));
  assert.equal(guide, fs.readFileSync(path.join(manualDir, SECRETARY_GUIDE_FILE_NAME), "utf8"));

  // 频道覆盖 + 办公室频道（私有，成员 = Owner + 秘书）+ 欢迎事件（Owner 署名 + 定向唤醒）
  for (const channel of listChannels()) {
    assert.equal(isChannelMember(channel.id, susan.id), true, `channel ${channel.name}`);
  }
  assert.equal(offices().length, 1);
  assert.equal(offices()[0].type, "private");
  assert.equal(isChannelMember(offices()[0].id, OWNER_MEMBER_ID), true);
  const msg = lastMessage(offices()[0].id);
  assert.equal(msg.author_id, OWNER_MEMBER_ID);
  assert.equal(msg.content, SECRETARY_WELCOME_CONTENT);
  assert.deepEqual(wakes, [
    { agentId: susan.id, targetId: offices()[0].id, seq: msg.seq, reason: "message" },
  ]);
});

test("repeated startup -> skip, no recreate, no duplicate welcome", () => {
  const first = liveSusan();
  const office = offices()[0];
  const beforeMsgs = listMessages(office.id).messages.length;
  wakes.length = 0;

  const outcome = autoCreateSecretary({ resolveDefaultModel: configured });
  assert.deepEqual(outcome, { created: false, reason: "exists" });
  assert.equal(liveSusan().id, first.id, "same identity");
  assert.equal(offices().length, 1);
  assert.equal(listMessages(office.id).messages.length, beforeMsgs, "no duplicate welcome");
  assert.deepEqual(wakes, []);
});

test("soft-deleted Susan -> skip, never auto-recreated", () => {
  const deleted = liveSusan();
  const office = offices()[0];
  const beforeMsgs = listMessages(office.id).messages.length;
  deleteAgent(deleted.id);
  assert.equal(liveSusan(), undefined, "soft-deleted Susan not visible");
  assert.equal(anySusanRow().deleted, 1, "raw row kept with deleted flag");
  wakes.length = 0;

  const outcome = autoCreateSecretary({ resolveDefaultModel: configured });
  assert.deepEqual(outcome, { created: false, reason: "exists" });
  assert.equal(anySusanRow().id, deleted.id, "no fresh identity");
  assert.equal(anySusanRow().deleted, 1);
  assert.equal(offices().length, 1);
  assert.equal(listMessages(office.id).messages.length, beforeMsgs, "no new welcome");
  assert.deepEqual(wakes, []);
});
