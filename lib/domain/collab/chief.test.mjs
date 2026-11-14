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
  joinChannel,
  muteChannel,
  resolveEffectiveChief,
  selectChiefRecipient,
  selectMessageInvitations,
  sendMessage,
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

test("软删的首席不算首席；设成软删身份 / 人类成员被拒绝", () => {
  const chief = makeAgent("chief-deleted");
  setGlobalChief(chief.id);
  deleteAgent(chief.id);
  assert.equal(getGlobalChief(), undefined, "软删后回到「没有首席」");

  assert.throws(() => setGlobalChief(chief.id), /Global chief must be a live agent/);
  assert.throws(
    () => setGlobalChief(OWNER_MEMBER_ID),
    /Global chief must be a live agent/,
    "人类成员不能当首席",
  );
  assert.throws(
    () => setGlobalChief("no-such-member"),
    /Global chief must be a live agent/,
  );
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
    "任务创建事件只定向秘书 handoff",
  );

  setGlobalChief(null);
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
