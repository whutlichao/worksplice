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

const store = openDataDb(fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-dm-")));
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
    listChannelMembers(dm.id).map((m) => m.id).sort(),
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

test("isDM detects dm channels; getDMFor resolves an agent's dm", () => {
  const a = createAgent({ name: "grace" });
  const dm = getDMFor(a.id);
  assert.ok(dm, "agent has a dm");
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
  const dm = getDMFor(a.id);
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
    listChannelMembers(dm.id).map((m) => m.id).sort(),
    [OWNER_MEMBER_ID, a.id].sort(),
  );
});

test("createAgent auto-creates its DM (alongside joining #all)", () => {
  const a = createAgent({ name: "eve" });
  const dm = getDMFor(a.id);
  assert.ok(dm, "dm exists after createAgent");
  assert.equal(dm.type, "dm");
  assert.equal(dm.id, `${DM_ID_PREFIX}eve`);
  assert.ok(store.isChannelMember(BUILTIN_CHANNEL_ID, a.id), "agent still auto-joins #all");
  assert.ok(store.isChannelMember(dm.id, a.id), "agent is a dm member");
  assert.ok(store.isChannelMember(dm.id, OWNER_MEMBER_ID), "owner is a dm member");
});

test("migration backfills DMs for existing non-deleted agents idempotently", () => {
  // 模拟存量 agent（数据层直插，无 DM），重启（runMigrations）补齐
  const raw = store.insertMember({ type: "agent", name: "backfill-me" });
  assert.equal(getDMFor(raw.id), undefined);

  runMigrations(store.db);
  const dm = getDMFor(raw.id);
  assert.ok(dm, "dm backfilled by migration");
  assert.equal(dm.type, "dm");
  assert.deepEqual(
    listChannelMembers(dm.id).map((m) => m.id).sort(),
    [OWNER_MEMBER_ID, raw.id].sort(),
  );

  // 幂等：再跑一次不产生第二条
  runMigrations(store.db);
  assert.equal(listChannels().filter((c) => c.id === dm.id).length, 1);
});

test("deleteAgent keeps the DM readable but not writable", () => {
  const a = createAgent({ name: "frank" });
  const dm = getDMFor(a.id);
  sendMessage({ targetId: dm.id, authorId: OWNER_MEMBER_ID, content: "hi frank" });
  assert.equal(store.maxSeq(dm.id), 1, "dm is writable before delete");

  deleteAgent(a.id);

  // 可读：channel 行保留、消息可读
  const row = getChannel(dm.id);
  assert.ok(row, "dm row kept after soft-delete");
  assert.equal(row.type, "dm");
  assert.equal(store.listMessages(dm.id).length, 1, "dm messages kept");

  // 不可写：owner 再发消息抛错（DM 已归档 → read-only）
  assert.throws(
    () => sendMessage({ targetId: dm.id, authorId: OWNER_MEMBER_ID, content: "again" }),
    /read-only|archived/i,
  );
  assert.throws(() => getAgent(a.id), /not found/i, "agent itself is gone");
});
