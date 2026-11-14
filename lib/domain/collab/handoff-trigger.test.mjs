import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-handoff-trigger-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  claimTask,
  createAgent,
  createChannel,
  createTask,
  drain,
  joinChannel,
  sendMessage,
} = await import("./index.ts");
const {
  isHandoffEligibleTask,
  parseTaskReferenceNumbers,
  selectSecretaryHandoffTask,
} = await import("./handoff-trigger.ts");
const { messageWithAuthor } = await import("./messages.ts");
const { OWNER_MEMBER_ID } = await import("../../data/schema.ts");

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

let susan;
function secretary() {
  if (!susan) susan = createAgent({ name: "Susan" });
  return susan;
}

function makeAgent(prefix) {
  return createAgent({ name: unique(prefix) });
}

function setupChannel() {
  const channel = createChannel({ name: unique("handoff-room") });
  joinChannel(channel.id, secretary().id);
  return channel;
}

function ownerMessage(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function selectionFor(targetId) {
  const db = globalThis.__workspliceDb;
  const channelId = db.getChannel(targetId)
    ? targetId
    : db.getMessage(targetId).target_id;
  return selectSecretaryHandoffTask({
    secretary: secretary(),
    channel: db.getChannel(channelId),
    targetId,
    messages: drain(secretary().id, targetId).messages,
  });
}

test("unique task-creation event selects that unclaimed task", () => {
  const channel = setupChannel();
  const anchor = ownerMessage(channel.id, "please ship the release notes");
  const task = createTask({ messageId: anchor.id });

  const selection = selectionFor(channel.id);
  assert.equal(selection.kind, "handoff");
  assert.equal(selection.task.id, task.id);
  assert.equal(selection.anchor.id, anchor.id);
});

test("human message in an unclaimed task thread selects that task", () => {
  const channel = setupChannel();
  const anchor = ownerMessage(channel.id, "please ship the notes");
  const task = createTask({ messageId: anchor.id });
  ownerMessage(anchor.id, "any progress?");

  const selection = selectionFor(anchor.id);
  assert.equal(selection.kind, "handoff");
  assert.equal(selection.task.id, task.id);
});

test("unique Task #N reference in a channel message selects that unclaimed task", () => {
  const channel = setupChannel();
  const anchor = ownerMessage(channel.id, "please ship the notes");
  const task = createTask({ messageId: anchor.id });
  ownerMessage(channel.id, "can someone take Task #1?");

  const selection = selectionFor(channel.id);
  assert.equal(selection.kind, "handoff");
  assert.equal(selection.task.id, task.id);
});

test("multiple task hits in one round do not select a handoff", () => {
  const channel = setupChannel();
  const first = ownerMessage(channel.id, "first request");
  const second = ownerMessage(channel.id, "second request");
  createTask({ messageId: first.id });
  createTask({ messageId: second.id });

  assert.deepEqual(selectionFor(channel.id), {
    kind: "none",
    reason: "multiple-tasks",
  });

  ownerMessage(channel.id, "Task #1 and Task #2 both need someone");
  assert.equal(selectionFor(channel.id).kind, "none");
  assert.equal(selectionFor(channel.id).reason, "multiple-tasks");
});

test("no association / plain chat does not select a handoff", () => {
  const channel = setupChannel();
  ownerMessage(channel.id, "good morning, just thinking out loud");

  assert.deepEqual(selectionFor(channel.id), {
    kind: "none",
    reason: "no-human-association",
  });
});

test("quoted Task #N text is not an association", () => {
  const channel = setupChannel();
  const anchor = ownerMessage(channel.id, "please ship the notes");
  createTask({ messageId: anchor.id });
  ownerMessage(
    channel.id,
    "> Task #1 created\n\njust quoting the old event, nothing to route",
  );

  const quoted = globalThis.__workspliceDb.getLatestMessage(channel.id);
  const selection = selectSecretaryHandoffTask({
    secretary: secretary(),
    channel,
    targetId: channel.id,
    messages: [messageWithAuthor(quoted)],
  });
  assert.equal(selection.kind, "none");
  assert.equal(selection.reason, "no-human-association");
});

test("a creation-event preview containing another Task #N does not look ambiguous", () => {
  const channel = setupChannel();
  const secondAnchor = ownerMessage(channel.id, "second request");
  const secondTask = createTask({ messageId: secondAnchor.id });
  const firstAnchor = ownerMessage(channel.id, "first request mentions Task #2");
  const firstTask = createTask({ messageId: firstAnchor.id });
  const events = globalThis.__workspliceDb
    .listMessages(channel.id)
    .filter((message) => /^Task #\d+ created/.test(message.content));
  const firstEvent = events.find((message) => message.content.startsWith(`Task #${firstTask.number} `));
  assert.ok(firstEvent);

  const selection = selectSecretaryHandoffTask({
    secretary: secretary(),
    channel,
    targetId: channel.id,
    messages: [messageWithAuthor(firstEvent)],
  });
  assert.equal(selection.kind, "handoff");
  assert.equal(selection.task.id, firstTask.id);
  assert.notEqual(selection.task.id, secondTask.id);
});

test("owned, reopened, or already-handled tasks are not handoff candidates", () => {
  const channel = setupChannel();
  const alice = makeAgent("handoff-alice");
  joinChannel(channel.id, alice.id);

  const ownedAnchor = ownerMessage(channel.id, "owned request");
  const owned = createTask({ messageId: ownedAnchor.id });
  assert.equal(
    claimTask({
      channelId: channel.id,
      taskNumber: owned.number,
      memberId: alice.id,
    }).status,
    "claimed",
  );
  assert.equal(isHandoffEligibleTask(globalThis.__workspliceDb.getTaskById(owned.id)), false);

  const reopenedAnchor = ownerMessage(channel.id, "reopened request");
  const reopened = createTask({ messageId: reopenedAnchor.id });
  globalThis.__workspliceDb.updateTask(reopened.id, { reopened: 1 });
  assert.equal(isHandoffEligibleTask(globalThis.__workspliceDb.getTaskById(reopened.id)), false);

  const handledAnchor = ownerMessage(channel.id, "handled request");
  const handled = createTask({ messageId: handledAnchor.id });
  globalThis.__workspliceDb.updateTask(handled.id, {
    handoffState: "blocked",
    handoffSeq: 1,
  });
  assert.equal(isHandoffEligibleTask(globalThis.__workspliceDb.getTaskById(handled.id)), false);

  const selection = selectSecretaryHandoffTask({
    secretary: secretary(),
    channel,
    targetId: channel.id,
    messages: [messageWithAuthor(globalThis.__workspliceDb.getLatestMessage(channel.id))],
  });
  assert.notEqual(selection.kind, "handoff");
});

test("an already-handled task event still in the drain does not block a new eligible task", () => {
  const channel = setupChannel();
  const firstAnchor = ownerMessage(channel.id, "first request");
  const firstTask = createTask({ messageId: firstAnchor.id });
  globalThis.__workspliceDb.updateTask(firstTask.id, {
    handoffState: "blocked",
    handoffSeq: 1,
  });
  const secondAnchor = ownerMessage(channel.id, "second request");
  const secondTask = createTask({ messageId: secondAnchor.id });

  const selection = selectionFor(channel.id);
  assert.equal(selection.kind, "handoff");
  assert.equal(selection.task.id, secondTask.id);
});

test("the secretary must be a channel member to be selected", () => {
  // 私有频道不会自动加入秘书（公开频道会自动加入），用来构造非成员场景。
  const channel = createChannel({
    name: unique("handoff-no-secretary"),
    type: "private",
  });
  const anchor = ownerMessage(channel.id, "please ship the notes");
  createTask({ messageId: anchor.id });

  assert.deepEqual(
    selectSecretaryHandoffTask({
      secretary: secretary(),
      channel,
      targetId: channel.id,
      messages: drain(secretary().id, channel.id).messages,
    }),
    { kind: "none", reason: "secretary-not-member" },
  );
});

test("a non-secretary caller never selects a handoff", () => {
  const channel = setupChannel();
  const anchor = ownerMessage(channel.id, "please ship the notes");
  createTask({ messageId: anchor.id });
  const alice = makeAgent("handoff-not-secretary");
  joinChannel(channel.id, alice.id);

  assert.deepEqual(
    selectSecretaryHandoffTask({
      secretary: alice,
      channel,
      targetId: channel.id,
      messages: drain(alice.id, channel.id).messages,
    }),
    { kind: "none", reason: "not-secretary" },
  );
});

test("parseTaskReferenceNumbers ignores quotes / code and de-duplicates repeats", () => {
  assert.deepEqual(parseTaskReferenceNumbers("Task #1 and task #1 again"), [1]);
  assert.deepEqual(parseTaskReferenceNumbers("Task #1 and Task #2"), [1, 2]);
  assert.deepEqual(
    parseTaskReferenceNumbers("> Task #1 created\n\n```\nTask #2\n```\n`Task #3`"),
    [],
  );
});
