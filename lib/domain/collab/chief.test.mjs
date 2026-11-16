import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";

/**
 * 首席（Chief）身份的纯判定层（票 #248）。
 *
 * 接缝 = 协作域服务层 + 真实临时 SQLite：只断言「谁是首席」「哪条消息归谁」这两件事，
 * 不碰会话、不碰 wake、不看私有字段。行为面（会话 / prompt / 游标）由
 * `lib/agent-loop/chief-round.test.mjs` 覆盖。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createAgent,
  createChannel,
  createDirectChannel,
  createTask,
  deleteAgent,
  getGlobalChief,
  GlobalChiefError,
  isChiefOfAnyChannel,
  isEffectiveChiefForChannel,
  joinChannel,
  leaveChannel,
  listChannelsWithMeta,
  muteChannel,
  resolveEffectiveChief,
  selectChiefRecipient,
  selectMessageInvitations,
  sendMessage,
  setChannelChief,
  setChannelArchived,
  setGlobalChief,
} = await import("./index.ts");
const taskReference = await import("./task-reference.ts");
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

/** 频道 + 一个 agent 成员（默认加入）；返回 { channel, member }。 */
function makeChannelWith(prefix) {
  const channel = createChannel({ name: unique(prefix) });
  const member = makeAgent(prefix, { join: channel.id });
  return { channel, member };
}

function rename(memberId, name) {
  globalThis.__workspliceDb.db
    .prepare("UPDATE members SET name = ? WHERE id = ?")
    .run(name, memberId);
}

test("全局首席：设 / 换 / 清空，同一时刻至多一位", () => {
  assert.equal(getGlobalChief(), undefined, "全新库没有全局首席");
  const alpha = createAgent({ name: unique("chief-alpha") });
  const beta = createAgent({ name: unique("chief-beta") });

  setGlobalChief(alpha.id);
  assert.equal(getGlobalChief()?.id, alpha.id);

  // 换人即换：旧的那位不再带标记。
  setGlobalChief(beta.id);
  assert.equal(getGlobalChief()?.id, beta.id);
  assert.equal(globalThis.__workspliceDb.getMember(alpha.id).global_chief, 0);
  assert.equal(
    globalThis.__workspliceDb
      .listMembers()
      .filter((member) => member.global_chief === 1).length,
    1,
    "至多一位",
  );

  // 清空
  setGlobalChief(null);
  assert.equal(getGlobalChief(), undefined);
});

test("判定不依赖名字：改名后仍是首席，同名的另一个 agent 不是", () => {
  const chief = createAgent({ name: unique("chief-rename") });
  setGlobalChief(chief.id);

  rename(chief.id, "completely-different-name");
  assert.equal(getGlobalChief()?.id, chief.id, "改名不影响判定");

  const impostor = createAgent({ name: "Susan" });
  assert.equal(getGlobalChief()?.id, chief.id, "叫 Susan 不等于就是首席");

  setGlobalChief(impostor.id);
  rename(impostor.id, "not-susan-any-more");
  assert.equal(getGlobalChief()?.id, impostor.id, "换成 Susan 之后改名仍是首席");

  setGlobalChief(null);
});

test("软删的首席不算首席；设成软删身份 / 人类成员被拒绝（类型化拒绝码）", () => {
  const chief = makeAgent("chief-deleted");
  setGlobalChief(chief.id);
  deleteAgent(chief.id);
  assert.equal(getGlobalChief(), undefined, "软删后回到「没有首席」");

  const rejected = (action) => {
    try {
      action();
    } catch (error) {
      return error;
    }
    return assert.fail("应当被拒绝");
  };

  const deleted = rejected(() => setGlobalChief(chief.id));
  assert.ok(deleted instanceof GlobalChiefError, "拒绝要带稳定语义（路由据此映射状态码）");
  assert.equal(deleted.status, 409);
  assert.equal(deleted.code, "member_deleted");

  const human = rejected(() => setGlobalChief(OWNER_MEMBER_ID));
  assert.equal(human.status, 400, "人类成员是非法入参，不是冲突");
  assert.equal(human.code, "human_member");

  const missing = rejected(() => setGlobalChief("no-such-member"));
  assert.equal(missing.status, 404, "不存在的 id 是资源缺失");
  assert.equal(missing.code, "member_not_found");

  for (const error of [deleted, human, missing]) {
    assert.match(error.message, /chief|member/i, "拒绝原因可读");
  }
});

test("生效首席解析：全局存在 → global；无 → none", () => {
  const { channel } = makeChannelWith("resolve");
  assert.deepEqual(resolveEffectiveChief(channel.id), {
    chief: null,
    source: "none",
  });

  const chief = makeAgent("resolve-chief");
  setGlobalChief(chief.id);
  const resolved = resolveEffectiveChief(channel.id);
  assert.equal(resolved.source, "global");
  assert.equal(resolved.chief?.id, chief.id);
  setGlobalChief(null);
});

test("isEffectiveChiefForChannel 只回答该成员是否是这个频道此刻的生效首席", () => {
  const globalChief = makeAgent("effective-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("effective-room") });
    const channelChief = makeAgent("effective-local", { join: channel.id });
    const other = makeAgent("effective-other", { join: channel.id });

    assert.equal(isEffectiveChiefForChannel(channel.id, globalChief.id), true);
    assert.equal(isEffectiveChiefForChannel(channel.id, other.id), false);

    setChannelChief(channel.id, channelChief.id);
    assert.equal(isEffectiveChiefForChannel(channel.id, channelChief.id), true);
    assert.equal(isEffectiveChiefForChannel(channel.id, globalChief.id), false);

    muteChannel(channel.id, channelChief.id);
    assert.equal(
      isEffectiveChiefForChannel(channel.id, channelChief.id),
      true,
      "静音属于可达性，不改变谁是生效首席",
    );
  } finally {
    setGlobalChief(null);
  }
});

test("isChiefOfAnyChannel：只认未归档频道的频道首席身份，不把全局回落算进来", () => {
  const globalChief = makeAgent("any-channel-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("any-channel-room") });
    const localChief = makeAgent("any-channel-local", { join: channel.id });

    assert.equal(
      isChiefOfAnyChannel(globalChief.id),
      false,
      "全局回落是生效首席，但不是「频道首席身份」",
    );
    assert.equal(isChiefOfAnyChannel(localChief.id), false);

    setChannelChief(channel.id, localChief.id);
    assert.equal(isChiefOfAnyChannel(localChief.id), true);
    assert.equal(
      isChiefOfAnyChannel(globalChief.id),
      false,
      "频道已有频道首席时，全局首席不是这一档",
    );

    setChannelArchived(channel.id, true);
    assert.equal(isChiefOfAnyChannel(localChief.id), false, "归档频道不算");
    setChannelArchived(channel.id, false);
    assert.equal(isChiefOfAnyChannel(localChief.id), true, "解归档后立即恢复");
  } finally {
    setGlobalChief(null);
  }
});

test("isChiefOfAnyChannel 不缓存：清空 / 离场 / 回场都按当下解析", () => {
  const channel = createChannel({ name: unique("any-channel-live-room") });
  const localChief = makeAgent("any-channel-live", { join: channel.id });

  setChannelChief(channel.id, localChief.id);
  assert.equal(isChiefOfAnyChannel(localChief.id), true);

  setChannelChief(channel.id, null);
  assert.equal(isChiefOfAnyChannel(localChief.id), false, "清空后立刻为 false");

  setChannelChief(channel.id, localChief.id);
  assert.equal(isChiefOfAnyChannel(localChief.id), true, "重新设置后立刻为 true");

  leaveChannel(channel.id, localChief.id);
  assert.equal(isChiefOfAnyChannel(localChief.id), false, "离场按「未设置」处理，不缓存旧结论");

  joinChannel(channel.id, localChief.id);
  assert.equal(isChiefOfAnyChannel(localChief.id), true, "回场后绑定仍然有效（不改写库里的绑定）");

  deleteAgent(localChief.id);
  assert.equal(isChiefOfAnyChannel(localChief.id), false, "软删后立刻为 false");
});

test("无点名、无 @all、不涉及任务的人类消息才由首席接住", () => {
  const channel = createChannel({ name: unique("chief-pick") });
  const chief = makeAgent("chief-pick", { join: channel.id });
  const other = makeAgent("chief-pick-other", { join: channel.id });
  setGlobalChief(chief.id);

  const plain = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "今天谁值班？",
  }).message;
  assert.equal(
    selectChiefRecipient({
      channel,
      targetId: channel.id,
      content: plain.content,
    }),
    chief.id,
    "普通频道消息由生效首席接住",
  );
  assert.deepEqual(
    selectMessageInvitations({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: plain.content,
    }),
    { all: false, mentioned: [], candidates: [chief.id], chief: chief.id },
    "候选与 beginTurn / wake 同源：首席是唯一候选",
  );

  // 个人点名：首席不额外追加（点名直达被点名者）。
  const mention = `@${other.name} 你来说`;
  assert.equal(
    selectChiefRecipient({ channel, targetId: channel.id, content: mention }),
    null,
  );
  const mentionedInvitations = selectMessageInvitations({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: mention,
  });
  assert.equal(mentionedInvitations.chief, null);
  assert.deepEqual(mentionedInvitations.candidates, [other.id]);

  // @all：同样不追加首席。
  const allMention = selectMessageInvitations({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "@all 都在吗",
  });
  assert.equal(allMention.all, true);
  assert.equal(allMention.chief, null);
  assert.deepEqual(
    [...allMention.candidates].sort(),
    [chief.id, other.id].sort(),
  );

  setGlobalChief(null);
});

test("涉及任务的无点名消息不归首席：任务锚点 / 任务创建事件", () => {
  const channel = createChannel({ name: unique("chief-task") });
  const chief = makeAgent("chief-task", { join: channel.id });
  setGlobalChief(chief.id);

  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "把发布说明写一下",
  }).message;
  createTask({ messageId: anchor.id });
  assert.equal(
    selectChiefRecipient({
      channel,
      targetId: anchor.id,
      content: anchor.content,
    }),
    null,
    "任务线程由任务裁决，不归首席",
  );

  // 任务创建事件（Owner 署名的系统消息）不触发首席。
  const event = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "Task #1 created — 把发布说明写一下",
    roomNotice: true,
  }).message;
  assert.equal(
    selectChiefRecipient({
      channel,
      targetId: channel.id,
      content: event.content,
    }),
    null,
    "任务创建事件只定向生效首席 handoff",
  );

  setGlobalChief(null);
});

/** 频道行上的「首席对本频道是否可达」——composer 提示读的就是这个结论。 */
function chiefAvailableOf(channelId) {
  return listChannelsWithMeta(OWNER_MEMBER_ID).find((row) => row.id === channelId)
    .chiefAvailable;
}

test("频道行带出「首席对本频道是否可达」：非成员 / 静音 ⇒ false（提示不承诺不发生的投递）", () => {
  const globalChief = makeAgent("chief-available-global");
  setGlobalChief(globalChief.id);
  try {
    // 私有频道不自动拉全局首席进来（createChannel 只给公开频道补秘书）——票面 AC 的可达反例：
    // 解析出「谁是首席」与「他会不会真的收到」是两件事。
    const channel = createChannel({
      name: unique("chief-available"),
      type: "private",
    });
    assert.equal(
      chiefAvailableOf(channel.id),
      false,
      "生效首席不是本频道成员 ⇒ 不可达（提示须说「没有默认收件人」）",
    );
    assert.equal(
      listChannelsWithMeta(OWNER_MEMBER_ID).find((row) => row.id === channel.id).chief?.id,
      globalChief.id,
      "绑定不变：不可达不等于换人",
    );

    // 私有频道只能由 Owner 加人：这一步模拟人类把首席拉进私有频道。
    joinChannel(channel.id, globalChief.id, OWNER_MEMBER_ID);
    assert.equal(chiefAvailableOf(channel.id), true, "同一人加入频道 ⇒ 可达");

    muteChannel(channel.id, globalChief.id);
    assert.equal(chiefAvailableOf(channel.id), false, "静音优先于首席 ⇒ 不可达");
    assert.equal(
      listChannelsWithMeta(OWNER_MEMBER_ID).find((row) => row.id === channel.id).chief?.id,
      globalChief.id,
      "不兜底换人、不回落全局",
    );
  } finally {
    setGlobalChief(null);
  }

  const channel = createChannel({ name: unique("chief-available-none") });
  assert.equal(chiefAvailableOf(channel.id), false, "没有首席 ⇒ 没有默认收件人");
});

test("任务创建事件正文落在 hasTaskReference 的口径里（首席的排除只需一份解析）", () => {
  const { hasTaskReference } = taskReference;
  // 选人侧只留 hasTaskReference 一条判据：它必须覆盖创建事件正文，否则「涉及任务 ⇒ 不归频道首席」
  // 会漏掉创建事件本身（那条是 Owner 署名的系统消息）。
  for (const content of [
    "Task #1 created",
    "Task #1 created — 把发布说明写一下",
    "Task #12 created — spike: 先看 logs",
  ]) {
    assert.equal(hasTaskReference(content), true, content);
  }
  // 引用块 / 代码块里的旧引用不算（与 @mention 同口径）
  assert.equal(hasTaskReference("> Task #1 created"), false);
});

test("首席不可用 = 没有首席：非本频道成员 / 静音的频道 / DM", () => {
  // 非频道成员：先建频道（此时还没有首席，不会被自动拉进公开频道），再设首席。
  const channel = createChannel({ name: unique("chief-unavailable") });
  const outsider = makeAgent("chief-outside");
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, outsider.id), false);
  setGlobalChief(outsider.id);
  assert.equal(
    selectChiefRecipient({
      channel,
      targetId: channel.id,
      content: "有人在吗",
    }),
    null,
    "不是该频道成员 ⇒ 没有可用首席，且不换人",
  );

  // 静音该频道：首席不被唤到。
  const member = makeAgent("chief-muted", { join: channel.id });
  setGlobalChief(member.id);
  assert.equal(
    selectChiefRecipient({ channel, targetId: channel.id, content: "有人在吗" }),
    member.id,
  );
  muteChannel(channel.id, member.id);
  assert.equal(
    selectChiefRecipient({ channel, targetId: channel.id, content: "有人在吗" }),
    null,
    "静音优先于首席",
  );

  // DM 语义不变：私信不经过首席。
  const dmAgent = makeAgent("chief-dm");
  const dm = createDirectChannel(dmAgent.id);
  assert.equal(
    selectChiefRecipient({ channel: dm, targetId: dm.id, content: "私信" }),
    null,
  );

  setGlobalChief(null);
});
