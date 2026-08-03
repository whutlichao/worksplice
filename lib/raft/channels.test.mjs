import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } from "../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-channels-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createChannel,
  joinChannel,
  leaveChannel,
  setChannelArchived,
  listChannelMembers,
  listChannelsWithMeta,
} = await import("./channels.ts");
const { createAgent } = await import("./members.ts");

function agentName(i) {
  return `worker-${i}`;
}

test("createChannel auto-joins the owner and any initial members", () => {
  const a = createAgent({ name: agentName(1) });
  const channel = createChannel({
    name: "general",
    type: "public",
    description: "chat",
    memberIds: [a.id],
  });

  assert.deepEqual(
    listChannelMembers(channel.id).map((m) => m.id).sort(),
    [OWNER_MEMBER_ID, a.id].sort(),
    "owner + initial members must be members",
  );
  const agentRow = globalThis.__workspliceDb.getMember(a.id);
  assert.ok(agentRow);
});

test("new agents are auto-joined to #all", () => {
  const a = createAgent({ name: agentName(2) });
  assert.equal(globalThis.__workspliceDb.isChannelMember(BUILTIN_CHANNEL_ID, a.id), true);
  assert.equal(globalThis.__workspliceDb.isChannelMember(BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID), true);
});

test("public channels allow any member to join; joining twice is idempotent", () => {
  const channel = createChannel({ name: "pub" });
  const a = createAgent({ name: agentName(3) });

  joinChannel(channel.id, a.id, a.id);
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, a.id), true);

  joinChannel(channel.id, a.id, a.id);
  assert.deepEqual(
    listChannelMembers(channel.id).map((m) => m.id).sort(),
    [OWNER_MEMBER_ID, a.id].sort(),
  );
});

test("adding another member to a public channel is owner-only; self-join is free", () => {
  const channel = createChannel({ name: "pub2" });
  const a = createAgent({ name: agentName(3.5) });
  const b = createAgent({ name: agentName(3.6) });

  assert.throws(() => joinChannel(channel.id, b.id, a.id), /Only the owner can add other members/);
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, b.id), false);

  joinChannel(channel.id, b.id, b.id);
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, b.id), true);
});

test("#all cannot be archived", () => {
  assert.throws(() => setChannelArchived(BUILTIN_CHANNEL_ID, 1, OWNER_MEMBER_ID), /#all/);
  assert.equal(globalThis.__workspliceDb.getChannel(BUILTIN_CHANNEL_ID).archived, 0);
});

test("private channels can only be joined by the owner", () => {
  const channel = createChannel({ name: "priv", type: "private" });
  const a = createAgent({ name: agentName(4) });

  assert.throws(
    () => joinChannel(channel.id, a.id, a.id),
    /Only the owner can add members to a private channel/,
  );
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, a.id), false);

  joinChannel(channel.id, a.id, OWNER_MEMBER_ID);
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, a.id), true);
});

test("joinChannel rejects unknown channels and members", () => {
  const a = createAgent({ name: agentName(5) });
  assert.throws(() => joinChannel("no-such-channel", a.id, OWNER_MEMBER_ID), /Channel not found/);
  assert.throws(() => joinChannel(BUILTIN_CHANNEL_ID, "no-such-member", OWNER_MEMBER_ID), /Member not found/);
});

test("leaveChannel: cannot leave #all; non-members and guests cannot leave others", () => {
  const a = createAgent({ name: agentName(6) });
  const b = createAgent({ name: agentName(7) });
  const channel = createChannel({ name: "team", memberIds: [a.id, b.id] });

  assert.throws(() => leaveChannel(BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID, OWNER_MEMBER_ID), /#all/);

  leaveChannel(channel.id, a.id, a.id);
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, a.id), false);

  assert.throws(() => leaveChannel(channel.id, b.id, a.id), /Only the owner can remove other members/);
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, b.id), true);

  leaveChannel(channel.id, b.id, OWNER_MEMBER_ID);
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, b.id), false);

  assert.throws(() => leaveChannel(channel.id, b.id, b.id), /Not a member/);
});

test("archive/unarchive is owner-only and idempotent", () => {
  const a = createAgent({ name: agentName(8) });
  const channel = createChannel({ name: "ops" });

  assert.throws(() => setChannelArchived(channel.id, 1, a.id), /Only the owner/);
  setChannelArchived(channel.id, 1, OWNER_MEMBER_ID);
  assert.equal(globalThis.__workspliceDb.getChannel(channel.id).archived, 1);
  setChannelArchived(channel.id, 1, OWNER_MEMBER_ID);
  assert.equal(globalThis.__workspliceDb.getChannel(channel.id).archived, 1);
  setChannelArchived(channel.id, 0, OWNER_MEMBER_ID);
  assert.equal(globalThis.__workspliceDb.getChannel(channel.id).archived, 0);
});

test("listChannelsWithMeta reports joined flags and member counts per member", () => {
  const a = createAgent({ name: agentName(9) });
  const joined = createChannel({ name: "joined", memberIds: [a.id] });
  const untouched = createChannel({ name: "untouched" });

  const meta = listChannelsWithMeta(a.id);
  const joinedRow = meta.find((m) => m.id === joined.id);
  const untouchedRow = meta.find((m) => m.id === untouched.id);
  const allRow = meta.find((m) => m.id === BUILTIN_CHANNEL_ID);

  assert.equal(joinedRow.joined, true);
  assert.equal(joinedRow.memberCount, 2);
  assert.equal(untouchedRow.joined, false);
  assert.equal(untouchedRow.memberCount, 1);
  assert.equal(allRow.joined, true);
});
