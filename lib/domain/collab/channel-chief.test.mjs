import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";

/**
 * 频道首席（票 #250）：绑定校验 + 「此刻生效的首席是谁」三档解析 + 列表读面。
 *
 * 接缝 = 协作域服务层 + 真实临时 SQLite：只断言「谁能绑定谁」「解析结果是哪一档」，
 * 不碰会话 / wake / 私有字段。行为面（会话、游标、handoff 优先级）由
 * `lib/agent-loop/channel-chief-round.test.mjs` 覆盖，HTTP 面由 `channel-chief-route.test.mjs`。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-channel-chief-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  ChannelChiefError,
  createAgent,
  createChannel,
  createTask,
  deleteAgent,
  joinChannel,
  leaveChannel,
  listChannelsWithMeta,
  resolveEffectiveChief,
  selectChiefRecipient,
  selectMessageInvitations,
  sendMessage,
  setChannelChief,
  setGlobalChief,
} = await import("./index.ts");
const { OWNER_MEMBER_ID } = await import("../../data/schema.ts");

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

function makeAgent(prefix, { join = null } = {}) {
  const agent = createAgent({ name: unique(prefix) });
  if (join) joinChannel(join, agent.id);
  return agent;
}

function boundChiefId(channelId) {
  return globalThis.__workspliceDb.getChannel(channelId)?.chief_member_id ?? null;
}

/** 断言拒绝 + 错误码/状态 + 「不留半条绑定」。 */
function assertRejected(channelId, action, { status, code, match }) {
  const before = boundChiefId(channelId);
  let thrown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ChannelChiefError, `应抛 ChannelChiefError，实际：${thrown}`);
  assert.equal(thrown.status, status);
  assert.equal(thrown.code, code);
  assert.match(thrown.message, match, "拒绝原因是可读英文");
  assert.equal(boundChiefId(channelId), before, "被拒绝时不写绑定");
}

test("三档解析：频道首席 → 全局首席 → 无，且能区分来源", () => {
  const globalChief = makeAgent("tier-global");
  setGlobalChief(globalChief.id);
  const channel = createChannel({ name: unique("tier-room") });
  const localChief = makeAgent("tier-local", { join: channel.id });

  // 第三档：没有频道首席，全局首席兜底。
  assert.deepEqual(
    (({ chief, source }) => ({ id: chief?.id ?? null, source }))(resolveEffectiveChief(channel.id)),
    { id: globalChief.id, source: "global" },
  );

  // 第一档：频道首席优先于全局首席。
  setChannelChief(channel.id, localChief.id);
  assert.deepEqual(
    (({ chief, source }) => ({ id: chief?.id ?? null, source }))(resolveEffectiveChief(channel.id)),
    { id: localChief.id, source: "channel" },
  );

  // 另一个频道不受影响：仍是回落全局。
  const otherRoom = createChannel({ name: unique("tier-other-room") });
  assert.deepEqual(
    (({ chief, source }) => ({ id: chief?.id ?? null, source }))(resolveEffectiveChief(otherRoom.id)),
    { id: globalChief.id, source: "global" },
  );

  // 清空频道首席 → 回落全局。
  setChannelChief(channel.id, null);
  assert.equal(resolveEffectiveChief(channel.id).source, "global");
  assert.equal(resolveEffectiveChief(channel.id).chief?.id, globalChief.id);

  // 全局也清空 → 无。
  setGlobalChief(null);
  assert.deepEqual(resolveEffectiveChief(channel.id), { chief: null, source: "none" });
});

test("频道首席离开频道 / 被软删 / 不是 agent：按「未设置」回落到全局，且不改写绑定", () => {
  const globalChief = makeAgent("fallback-global");
  setGlobalChief(globalChief.id);

  // 离场
  const channel = createChannel({ name: unique("fallback-left-room") });
  const localChief = makeAgent("fallback-left", { join: channel.id });
  setChannelChief(channel.id, localChief.id);
  assert.equal(resolveEffectiveChief(channel.id).source, "channel");
  leaveChannel(channel.id, localChief.id);
  const afterLeave = resolveEffectiveChief(channel.id);
  assert.equal(afterLeave.source, "global", "离场 ⇒ 按未设置处理，回落全局首席");
  assert.equal(afterLeave.chief?.id, globalChief.id, "不换成频道外的人");
  assert.equal(boundChiefId(channel.id), localChief.id, "不改写库里的绑定");

  // 软删
  const room = createChannel({ name: unique("fallback-deleted-room") });
  const deleted = makeAgent("fallback-deleted", { join: room.id });
  setChannelChief(room.id, deleted.id);
  deleteAgent(deleted.id);
  const afterDelete = resolveEffectiveChief(room.id);
  assert.equal(afterDelete.source, "global", "软删 ⇒ 按未设置处理");
  assert.equal(afterDelete.chief?.id, globalChief.id);
  assert.equal(boundChiefId(room.id), deleted.id, "软删不改写绑定");

  // 历史遗留的非法绑定（人类成员）：读侧同样按「未设置」处理
  const legacy = createChannel({ name: unique("fallback-human-room") });
  globalThis.__workspliceDb.setChannelChief(legacy.id, OWNER_MEMBER_ID);
  const afterHuman = resolveEffectiveChief(legacy.id);
  assert.equal(afterHuman.source, "global");
  assert.equal(afterHuman.chief?.id, globalChief.id, "人类成员永远不是可用首席");

  // 全局首席也没有时：两者都失效 ⇒ 无（不兜底找别人）
  setGlobalChief(null);
  assert.deepEqual(resolveEffectiveChief(room.id), { chief: null, source: "none" });
});

test("判定不依赖名字：频道首席改名后仍是该频道首席", () => {
  const chief = makeAgent("rename-local");
  const channel = createChannel({ name: unique("rename-room") });
  joinChannel(channel.id, chief.id);
  setChannelChief(channel.id, chief.id);

  globalThis.__workspliceDb.db
    .prepare("UPDATE members SET name = ? WHERE id = ?")
    .run("completely-different-name", chief.id);

  const resolved = resolveEffectiveChief(channel.id);
  assert.equal(resolved.source, "channel");
  assert.equal(resolved.chief?.id, chief.id);
  setChannelChief(channel.id, null);
});

test("只有 Owner 能设置与清除频道首席", () => {
  const channel = createChannel({ name: unique("owner-only-room") });
  const target = makeAgent("owner-only-target", { join: channel.id });
  const intruder = makeAgent("owner-only-intruder", { join: channel.id });

  assertRejected(channel.id, () => setChannelChief(channel.id, target.id, intruder.id), {
    status: 403,
    code: "owner_only",
    match: /owner/i,
  });
  assertRejected(channel.id, () => setChannelChief(channel.id, null, intruder.id), {
    status: 403,
    code: "owner_only",
    match: /owner/i,
  });

  // Owner 可以写，也可以在绑定之后清。
  setChannelChief(channel.id, target.id, OWNER_MEMBER_ID);
  assert.equal(boundChiefId(channel.id), target.id);
  setChannelChief(channel.id, null, OWNER_MEMBER_ID);
  assert.equal(boundChiefId(channel.id), null);
});

test("目标校验：人类成员 / 频道外成员 / 已软删 / 不存在 一律拒绝且不留绑定", () => {
  const channel = createChannel({ name: unique("validate-room") });
  const member = makeAgent("validate-member", { join: channel.id });
  const outsider = makeAgent("validate-outsider");
  const deletedAgent = makeAgent("validate-deleted", { join: channel.id });
  deleteAgent(deletedAgent.id);

  assertRejected(channel.id, () => setChannelChief(channel.id, OWNER_MEMBER_ID), {
    status: 400,
    code: "human_member",
    match: /agent/i,
  });
  assertRejected(channel.id, () => setChannelChief(channel.id, outsider.id), {
    status: 409,
    code: "not_channel_member",
    match: /member of this channel/i,
  });
  assertRejected(channel.id, () => setChannelChief(channel.id, deletedAgent.id), {
    status: 409,
    code: "member_deleted",
    match: /deleted/i,
  });
  assertRejected(channel.id, () => setChannelChief(channel.id, "no-such-member"), {
    status: 404,
    code: "member_not_found",
    match: /not found/i,
  });
  assertRejected("no-such-channel", () => setChannelChief("no-such-channel", member.id), {
    status: 404,
    code: "channel_not_found",
    match: /not found/i,
  });

  // 失败之后合法写入仍然可用：拒绝没有留下半条绑定。
  setChannelChief(channel.id, member.id);
  assert.equal(boundChiefId(channel.id), member.id);
  assert.equal(resolveEffectiveChief(channel.id).chief?.id, member.id);
});

test("列表读面一次给全：生效首席 + 来源 + 绑定列", () => {
  const globalChief = makeAgent("meta-global");
  setGlobalChief(globalChief.id);
  const boundRoom = createChannel({ name: unique("meta-bound-room") });
  const localChief = makeAgent("meta-local", { join: boundRoom.id });
  setChannelChief(boundRoom.id, localChief.id);
  const fallbackRoom = createChannel({ name: unique("meta-fallback-room") });

  const rows = new Map(listChannelsWithMeta(OWNER_MEMBER_ID).map((row) => [row.id, row]));

  const bound = rows.get(boundRoom.id);
  assert.equal(bound.chiefSource, "channel");
  assert.deepEqual(bound.chief, { id: localChief.id, name: localChief.name });
  assert.equal(bound.chief_member_id, localChief.id);

  const fallback = rows.get(fallbackRoom.id);
  assert.equal(fallback.chiefSource, "global", "未指定的频道标出「回落全局」");
  assert.deepEqual(fallback.chief, { id: globalChief.id, name: globalChief.name });
  assert.equal(fallback.chief_member_id, null);

  // 全局也没有 ⇒ none（频道行仍然可读）。
  setGlobalChief(null);
  const none = new Map(listChannelsWithMeta(OWNER_MEMBER_ID).map((row) => [row.id, row]));
  assert.equal(none.get(fallbackRoom.id).chiefSource, "none");
  assert.equal(none.get(fallbackRoom.id).chief, null);
  assert.equal(
    none.get(boundRoom.id).chiefSource,
    "channel",
    "频道首席不受全局首席影响",
  );
});

test("涉及任务的无点名消息不归频道首席：选人层就把首席排除", () => {
  const globalChief = makeAgent("task-ref-global");
  setGlobalChief(globalChief.id);
  const channel = createChannel({ name: unique("task-ref-room") });
  const channelChief = makeAgent("task-ref-local", { join: channel.id });
  setChannelChief(channel.id, channelChief.id);

  // 普通无点名消息：频道首席接住。
  const plain = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "今天谁值班？",
  }).message;
  assert.equal(
    selectChiefRecipient({ channel, targetId: channel.id, content: plain.content }),
    channelChief.id,
  );

  // 任务锚点转成任务后，正文里出现唯一 `Task #N` 引用：不归首席收件人分支；
  // 它由本频道的生效首席走 handoff，候选不在这条普通消息的邀请集合里。
  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "把发布说明写一下",
  }).message;
  const task = createTask({ messageId: anchor.id });
  const reference = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: `Task #${task.number} 你处理下`,
  }).message;
  assert.equal(
    selectChiefRecipient({ channel, targetId: channel.id, content: reference.content }),
    null,
    "唯一 Task #N 引用不在普通收件人路径里重复叫首席",
  );
  assert.deepEqual(
    selectMessageInvitations({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: reference.content,
    }).candidates,
    [],
    "选人候选里也没有首席——wake / 场次不会叫错人",
  );

  setChannelChief(channel.id, null);
  setGlobalChief(null);
});
