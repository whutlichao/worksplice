import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID, DM_ID_PREFIX } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-secretary-init-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  initSecretaryFlow,
  OFFICE_CHANNEL_NAME,
  SUSAN_DESCRIPTION,
  SECRETARY_GUIDE_FILE_NAME,
  secretaryManualDir,
} = await import("./secretary-init.ts");
const { SECRETARY_WELCOME_CONTENT, SUSAN_MEMBER_NAME } = await import("./event-messages.ts");
const { createChannel, listChannels, isChannelMember, leaveChannel } =
  await import("./channels.ts");
const { createAgent, deleteAgent } = await import("./members.ts");
const { listMessages } = await import("./messages.ts");
const { subscribeWake } = await import("./wake.ts");
const { MEMORY_FILE_NAME } = await import("../../data/dirs.ts");

const wakes = [];
const unsubscribe = subscribeWake((hint) => wakes.push(hint));
test.after(() => unsubscribe());

/** 存活秘书（init 判定与 findSusanMember 同源：listMembers 已过滤软删）。 */
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

const manualDir = secretaryManualDir();

test("manual assets exist (fixture): MEMORY.md + SYSTEM-GUIDE.md", () => {
  assert.equal(fs.existsSync(path.join(manualDir, MEMORY_FILE_NAME)), true);
  assert.equal(fs.existsSync(path.join(manualDir, SECRETARY_GUIDE_FILE_NAME)), true);
});

test("full init: identity + manual rewrite + channel coverage + office channel + welcome event", () => {
  // 前置：一个"空办公室频道"（无成员）模拟部分失败残留 + 若干频道/agent（Susan 尚不存在 → 均静默）
  const officeSeed = globalThis.__workspliceDb.insertChannel({
    name: OFFICE_CHANNEL_NAME,
    type: "private",
    description: "seed",
  });
  createChannel({ name: "public-room" });
  createChannel({ name: "private-room", type: "private" });
  createAgent({ name: "zoe" });
  wakes.length = 0;

  const susan = initSecretaryFlow({
    provider: "test-provider",
    modelId: "test-model",
    thinkingLevel: "max",
  });

  // ① 身份与家目录：createAgent 契约（provider/modelId/thinkingLevel 落库、家目录 + 描述）
  assert.equal(susan.name, "Susan");
  assert.equal(susan.description, SUSAN_DESCRIPTION);
  assert.equal(susan.model_provider, "test-provider");
  assert.equal(susan.model_id, "test-model");
  assert.equal(susan.thinking_level, "max");
  assert.ok(susan.workspace_path, "home dir assigned");
  assert.equal(liveSusan().id, susan.id);

  // ② 手册重写：MEMORY.md 整体重写为速查结构（含"当前工作"节名），SYSTEM-GUIDE.md 首次落盘，
  //    内容 = 02/03 内容资产逐字节一致
  const memoryAsset = fs.readFileSync(path.join(manualDir, MEMORY_FILE_NAME), "utf8");
  const guideAsset = fs.readFileSync(path.join(manualDir, SECRETARY_GUIDE_FILE_NAME), "utf8");
  const memory = fs.readFileSync(path.join(susan.workspace_path, MEMORY_FILE_NAME), "utf8");
  const guide = fs.readFileSync(path.join(susan.workspace_path, SECRETARY_GUIDE_FILE_NAME), "utf8");
  assert.equal(memory, memoryAsset);
  assert.equal(guide, guideAsset);
  assert.ok(memory.includes("## 1. 身份与开口规则"));
  assert.ok(memory.includes("### 当前工作"), '"当前工作" 节名保留（ADR-0001 兼容）');
  assert.ok(guide.includes("# Susan — worksplice 系统手册"));

  // ③ 频道覆盖：全部现存频道（公开 + 私有）+ #all；静默（无任何加入事件/唤醒他人）。
  //    DM 不覆盖：成员创建时定死（owner + 1 agent），秘书只在自己 DM 内、不加入他人 DM（§R2）。
  for (const channel of listChannels()) {
    if (channel.type === "dm") continue;
    assert.equal(isChannelMember(channel.id, susan.id), true, `channel ${channel.name}`);
  }
  assert.equal(
    isChannelMember(`${DM_ID_PREFIX}${SUSAN_MEMBER_NAME}`, susan.id),
    true,
    "secretary is a member of her own dm",
  );
  assert.equal(isChannelMember(officeSeed.id, susan.id), true);
  assert.equal(isChannelMember(officeSeed.id, OWNER_MEMBER_ID), true);

  // ④ 办公室频道幂等：种子频道被复用（不重复建）、私有、成员 = Owner + 秘书
  assert.equal(offices().length, 1);
  assert.equal(offices()[0].id, officeSeed.id, "pre-existing office channel reused");
  assert.equal(offices()[0].type, "private");

  // ⑤ 欢迎事件：Owner 署名 + wake:false + 仅定向唤醒秘书；其他频道/agent 全程静默
  const msg = lastMessage(officeSeed.id);
  assert.equal(msg.author_id, OWNER_MEMBER_ID);
  assert.equal(msg.content, SECRETARY_WELCOME_CONTENT);
  assert.deepEqual(wakes, [
    { agentId: susan.id, targetId: officeSeed.id, seq: msg.seq, reason: "message" },
  ]);
  for (const channel of listChannels()) {
    if (channel.id === officeSeed.id) continue;
    assert.equal(listMessages(channel.id).messages.length, 0, `channel ${channel.name} silent`);
  }
  assert.equal(isChannelMember(BUILTIN_CHANNEL_ID, susan.id), true);
});

test("re-run is idempotent: identity reused, office reused, no duplicate welcome", () => {
  const first = liveSusan();
  const office = offices()[0];
  const beforeMsgs = listMessages(office.id).messages.length;
  wakes.length = 0;

  const second = initSecretaryFlow({ provider: "other", modelId: "other", thinkingLevel: "low" });

  assert.equal(second.id, first.id, "no duplicate identity");
  assert.equal(second.model_provider, "test-provider", "model config not overwritten");
  assert.equal(offices().length, 1, "office channel not duplicated");
  assert.equal(listMessages(office.id).messages.length, beforeMsgs, "no duplicate welcome");
  assert.deepEqual(wakes, []);
  const memory = fs.readFileSync(path.join(second.workspace_path, MEMORY_FILE_NAME), "utf8");
  assert.ok(memory.includes("### 当前工作"));
});

test("deleted Susan -> rebuild creates a fresh identity, reuses office, welcomes the new Susan", () => {
  const old = liveSusan();
  const office = offices()[0];
  deleteAgent(old.id);
  assert.equal(liveSusan(), undefined);
  wakes.length = 0;

  const susan = initSecretaryFlow();

  assert.ok(susan.id !== old.id, "fresh identity after soft-delete");
  assert.equal(susan.deleted, 0);
  assert.equal(offices().length, 1, "office channel reused");
  assert.equal(isChannelMember(office.id, susan.id), true);
  const msg = lastMessage(office.id);
  assert.equal(msg.author_id, OWNER_MEMBER_ID);
  assert.equal(msg.content, SECRETARY_WELCOME_CONTENT);
  assert.deepEqual(wakes, [
    { agentId: susan.id, targetId: office.id, seq: msg.seq, reason: "message" },
  ]);
  const memory = fs.readFileSync(path.join(susan.workspace_path, MEMORY_FILE_NAME), "utf8");
  assert.ok(memory.includes("### 当前工作"));
});

test("re-run after rebuild: office already has messages -> welcome not duplicated", () => {
  const susan = liveSusan();
  const office = offices()[0];
  const beforeMsgs = listMessages(office.id).messages.length;
  wakes.length = 0;

  initSecretaryFlow();

  assert.equal(listMessages(office.id).messages.length, beforeMsgs);
  assert.deepEqual(wakes, []);
  assert.equal(isChannelMember(office.id, susan.id), true);
});

test("office channel without Susan member is repaired silently on re-run", () => {
  const susan = liveSusan();
  const office = offices()[0];
  leaveChannel(office.id, susan.id, OWNER_MEMBER_ID); // 模拟秘书被移出办公室（部分失败/人为移除）
  assert.equal(isChannelMember(office.id, susan.id), false);
  wakes.length = 0;

  initSecretaryFlow();

  assert.equal(isChannelMember(office.id, susan.id), true, "membership repaired");
  assert.equal(offices().length, 1);
  assert.deepEqual(wakes, []);
});

test("missing manual assets -> throws before any state change (retry-safe)", () => {
  const beforeMembers = globalThis.__workspliceDb.listMembers().length;
  const beforeChannels = listChannels().length;
  const beforeOfficeMsgs = listMessages(offices()[0].id).messages.length;
  const original = process.env.SECRETARY_MANUAL_DIR;
  process.env.SECRETARY_MANUAL_DIR = path.join(root, "no-such-manual-dir");
  try {
    assert.throws(() => initSecretaryFlow(), /Secretary manual asset missing/);
  } finally {
    if (original === undefined) delete process.env.SECRETARY_MANUAL_DIR;
    else process.env.SECRETARY_MANUAL_DIR = original;
  }
  assert.equal(globalThis.__workspliceDb.listMembers().length, beforeMembers);
  assert.equal(listChannels().length, beforeChannels);
  assert.equal(listMessages(offices()[0].id).messages.length, beforeOfficeMsgs);
});
