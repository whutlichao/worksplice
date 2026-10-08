import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { runMigrations, DM_ID_PREFIX, OWNER_MEMBER_ID } from "../../data/schema.ts";

/**
 * DM 重建接续验收（本票 `.scratch/dm-rebuild-resume/issues/01-dm-rebuild-resume.md`）：
 * 删除同名 agent 后重建（新 member id）时，确定性 id 的 DM 必须就地接续——解档、成员恰为
 * {owner, 新 agent}、新身份的消费游标 = 修复时刻 max(seq)（历史一条不动、不重放）。
 * 两个触发点（`createAgent` 重建路径 / 开库期修复步骤）共用同一份「接续后预期态」断言
 * （assertResumedDm）：判据一旦在某一处漂移，两个用例一起红。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-dm-resume-"));
const store = openDataDb(root);
globalThis.__workspliceDb = store;
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createDirectChannel,
  getChannel,
  listChannelMembers,
  joinChannel,
  leaveChannel,
  setChannelArchived,
  muteChannel,
  resumeDirectChannel,
} = await import("./channels.ts");
const { createAgent, deleteAgent } = await import("./members.ts");
const { sendMessage, listMessages } = await import("./messages.ts");
const { drain } = await import("./inbox.ts");
const { subscribeWake } = await import("./wake.ts");
const { initSecretaryFlow } = await import("./secretary-init.ts");
const { SUSAN_MEMBER_NAME } = await import("./event-messages.ts");

/**
 * 接续后的预期态（两个触发点同形断言）：解档可用 + 成员恰为 {owner, agent} +
 * 该 agent 对 DM 的消费游标 = 当时的房间版本（max seq，旧历史不重放）。
 */
function assertResumedDm(dmId, agentId, label = "resumed dm") {
  const channel = getChannel(dmId);
  assert.ok(channel, `${label}: channel row kept`);
  assert.equal(channel.type, "dm", `${label}: still a dm`);
  assert.equal(channel.archived, 0, `${label}: unarchived (writable again)`);
  assert.deepEqual(
    listChannelMembers(dmId)
      .map((m) => m.id)
      .sort(),
    [OWNER_MEMBER_ID, agentId].sort(),
    `${label}: membership is exactly owner + the (rebuilt) agent`,
  );
  assert.equal(
    store.getConsumedSeq(agentId, dmId),
    store.maxSeq(dmId),
    `${label}: cursor advanced to the repair-time max seq (no history replay)`,
  );
}

/** DM 相关状态的快照（重跑比对用）：频道行 + 成员行 + 该 agent 的消费游标。 */
function dmSnapshot(dmId, agentId) {
  return JSON.stringify({
    channel: getChannel(dmId),
    members: store.listChannelMembers(dmId),
    cursor: store.getConsumedSeq(agentId, dmId),
  });
}

/** 造一条「有历史消息的 DM」：返回 { agent, dm, history }。 */
function dmWithHistory(name, contents) {
  const agent = createAgent({ name });
  const dm = createDirectChannel(agent.id);
  for (const content of contents) {
    sendMessage({ targetId: dm.id, authorId: OWNER_MEMBER_ID, content });
  }
  return { agent, dm, history: listMessages(dm.id).messages };
}

test("delete then rebuild with the same name resumes the same dm in place (unarchived, two members, cursor at max seq)", () => {
  const { agent: first, dm, history } = dmWithHistory("resume-basic", [
    "old question",
    "old answer",
  ]);
  assert.equal(history.length, 2);

  deleteAgent(first.id);
  assert.equal(getChannel(dm.id).archived, 1, "delete keeps the dm archived (read-only)");

  // 同名重建：名字唯一性只比未删除成员，软删身份不占名 → 得到新 member id
  const rebuilt = createAgent({ name: "resume-basic" });
  assert.notEqual(rebuilt.id, first.id, "rebuild yields a fresh identity");

  assertResumedDm(dm.id, rebuilt.id, "rebuild path");

  // 历史消息一条不动（内容与 seq 全等）
  assert.deepEqual(
    listMessages(dm.id).messages.map((m) => `${m.seq}:${m.author_id}:${m.content}`),
    history.map((m) => `${m.seq}:${m.author_id}:${m.content}`),
    "history is untouched",
  );
});

test("after rebuild a new human dm message wakes the new identity, and old history is not pending", () => {
  const { agent: first, dm } = dmWithHistory("resume-wake", ["history one", "history two"]);
  deleteAgent(first.id);
  const rebuilt = createAgent({ name: "resume-wake" });

  assert.deepEqual(
    drain(rebuilt.id, dm.id).messages,
    [],
    "old history produces no pending for the new identity",
  );

  const hints = [];
  const unsubscribe = subscribeWake((hint) => hints.push(hint));
  try {
    // 归档未解时这里会抛 read-only；接续后人类消息是确定信号（§R4）
    const sent = sendMessage({
      targetId: dm.id,
      authorId: OWNER_MEMBER_ID,
      content: "you there?",
    });
    assert.equal(sent.held, false, "human message lands");
    assert.deepEqual(
      hints.filter((hint) => hint.targetId === dm.id),
      [{ agentId: rebuilt.id, targetId: dm.id, seq: sent.message.seq, reason: "message" }],
      "the new identity is the one woken for its own dm",
    );
    assert.deepEqual(
      drain(rebuilt.id, dm.id).messages.map((m) => m.content),
      ["you there?"],
      "only the fresh message is visible to the new identity",
    );
    // 新身份能写回自己的 DM（§R4 回应路径的落库那一步；回应判定本身由 agent-loop 的 DM 用例锁定）
    const reply = sendMessage({ targetId: dm.id, authorId: rebuilt.id, content: "still here" });
    assert.equal(reply.held, false, "the resumed identity can reply in its own dm");
    assert.equal(reply.message.author_id, rebuilt.id);
  } finally {
    unsubscribe();
  }
});

test("open-time repair restores a pre-existing bad dm row (archived + member removed + no cursor) and re-run changes nothing", () => {
  const { agent, dm } = dmWithHistory("resume-stale", ["before the break"]);

  // 构造坏行：等价于「上一次删除 + 重建发生在没有任何接续路径的版本上」——
  // DM 归档、新身份不在成员里、没有任何消费游标
  store.setChannelArchived(dm.id, 1);
  store.removeChannelMember(dm.id, agent.id);
  store.clearConsumedSeqsForAgent(agent.id);
  assert.equal(getChannel(dm.id).archived, 1);
  assert.equal(store.isChannelMember(dm.id, agent.id), false);
  assert.equal(store.getConsumedSeq(agent.id, dm.id), 0);

  runMigrations(store.db);
  assertResumedDm(dm.id, agent.id, "open-time repair");

  // 可重跑：第二次开库不改动任何东西（DM 相关状态逐字节相同 + 连接级写入计数不增）
  const snapshot = dmSnapshot(dm.id, agent.id);
  const writesBefore = store.db.total_changes;
  runMigrations(store.db);
  assert.equal(store.db.total_changes, writesBefore, "second open writes no row");
  assert.equal(dmSnapshot(dm.id, agent.id), snapshot, "second open changes nothing");

  // 历史仍在
  assert.deepEqual(
    listMessages(dm.id).messages.map((m) => m.content),
    ["before the break"],
  );
});

test("deleted agent without rebuild keeps its dm archived across open-time repair (no blanket unarchive)", () => {
  const { agent, dm } = dmWithHistory("resume-gone", ["kept readable"]);

  deleteAgent(agent.id);
  runMigrations(store.db);

  assert.equal(getChannel(dm.id).archived, 1, "dm of a deleted agent stays archived");
  assert.equal(store.isChannelMember(dm.id, agent.id), false, "deleted identity is not re-added");
  assert.deepEqual(
    listChannelMembers(dm.id).map((m) => m.id),
    [OWNER_MEMBER_ID],
    "no live same-name agent -> membership untouched",
  );
  assert.deepEqual(
    listMessages(dm.id).messages.map((m) => m.content),
    ["kept readable"],
    "history still readable",
  );
});

test("a resumed dm still rejects join / leave / archive / mute (DM rules unchanged)", () => {
  const { agent: first, dm } = dmWithHistory("resume-guard", ["hi"]);
  deleteAgent(first.id);
  const rebuilt = createAgent({ name: "resume-guard" });
  assertResumedDm(dm.id, rebuilt.id, "guard setup");

  const intruder = createAgent({ name: "resume-intruder" });
  assert.throws(() => joinChannel(dm.id, intruder.id, OWNER_MEMBER_ID), /DM|dm/);
  assert.throws(() => leaveChannel(dm.id, rebuilt.id, rebuilt.id), /DM|dm/);
  assert.throws(() => setChannelArchived(dm.id, 1, OWNER_MEMBER_ID), /DM|dm/);
  assert.throws(() => muteChannel(dm.id, rebuilt.id, OWNER_MEMBER_ID), /DM|dm/);

  // 被拒后仍是接续态：非归档、成员恰为两人
  assertResumedDm(dm.id, rebuilt.id, "after rejected mutations");
});

test("repair is scoped: a live sibling's dm keeps its own unread cursor, only the broken dm is touched", () => {
  const { agent: keeper, dm: keeperDm } = dmWithHistory("resume-keeper", ["keeper history"]);
  // 存活身份的正常 DM：成员齐、非归档——但 keeper 自己还没消费过（游标 0，未读积压）
  const keeperBeforeCursor = store.getConsumedSeq(keeper.id, keeperDm.id);
  const keeperBefore = dmSnapshot(keeperDm.id, keeper.id);
  const goner = createAgent({ name: "resume-sibling" });
  const gonerDm = createDirectChannel(goner.id);
  sendMessage({ targetId: gonerDm.id, authorId: OWNER_MEMBER_ID, content: "sibling history" });

  deleteAgent(goner.id);
  runMigrations(store.db);

  assert.equal(
    dmSnapshot(keeperDm.id, keeper.id),
    keeperBefore,
    "healthy dm of a live identity is untouched by the repair",
  );
  assert.equal(
    store.getConsumedSeq(keeper.id, keeperDm.id),
    keeperBeforeCursor,
    "live identity's unread backlog is not swallowed (cursor stays where it was)",
  );
  assert.equal(keeperBeforeCursor, 0, "keeper had not consumed its dm yet");
  assert.equal(getChannel(gonerDm.id).archived, 1, "sibling dm stays archived");
});

test("dm id stays name-derived after resume (no new id scheme)", () => {
  const { agent: first, dm } = dmWithHistory("resume-naming", ["naming"]);
  deleteAgent(first.id);
  const rebuilt = createAgent({ name: "resume-naming" });

  assert.equal(dm.id, `${DM_ID_PREFIX}resume-naming`);
  assert.equal(getChannel(dm.id).name, dm.id, "id == name");
  assert.equal(listMessages(dm.id).messages.length, 1, "no second dm was created");
  assertResumedDm(dm.id, rebuilt.id, "naming");
});

test("resume is idempotent at the service layer and never creates a dm that lazy creation has not made yet", () => {
  const { agent: first, dm } = dmWithHistory("resume-idempotent", ["history"]);
  deleteAgent(first.id);
  const rebuilt = createAgent({ name: "resume-idempotent" });
  assertResumedDm(dm.id, rebuilt.id, "first resume");

  // 已在预期态 → 一行不写（服务层与开库步骤同一个「预期态」判据）
  const snapshot = dmSnapshot(dm.id, rebuilt.id);
  const writesBefore = store.db.total_changes;
  resumeDirectChannel(rebuilt.id);
  assert.equal(store.db.total_changes, writesBefore, "second resume writes no row");
  assert.equal(dmSnapshot(dm.id, rebuilt.id), snapshot, "state unchanged");

  // 懒创建语义不变：名字没有 DM 时不建行
  const fresh = createAgent({ name: "resume-none" });
  const writesBeforeFresh = store.db.total_changes;
  resumeDirectChannel(fresh.id);
  assert.equal(store.db.total_changes, writesBeforeFresh, "no dm -> no write");
  assert.equal(
    getChannel(`${DM_ID_PREFIX}resume-none`),
    undefined,
    "resume must not create a dm behind lazy creation",
  );

  // 守卫：非 agent / 不存在 / 已软删身份都不能被接续
  assert.throws(() => resumeDirectChannel(OWNER_MEMBER_ID), /Agent not found/);
  assert.throws(() => resumeDirectChannel("no-such-id"), /Member not found/);
  assert.throws(() => resumeDirectChannel(first.id), /Agent not found/);
});

test("repair follows its predicate clause by clause (archived-only / missing owner / missing agent)", () => {
  // 分句 1：归档但成员齐全（同一身份）→ 只解档，不吞该身份自己的未读
  const archivedOnly = dmWithHistory("resume-clause-archived", ["unread one", "unread two"]);
  store.setChannelArchived(archivedOnly.dm.id, 1);
  runMigrations(store.db);
  assert.equal(getChannel(archivedOnly.dm.id).archived, 0, "archived-only deviation is unarchived");
  assert.deepEqual(
    listChannelMembers(archivedOnly.dm.id)
      .map((m) => m.id)
      .sort(),
    [OWNER_MEMBER_ID, archivedOnly.agent.id].sort(),
  );
  assert.equal(
    store.getConsumedSeq(archivedOnly.agent.id, archivedOnly.dm.id),
    0,
    "same identity keeps its own unread backlog",
  );

  // 分句 2：缺 owner → 补回 owner；agent 还是成员 → 游标不动
  const noOwner = dmWithHistory("resume-clause-owner", ["hello"]);
  store.removeChannelMember(noOwner.dm.id, OWNER_MEMBER_ID);
  runMigrations(store.db);
  assert.deepEqual(
    listChannelMembers(noOwner.dm.id)
      .map((m) => m.id)
      .sort(),
    [OWNER_MEMBER_ID, noOwner.agent.id].sort(),
    "owner restored",
  );
  assert.equal(store.getConsumedSeq(noOwner.agent.id, noOwner.dm.id), 0, "agent keeps its own cursor");

  // 分句 3：成员缺失但未归档（新身份）→ 成员补回 + 游标推到 max(seq)
  const missingAgent = dmWithHistory("resume-clause-agent", ["old one", "old two"]);
  store.removeChannelMember(missingAgent.dm.id, missingAgent.agent.id);
  runMigrations(store.db);
  assertResumedDm(missingAgent.dm.id, missingAgent.agent.id, "missing-member clause");
});

test("the real rebuild entry (initSecretaryFlow -> createAgent) resumes the secretary dm too", () => {
  const first = initSecretaryFlow();
  assert.equal(first.name, SUSAN_MEMBER_NAME);
  const dm = createDirectChannel(first.id);
  sendMessage({ targetId: dm.id, authorId: OWNER_MEMBER_ID, content: "the old thread" });

  deleteAgent(first.id);
  assert.equal(getChannel(dm.id).archived, 1, "delete still archives the dm");

  const rebuilt = initSecretaryFlow();

  assert.notEqual(rebuilt.id, first.id, "fresh identity through the real entry");
  assertResumedDm(dm.id, rebuilt.id, "secretary rebuild path");
  assert.deepEqual(
    listMessages(dm.id).messages.map((m) => m.content),
    ["the old thread"],
    "history untouched by the real path",
  );
});

test("documented boundary: a different-cased name is a different dm identity (frozen naming: id == name, case-sensitive)", () => {
  const { agent: first, dm } = dmWithHistory("Resume-case", ["history"]);
  deleteAgent(first.id);
  // 名字唯一性只对**存活**成员做大小写不敏感比对，所以大小写变体可以重建
  const rebuilt = createAgent({ name: "resume-case" });
  runMigrations(store.db);

  // 冻结的命名规则是「id == name」原样派生（票 01 R7）。大小写折叠会改 DM 命名/解析规则（本票 out of scope），
  // 故旧 DM 按裁定 4「没有存活同名 agent」保持 archived=1，新身份走懒创建得到自己的 DM。
  assert.equal(getChannel(dm.id).archived, 1, "old dm stays archived (no live agent with that exact name)");
  assert.equal(store.isChannelMember(dm.id, rebuilt.id), false);
  const ownDm = createDirectChannel(rebuilt.id);
  assert.equal(ownDm.id, `${DM_ID_PREFIX}resume-case`);
  assert.notEqual(ownDm.id, dm.id, "case variant is a separate dm identity");
});
