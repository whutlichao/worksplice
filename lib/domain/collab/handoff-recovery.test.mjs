import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";

/**
 * 票 #242：handoff 定向唤醒的崩溃恢复。
 * 接缝 = 真实临时 SQLite + 协作域写路径 + 可注入 emitWake（不真起模型、不接网络）。
 */

let root;
test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-handoff-recovery-"));
  globalThis.__workspliceDb = openDataDb(root);
});
test.afterEach(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
  susan = undefined;
});

const {
  ack,
  createAgent,
  createChannel,
  createTask,
  joinChannel,
  sendMessage,
} = await import("./index.ts");
const { handoffTask, recoverHandoffWakes } = await import("./handoff.ts");
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

function setupTask() {
  const channel = createChannel({ name: unique("recovery-room") });
  joinChannel(channel.id, secretary().id);
  const alice = createAgent({ name: unique("recovery-alice") });
  joinChannel(channel.id, alice.id);
  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "please ship the release notes",
  });
  assert.equal(anchor.held, false);
  const task = createTask({ messageId: anchor.message.id });
  return { channel, anchor: anchor.message, task, alice };
}

test("a committed handoff whose wake was lost is re-woken at the persisted notice seq", () => {
  const { channel, anchor, task, alice } = setupTask();
  const handoffWakes = [];
  const handedOff = handoffTask({
    channelId: channel.id,
    taskNumber: task.number,
    secretaryId: secretary().id,
    assignee: alice.name,
    baseSeq: globalThis.__workspliceDb.maxSeq(channel.id),
    emitWake: (hint) => handoffWakes.push(hint),
  });
  assert.equal(handedOff.status, "handed_off");
  assert.equal(handoffWakes.length, 1, "the normal post-commit wake still fires");

  const recovered = [];
  const emitted = recoverHandoffWakes({
    emitWake: (hint) => recovered.push(hint),
  });
  assert.equal(emitted, 1);
  assert.deepEqual(
    recovered.map((hint) => ({
      agentId: hint.agentId,
      targetId: hint.targetId,
      seq: hint.seq,
      reason: hint.reason,
      recovery: hint.recovery,
    })),
    [
      {
        agentId: alice.id,
        targetId: anchor.id,
        seq: handedOff.notice.seq,
        reason: "message",
        recovery: true,
      },
    ],
  );
});

test("once the chosen cursor reaches the notice seq, recovery stops", () => {
  const { channel, anchor, task, alice } = setupTask();
  const handedOff = handoffTask({
    channelId: channel.id,
    taskNumber: task.number,
    secretaryId: secretary().id,
    assignee: alice.name,
    emitWake: () => {},
  });
  assert.equal(handedOff.status, "handed_off");

  ack(alice.id, anchor.id, handedOff.notice.seq);
  const recovered = [];
  assert.equal(
    recoverHandoffWakes({ emitWake: (hint) => recovered.push(hint) }),
    0,
  );
  assert.deepEqual(recovered, []);
});

test("recovery stops when the task left in_progress or its owner changed", () => {
  const { channel, anchor, task, alice } = setupTask();
  const handedOff = handoffTask({
    channelId: channel.id,
    taskNumber: task.number,
    secretaryId: secretary().id,
    assignee: alice.name,
    emitWake: () => {},
  });
  assert.equal(handedOff.status, "handed_off");
  const bob = createAgent({ name: unique("recovery-bob") });
  joinChannel(channel.id, bob.id);

  globalThis.__workspliceDb.updateTask(task.id, {
    status: "in_review",
  });
  const afterStatus = [];
  assert.equal(
    recoverHandoffWakes({ emitWake: (hint) => afterStatus.push(hint) }),
    0,
  );

  globalThis.__workspliceDb.updateTask(task.id, {
    status: "in_progress",
    ownerId: bob.id,
  });
  const afterOwner = [];
  assert.equal(
    recoverHandoffWakes({ emitWake: (hint) => afterOwner.push(hint) }),
    0,
  );
  assert.deepEqual(afterStatus, []);
  assert.deepEqual(afterOwner, []);
  assert.ok(anchor.id);
});

test("a crash after commit but before the directed wake leaves a recoverable handoff", () => {
  const { channel, anchor, task, alice } = setupTask();
  assert.throws(
    () =>
      handoffTask({
        channelId: channel.id,
        taskNumber: task.number,
        secretaryId: secretary().id,
        assignee: alice.name,
        emitWake: () => {
          throw new Error("simulated crash before wake");
        },
      }),
    /simulated crash before wake/,
  );

  const row = globalThis.__workspliceDb.getTaskById(task.id);
  assert.equal(row.status, "in_progress");
  assert.equal(row.owner_id, alice.id);
  assert.equal(row.handoff_state, "handed_off");
  assert.equal(row.handoff_owner_id, alice.id);
  assert.ok(row.handoff_seq);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(alice.id, anchor.id), 0);

  const recovered = [];
  assert.equal(
    recoverHandoffWakes({ emitWake: (hint) => recovered.push(hint) }),
    1,
  );
  assert.equal(recovered[0].seq, row.handoff_seq);
});

test("recovery does not wake when the persisted notice seq no longer resolves", () => {
  const { channel, task, alice } = setupTask();
  const handedOff = handoffTask({
    channelId: channel.id,
    taskNumber: task.number,
    secretaryId: secretary().id,
    assignee: alice.name,
    emitWake: () => {},
  });
  assert.equal(handedOff.status, "handed_off");
  globalThis.__workspliceDb.updateTask(task.id, {
    handoffSeq: handedOff.notice.seq + 100,
  });

  const recovered = [];
  assert.equal(
    recoverHandoffWakes({ emitWake: (hint) => recovered.push(hint) }),
    0,
  );
  assert.deepEqual(recovered, []);
});

test("recovery has a bounded attempt count with exponential backoff", () => {
  const { channel, anchor, task, alice } = setupTask();
  const handedOff = handoffTask({
    channelId: channel.id,
    taskNumber: task.number,
    secretaryId: secretary().id,
    assignee: alice.name,
    emitWake: () => {},
  });
  assert.equal(handedOff.status, "handed_off");

  const start = Date.parse("2026-11-14T00:00:00.000Z");
  const scan = (offsetMs) => {
    const recovered = [];
    const emitted = recoverHandoffWakes({
      emitWake: (hint) => recovered.push(hint),
      now: new Date(start + offsetMs),
    });
    return { emitted, recovered };
  };

  assert.equal(scan(0).emitted, 1, "first recovery attempt is immediate");
  assert.equal(scan(30_000).emitted, 0, "60s backoff blocks an early retry");
  assert.equal(scan(60_000).emitted, 1, "second attempt starts after 60s");
  assert.equal(scan(179_000).emitted, 0, "second backoff is 120s");
  assert.equal(scan(180_000).emitted, 1, "third attempt starts after another 120s");
  assert.equal(scan(3_600_000).emitted, 0, "the attempt cap stops all later scans");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(alice.id, anchor.id),
    0,
    "recovery itself never advances the cursor",
  );
});

test("repeated recovery scans stay idempotent without changing the owner or notice", () => {
  const { channel, anchor, task, alice } = setupTask();
  const handedOff = handoffTask({
    channelId: channel.id,
    taskNumber: task.number,
    secretaryId: secretary().id,
    assignee: alice.name,
    emitWake: () => {},
  });
  assert.equal(handedOff.status, "handed_off");
  const noticeCount = globalThis.__workspliceDb.listMessages(anchor.id).length;

  assert.equal(recoverHandoffWakes({ emitWake: () => {} }), 1);
  assert.equal(recoverHandoffWakes({ emitWake: () => {} }), 0);

  const row = globalThis.__workspliceDb.getTaskById(task.id);
  assert.equal(row.owner_id, alice.id);
  assert.equal(row.status, "in_progress");
  assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, noticeCount);
});
