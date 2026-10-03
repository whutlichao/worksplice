import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import {
  runMigrations,
  BUILTIN_CHANNEL_ID,
  OWNER_MEMBER_ID,
  DM_ID_PREFIX,
} from "../../data/schema.ts";

const store = openDataDb(
  fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-dm-")),
);
globalThis.__workspliceDb = store;
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(store.paths.dataDir, { recursive: true, force: true });
});

const {
  createChannel,
  createDirectChannel,
  isDM,
  getDMFor,
  joinChannel,
  leaveChannel,
  setChannelArchived,
  muteChannel,
  unmuteChannel,
  listChannels,
  listChannelMembers,
  getChannel,
} = await import("./channels.ts");
const { createAgent, deleteAgent, getAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");

test("createDirectChannel creates a dm channel with owner + agent fixed membership", () => {
  // 数据层直插 agent（绕过 createAgent 的自动建 DM），验证 createDirectChannel 本身创建逻辑
  const raw = store.insertMember({ type: "agent", name: "raw-alice" });
  assert.equal(getDMFor(raw.id), undefined, "no dm before createDirectChannel");

  const dm = createDirectChannel(raw.id);
  assert.equal(dm.type, "dm");
  assert.equal(dm.id, `${DM_ID_PREFIX}raw-alice`);
  assert.equal(dm.name, `${DM_ID_PREFIX}raw-alice`);
  assert.deepEqual(
    listChannelMembers(dm.id)
      .map((m) => m.id)
      .sort(),
    [OWNER_MEMBER_ID, raw.id].sort(),
    "dm membership is exactly owner + 1 agent",
  );

  // 幂等：重复创建返回既有 DM，不产生第二条
  const again = createDirectChannel(raw.id);
  assert.equal(again.id, dm.id);
  assert.equal(listChannels().filter((c) => c.id === dm.id).length, 1);
});

test("createDirectChannel rejects non-agents", () => {
  assert.throws(() => createDirectChannel("no-such-id"), /Agent not found/);
  assert.throws(() => createDirectChannel(OWNER_MEMBER_ID), /Agent not found/);
});

test("isDM detects dm channels; getDMFor resolves an agent's dm after lazy create", () => {
  const a = createAgent({ name: "grace" });
  assert.equal(
    getDMFor(a.id),
    undefined,
    "lazy create: no dm until the send-message entry opens it",
  );
  const dm = createDirectChannel(a.id);
  assert.equal(dm.type, "dm");
  assert.equal(isDM(dm.id), true);
  assert.equal(isDM(BUILTIN_CHANNEL_ID), false);
  assert.equal(isDM("no-such-channel"), false);
  assert.equal(getDMFor("no-such-id"), undefined);
  assert.equal(getDMFor(OWNER_MEMBER_ID), undefined, "owner (human) has no dm");
});

test("createChannel rejects type='dm' (use createDirectChannel)", () => {
  assert.throws(() => createChannel({ name: "sneaky", type: "dm" }), /DM|dm/);
});

test("DM rejects join / leave / archive / mute regardless of actor", () => {
  const a = createAgent({ name: "carol" });
  const dm = createDirectChannel(a.id);
  const other = createAgent({ name: "dave" });

  assert.throws(() => joinChannel(dm.id, other.id, other.id), /DM|dm/);
  assert.throws(() => joinChannel(dm.id, other.id, OWNER_MEMBER_ID), /DM|dm/);
  assert.throws(() => leaveChannel(dm.id, a.id, a.id), /DM|dm/);
  assert.throws(() => leaveChannel(dm.id, a.id, OWNER_MEMBER_ID), /DM|dm/);
  assert.throws(() => setChannelArchived(dm.id, 1, OWNER_MEMBER_ID), /DM|dm/);
  assert.throws(() => muteChannel(dm.id, a.id, a.id), /DM|dm/);
  assert.throws(() => muteChannel(dm.id, a.id, OWNER_MEMBER_ID), /DM|dm/);
  assert.throws(() => unmuteChannel(dm.id, a.id, a.id), /DM|dm/);

  // 被拒后状态不变：仍是非归档、仅两人
  assert.equal(getChannel(dm.id).archived, 0);
  assert.deepEqual(
    listChannelMembers(dm.id)
      .map((m) => m.id)
      .sort(),
    [OWNER_MEMBER_ID, a.id].sort(),
  );
});

test("createAgent no longer auto-creates a DM (lazy create); still auto-joins #all", () => {
  const a = createAgent({ name: "eve" });
  assert.equal(getDMFor(a.id), undefined, "no dm after createAgent");
  assert.ok(
    store.isChannelMember(BUILTIN_CHANNEL_ID, a.id),
    "agent still auto-joins #all",
  );
});

test("migration deletes empty DMs (with their channel_members) and keeps non-empty DMs idempotently", () => {
  // 模拟存量空 DM + 有消息 DM（数据层直插 agent 后显式建 DM），重启（runMigrations）清理
  const emptyAgent = store.insertMember({
    type: "agent",
    name: "cleanup-empty",
  });
  const msgAgent = store.insertMember({ type: "agent", name: "cleanup-msg" });
  const emptyDm = createDirectChannel(emptyAgent.id);
  const msgDm = createDirectChannel(msgAgent.id);
  sendMessage({
    targetId: msgDm.id,
    authorId: OWNER_MEMBER_ID,
    content: "kept message",
  });
  assert.ok(getChannel(emptyDm.id), "empty dm exists before migration");
  assert.ok(
    store.isChannelMember(emptyDm.id, emptyAgent.id),
    "empty dm membership exists before migration",
  );

  runMigrations(store.db);

  assert.equal(
    getChannel(emptyDm.id),
    undefined,
    "empty dm deleted by migration",
  );
  assert.equal(
    store.listChannelMembers(emptyDm.id).length,
    0,
    "empty dm membership rows deleted",
  );
  assert.ok(getChannel(msgDm.id), "dm with a message kept");
  assert.equal(store.maxSeq(msgDm.id), 1, "kept dm message intact");

  // 幂等：再跑一次，有消息 DM 仍保留，空 DM 不复活
  runMigrations(store.db);
  assert.ok(getChannel(msgDm.id), "non-empty dm kept after re-run");
  assert.equal(
    getChannel(emptyDm.id),
    undefined,
    "empty dm stays deleted after re-run",
  );
});

test("deleteAgent keeps the DM readable but not writable", () => {
  const a = createAgent({ name: "frank" });
  const dm = createDirectChannel(a.id);
  sendMessage({
    targetId: dm.id,
    authorId: OWNER_MEMBER_ID,
    content: "hi frank",
  });
  assert.equal(store.maxSeq(dm.id), 1, "dm is writable before delete");

  deleteAgent(a.id);

  // 可读：channel 行保留、消息可读
  const row = getChannel(dm.id);
  assert.ok(row, "dm row kept after soft-delete");
  assert.equal(row.type, "dm");
  assert.equal(store.listMessages(dm.id).length, 1, "dm messages kept");

  // 不可写：owner 再发消息抛错（DM 已归档 → read-only）
  assert.throws(
    () =>
      sendMessage({
        targetId: dm.id,
        authorId: OWNER_MEMBER_ID,
        content: "again",
      }),
    /read-only|archived/i,
  );
  assert.throws(() => getAgent(a.id), /not found/i, "agent itself is gone");
});

test("deleteAgent of an agent without a DM does not crash (lazy create)", () => {
  const a = createAgent({ name: "no-dm" });
  assert.equal(getDMFor(a.id), undefined, "no dm exists for this agent");
  deleteAgent(a.id); // 不应抛错：getDMFor 返回 undefined 时跳过归档
  assert.throws(() => getAgent(a.id), /not found/i);
});

test("deleteAgent does not archive another agent's DM", () => {
  const keeper = createAgent({ name: "dm-keeper" });
  const keeperDm = createDirectChannel(keeper.id);
  const goner = createAgent({ name: "dm-goner" });

  deleteAgent(goner.id);

  assert.equal(
    getChannel(keeperDm.id).archived,
    0,
    "unrelated agent's dm untouched",
  );
});
