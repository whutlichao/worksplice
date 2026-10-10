import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { openDataDb } from "../data/sqlite.ts";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST: postTask } = await jiti.import("../../app/api/tasks/route.ts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-tasks-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent } = await import("../domain/collab/members.ts");
// 名字唯一性（agent-name-uniqueness）：同一 DB 内多次创建用唯一后缀避免重名拒绝
let fixtureSeq = 0;
const { createChannel, joinChannel } = await import(
  "../domain/collab/channels.ts"
);
const { sendMessage } = await import("../domain/collab/messages.ts");
const { createTask, claimTask, updateTaskStatus, listChannelTasks } =
  await import("../domain/collab/tasks.ts");
const { ack } = await import("../domain/collab/inbox.ts");
const { parseAgentAction, buildReplyPrompt, runAgentRound, runTaskOperation } =
  await import("./loop.ts");
const { startAgentLoopDriver, peekAgentLoopQueues } = await import("./loop.ts");
const { emitWake } = await import("../domain/collab/wake.ts");
const { setAgentStatusLookup } = await import("../agent-status.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

setAgentStatusLookup(() => null);

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

/**
 * fake session。默认形态：prompt 一发就在微任务里自动收口（绝大多数用例要的就是这个）。
 * `gated: true`：prompt 发出后**不自动收口**，由测试显式 `release(i)`——用来确定性地
 * 撑开「一轮在飞」的窗口。默认形态在一个微任务里就发完 prompt_done、轮次瞬间收口，
 * 测试根本观察不到「处理期间到达的 hint」（那样断言会退化成空断言）。
 */
function makeFakeSession(replies = [], { gated = false } = {}) {
  const listeners = [];
  let running = false;
  /** gated 形态下每次 prompt 对应一个待收口槽位；`release(i)` 收口第 i 次 prompt。 */
  const pending = [];
  /** 收口一次 prompt：按当前形态发出 prompt_done / prompt_error / agent_end。 */
  function settle(index, reply) {
    if (gated) {
      const slot = pending[index];
      if (!slot || slot.done) return;
      slot.done = true;
      running = pending.some((p) => !p.done);
    } else {
      running = false;
    }
    if (reply?.error) {
      session.emit({ type: "prompt_error", errorMessage: reply.error });
    } else {
      session.lastText = reply?.text ?? "";
      session.emit({ type: "prompt_done" });
    }
    session.emit({ type: "agent_end" });
  }
  const session = {
    replies,
    lastText: "",
    prompts: [],
    pending,
    isRunning: () => running,
    onEvent: (l) => {
      listeners.push(l);
      return () => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    emit: (event) => {
      for (const l of [...listeners]) l(event);
    },
    release: (index) => settle(index, pending[index]?.reply),
    releaseAll: () => {
      for (let i = 0; i < pending.length; i += 1) session.release(i);
    },
    async send(command) {
      if (command.type === "prompt") {
        this.prompts.push(command.message);
        const index = pending.length;
        const slot = { done: false, reply: undefined };
        pending.push(slot);
        // 回复按 prompt 次序消费：默认形态立刻 shift；gated 形态留给 release(i) 再取。
        if (gated) slot.reply = this.replies[index];
        else slot.reply = this.replies.shift();
        running = true;
        this.emit({ type: "agent_start" });
        if (!gated) queueMicrotask(() => settle(index, slot.reply));
        return null;
      }
      if (command.type === "get_last_assistant_text")
        return { text: this.lastText };
      return null;
    },
  };
  return session;
}

function makeFakeRuntime({ repliesByAgent = {}, prestarted = [] } = {}) {
  const sessions = new Map();
  for (const memberId of prestarted) {
    sessions.set(memberId, makeFakeSession(repliesByAgent[memberId] ?? []));
  }
  return {
    sessions,
    findSession: (member) => sessions.get(member.id),
    async startSession(member) {
      if (!member.workspace_path)
        throw new Error("Agent has no workspace bound");
      const session = makeFakeSession(repliesByAgent[member.id] ?? []);
      sessions.set(member.id, session);
      return {
        sessionId: member.id,
        sessionFile: `/sessions/${member.id}.jsonl`,
      };
    },
  };
}

function setupAgentAndChannel({
  name,
  channelName = "task-loop",
  join = true,
}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-task-ws-"));
  const agent = createAgent({ name, workspacePath: ws });
  const channel = createChannel({ name: channelName });
  if (join) joinChannel(channel.id, agent.id);
  return { agent, channel, ws };
}

// ---------------------------------------------------------------------------
// parseAgentAction：task 字段
// ---------------------------------------------------------------------------

test("parseAgentAction parses the optional task op", () => {
  const withClaim = parseAgentAction(
    '{"action":"reply","content":"on it","task":{"number":2,"op":"claim"}}',
  );
  assert.deepEqual(withClaim, {
    action: "reply",
    content: "on it",
    onConflict: "revise",
    task: { number: 2, op: "claim" },
  });

  const withComplete = parseAgentAction(
    '{"action":"reply","content":"done","task":{"number":1,"op":"complete"}}',
  );
  assert.equal(withComplete.task.op, "complete");

  const malformed = parseAgentAction(
    '{"action":"reply","content":"x","task":{"number":0,"op":"claim"}}',
  );
  assert.equal(malformed.task, undefined);
  const badOp = parseAgentAction(
    '{"action":"reply","content":"x","task":{"number":1,"op":"steal"}}',
  );
  assert.equal(badOp.task, undefined);

  const plain = parseAgentAction("just text");
  assert.equal(plain.task, undefined);
});

test("buildReplyPrompt documents the task protocol", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "task-prompter" });
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [],
    tasks: [
      { number: 1, status: "todo", preview: "fix", ownerName: "unassigned" },
    ],
    targetId: channel.id,
    baseSeq: 1,
  });
  assert.match(prompt, /"task":\{"number":N,"op":"claim"\}/);
  assert.match(prompt, /"task":\{"number":N,"op":"complete"\}/);
  assert.match(prompt, /"task":\{"number":N,"op":"unclaim"\}/);
  assert.match(prompt, /in_review/);
});

// ---------------------------------------------------------------------------
// claim：先 claim 再开工；回复落任务线程；失败让路
// ---------------------------------------------------------------------------

test("claim success: agent claims the task and its reply lands in the task thread", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "claimer" });
  const anchor = sendAsOwner(channel.id, "please build the widget");
  const task = createTask({ messageId: anchor.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}',
        },
      ],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "replied");
  const db = globalThis.__workspliceDb;
  // 回复落在任务线程（anchor 消息 target）。channel 本体是锚点消息 + createTask 落下的
  // 「任务已创建」事件消息（§3.7 可认领信号——没有它 Convert to Task 起不了认领轮）。
  assert.equal(db.listMessages(channel.id).length, 2);
  const thread = db.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].author_id, agent.id);
  assert.equal(thread[0].content, "building it now");

  const claimed = db.getTaskById(task.id);
  assert.equal(claimed.status, "in_progress");
  assert.equal(claimed.owner_id, agent.id);
  // channel 游标收口到已读版本（两条都读到）；线程游标故意留口（自醒续工信号，见 wake.ts）
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 2);
  assert.equal(db.getConsumedSeq(agent.id, anchor.id), 0);
});

test("claim held: the agent yields without replying and only acks what it read", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "held-claimer" });
  const anchor = sendAsOwner(channel.id, "please build the widget");
  const task = createTask({ messageId: anchor.id });
  // 房间在 agent 写稿期间变化（锚点 seq 1 + 任务事件消息 seq 2 + 这条 seq 3）：baseSeq=1 已过期
  sendAsOwner(channel.id, "please hurry");

  const outcome = await runTaskOperation({
    agent,
    channel,
    targetId: channel.id,
    action: {
      action: "reply",
      content: "building it now",
      onConflict: "revise",
      task: { number: 1, op: "claim" },
    },
    baseSeq: 1,
    promptFn: async () => {
      throw new Error("must not prompt after a held claim");
    },
  });

  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /held/);
  const db = globalThis.__workspliceDb;
  assert.equal(
    db.listMessages(channel.id).length,
    3,
    "nothing was posted（锚点 + 任务事件消息 + 期间那条）",
  );
  assert.equal(
    db.getTaskById(task.id).owner_id,
    null,
    "the claim was not written",
  );
  // 只推进到已读版本：seq 2 未消费 → 其 wake 会再触发一轮重读
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 1);
  assert.equal(db.getConsumedSeq(agent.id, anchor.id), 0);
});

test("claim conflict: another agent already claimed; this agent yields", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "loser" });
  const anchor = sendAsOwner(channel.id, "race task");
  const task = createTask({ messageId: anchor.id });
  const rival = createAgent({
    name: "rival",
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-race-")),
  });
  joinChannel(channel.id, rival.id);
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: rival.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"mine!","task":{"number":1,"op":"claim"}}',
        },
      ],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /already claimed/);
  const db = globalThis.__workspliceDb;
  assert.equal(db.listMessages(anchor.id).length, 0, "no reply was posted");
  assert.equal(
    db.getTaskById(task.id).owner_id,
    rival.id,
    "ownership unchanged",
  );
});

test("claim blocked: a reopened task cannot be auto-claimed; the agent yields", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "reopened-blocked" });
  const anchor = sendAsOwner(channel.id, "rework the widget");
  const task = createTask({ messageId: anchor.id });
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });
  // close → reopen（任何成员可执行）：置 reopened 标记回池
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: 1,
    status: "closed",
    memberId: agent.id,
  });
  const reopened = updateTaskStatus({
    channelId: channel.id,
    taskNumber: 1,
    status: "todo",
    memberId: agent.id,
  });
  assert.equal(reopened.task.reopened, 1);

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"on it again","task":{"number":1,"op":"claim"}}',
        },
      ],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /reopened/);
  const db = globalThis.__workspliceDb;
  assert.equal(db.listMessages(anchor.id).length, 0, "no reply was posted");
  assert.equal(db.getTaskById(task.id).owner_id, null, "still in the pool");
  assert.equal(db.getTaskById(task.id).reopened, 1, "marker stays");
});

// ---------------------------------------------------------------------------
// complete：回复落线程 + 状态置 in_review（互审）
// ---------------------------------------------------------------------------

test("complete: the owning agent posts progress then sets in_review", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "completer" });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}',
        },
      ],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "silent");
  assert.match(outcome.reason, /complete/);
  const db = globalThis.__workspliceDb;
  assert.equal(db.getTaskById(task.id).status, "in_review");
  const thread = db.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].content, "done, please verify");
});

test("a task-owner ignore while someone else posts in the in-progress thread is a must-respond failure", async () => {
  // §05 兜底：进行中任务 owner 收到任务线程里他人的消息 = 确定信号——ignore 不合法，
  // 按失败处理（error、不 ack）；owner 自己回复引发的自醒续工轮不受影响（incoming 为空）
  const { agent, channel } = setupAgentAndChannel({ name: "thread-owner" });
  const anchor = sendAsOwner(channel.id, "refactor the module");
  const task = createTask({ messageId: anchor.id });
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });

  sendAsOwner(anchor.id, "any progress on this?");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });

  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "error");
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_progress",
  );
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    0,
    "thread cursor not advanced",
  );
});

test("a task error round does not reset the must-respond streak (05: only success rounds reset)", async () => {
  // §05「成功轮（delivered / 任务操作 / 无信号 ignore）重置计数」——任务 error 轮不是成功轮：
  // 任务路径此前在 error 判定前无条件 reset，模型可交替「ignore → 任务 error」无限规避
  // cap-ack 逃逸口（streak 永不达 2）。修复后 error 轮不重置，下一次 ignore 即 capped。
  const { agent, channel } = setupAgentAndChannel({
    name: "streak-task-error",
  });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });

  // 轮 1：线程他人消息（must-respond）→ ignore = 失败（streak 1，线程游标不推进）
  sendAsOwner(anchor.id, "any progress?");
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore"}' },
        {
          text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}',
        },
        { text: '{"action":"reply","content":""}' },
        { text: '{"action":"ignore"}' },
      ],
    },
  });
  const first = await runAgentRound(agent.id, anchor.id, runtime);
  assert.equal(first.status, "error");
  assert.match(first.reason, /must-respond/i);

  // 轮 2：complete 的线程回复被 mid-work 消息 hold → revise 空内容 = error 轮
  // （不得重置 streak——任务状态收口仍完成，线程游标停在已读版本）
  const secondPromise = runAgentRound(agent.id, anchor.id, runtime);
  sendAsOwner(anchor.id, "@streak-task-error any update?");
  const second = await secondPromise;
  assert.equal(second.status, "error");
  assert.equal(second.reason, "revised reply had no content");
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_review",
  );

  // 轮 3：mid-work 的 @mention 仍 pending → ignore → streak 应为 2 → capped
  // （修复前 error 轮重置了 streak，这里只会是普通失败 #1）
  const third = await runAgentRound(agent.id, anchor.id, runtime);
  assert.equal(third.status, "error");
  assert.match(third.reason, /capped at 2/, "streak 未被任务 error 轮重置");
});

test("complete: a non-owner agent yields instead of touching the task", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "interloper" });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });
  const owner = createAgent({
    name: "real-owner",
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-owner-")),
  });
  joinChannel(channel.id, owner.id);
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: owner.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"I finished it","task":{"number":1,"op":"complete"}}',
        },
      ],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /not owned/);
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_progress",
  );
  assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 0);
});

// ---------------------------------------------------------------------------
// unclaim：释放回池
// ---------------------------------------------------------------------------

test("unclaim: the owner releases the task back to the pool", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "unclaimer" });
  const anchor = sendAsOwner(channel.id, "too busy for this");
  const task = createTask({ messageId: anchor.id });
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore","task":{"number":1,"op":"unclaim"}}' },
      ],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "silent");
  const db = globalThis.__workspliceDb;
  const released = db.getTaskById(task.id);
  assert.equal(released.status, "todo");
  assert.equal(released.owner_id, null);
  assert.equal(db.listMessages(anchor.id).length, 0);
});

// ---------------------------------------------------------------------------
// complete 的 freshness：以 agent 语境版本起步，held 后按 roomSeq 重试
// ---------------------------------------------------------------------------

test("complete: a channel message landing mid-work holds the status update, then retries with the fresh room version", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "held-complete" });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}',
        },
        {
          text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}',
        },
      ],
    },
  });

  await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_progress",
  );
  // 锚点 + createTask 的「任务已创建」事件消息都读到 ⇒ 语境停在 seq 2
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    2,
  );

  // agent 干活的"期间"频道来了新消息（其语境停留在 consumed=2）
  sendAsOwner(channel.id, "update from the human mid-work");

  const second = await runAgentRound(agent.id, anchor.id, runtime);
  assert.equal(second.status, "silent");
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_review",
    "held 后按 roomSeq 重试成功",
  );
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    2,
  );
});

test("complete: a revised empty thread reply is an error round, not a silent badge (11)", async () => {
  // 11-整改：complete 的线程回复被 hold 后重写也退化（reply 无内容）= error 轮——
  // 不标「已放弃」badge（silent 会被标，但线程消息仍 pending、下次 wake 会续工重试）；
  // 任务状态收口不受影响（in_review）
  const { agent, channel } = setupAgentAndChannel({
    name: "held-complete-empty",
  });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}',
        },
        {
          text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}',
        },
        { text: '{"action":"reply","content":""}' },
      ],
    },
  });

  await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_progress",
  );

  // 续工轮 drain 后线程来了他人消息（写稿期间到达 → 线程回复被 hold → revise → 空内容）
  const outcomePromise = runAgentRound(agent.id, anchor.id, runtime);
  sendAsOwner(anchor.id, "reviewer note mid-work");
  const outcome = await outcomePromise;

  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "revised reply had no content");
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_review",
    "任务状态收口不受影响",
  );
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    1,
    "线程游标停在已读版本——写稿期间到达的 reviewer note（seq 2）保持 pending",
  );
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id).length,
    2,
    "空内容重写不落库（claim 回复 + reviewer note）",
  );
});

test("complete: a reviewer closing the task mid-work does not crash the round and acks the cursors", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "scooped" });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });
  const reviewer = createAgent({
    name: "reviewer",
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-scoop-")),
  });
  joinChannel(channel.id, reviewer.id);
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });
  ack(agent.id, channel.id, 1);

  // 审查者（另一成员）在 agent 干活期间取消任务
  const closed = await import("../domain/collab/tasks.ts").then((m) =>
    m.updateTaskStatus({
      channelId: channel.id,
      taskNumber: 1,
      status: "closed",
      memberId: reviewer.id,
    }),
  );
  assert.equal(closed.status, "updated");

  const outcome = await runTaskOperation({
    agent,
    channel,
    targetId: anchor.id,
    action: {
      action: "reply",
      content: "done, please verify",
      onConflict: "revise",
      task: { number: 1, op: "complete" },
    },
    baseSeq: 0,
    promptFn: async () => "",
  });

  assert.equal(outcome.status, "silent");
  assert.match(outcome.reason, /update failed|transition/);
  const db = globalThis.__workspliceDb;
  assert.equal(
    db.getTaskById(task.id).status,
    "closed",
    "任务保持审查者取消的状态",
  );
  // 回复仍落线程（不吞），两个游标都收口（不会永久 pending 反复重试）
  assert.equal(db.listMessages(anchor.id).length, 1);
  assert.equal(db.getConsumedSeq(agent.id, anchor.id), 1);
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 1);
});

// ---------------------------------------------------------------------------
// 未知任务号：让路
// ---------------------------------------------------------------------------

test("a task op referencing a missing task number yields", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "ghost-task" });
  sendAsOwner(channel.id, "nothing here is a task");

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"on it","task":{"number":9,"op":"claim"}}',
        },
      ],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /not found/);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
});

// ---------------------------------------------------------------------------
// 演示闭环：claim → complete(in_review) → 审查者 approve → done
// ---------------------------------------------------------------------------

test("the full demo loop: claim → continuation wake → complete → approve → done", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "demo" });
  const anchor = sendAsOwner(channel.id, "build the widget");
  const task = createTask({ messageId: anchor.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}',
        },
        {
          text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}',
        },
      ],
    },
  });

  // 第一轮 wake（channel）：claim + 回复落线程；线程游标留口 = 自醒续工信号
  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, "replied");
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_progress",
  );

  // 第二轮（自醒，target = 锚点线程）：drain 到自己的进度 → 续工 → complete → in_review
  const session = runtime.sessions.get(agent.id);
  assert.equal(session.prompts.length, 1);
  const second = await runAgentRound(agent.id, anchor.id, runtime);
  assert.equal(second.status, "silent");
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).status,
    "in_review",
  );
  assert.equal(
    session.prompts.length,
    2,
    "continuation round re-prompts with the thread context",
  );
  assert.match(session.prompts[1], /task #1 \[in_progress\]/);
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    2,
    "线程游标在收口后推进",
  );

  // 人（或另一 agent）互审：approve → done
  const reviewer = createAgent({
    name: `reviewer-${++fixtureSeq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-review-")),
  });
  joinChannel(channel.id, reviewer.id);
  const updated = await import("../domain/collab/tasks.ts").then((m) =>
    m.updateTaskStatus({
      channelId: channel.id,
      taskNumber: 1,
      status: "done",
      memberId: reviewer.id,
    }),
  );
  assert.equal(updated.status, "updated");
  assert.equal(updated.task.status, "done");
  assert.equal(
    globalThis.__workspliceDb.getTaskById(task.id).owner_id,
    agent.id,
  );

  // done 后任务不再出现在 open 列表（board 收口）
  const board = listChannelTasks(channel.id);
  assert.equal(board[0].status, "done");
});

// ---------------------------------------------------------------------------
// 自激循环回归（一条消息 → 转任务 → agent 永远"续工"）：一次外部输入至多
// claim + 一次续工轮；自己回复链不得连续自醒
// ---------------------------------------------------------------------------

test("task continuation self-wake is bounded: claim + at most one continuation round", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "loop-break" });
  const anchor = sendAsOwner(channel.id, "build the widget");
  const task = createTask({ messageId: anchor.id });

  const runtime = makeFakeRuntime();
  const session = makeFakeSession([
    {
      text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}',
    },
    {
      text: '{"action":"reply","content":"progressing","onConflict":"revise"}',
    },
    {
      text: '{"action":"reply","content":"still going","onConflict":"revise"}',
    },
  ]);
  runtime.sessions.set(agent.id, session);

  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({
      agentId: agent.id,
      targetId: channel.id,
      seq: 1,
      reason: "message",
    });
    await waitFor(() => session.prompts.length === 2, 3000);
    // 留时间窗口给可能的自激循环（bug 下 prompts 会无限增长）
    await sleep(300);
    assert.equal(
      session.prompts.length,
      2,
      `claim 落线程后至多一次续工轮：自己回复链不得连续自醒（实际 ${session.prompts.length}）`,
    );
    assert.equal(
      globalThis.__workspliceDb.getTaskById(task.id).status,
      "in_progress",
    );
    const thread = globalThis.__workspliceDb.listMessages(anchor.id);
    assert.equal(thread.length, 2, "claim 回复 + 一次续工回复");
  } finally {
    stop();
  }
});

test("a continuation prompt labels the agent's own messages and tells it not to reply to them", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "self-label" });
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [
      {
        id: "m1",
        target_id: channel.id,
        seq: 1,
        author_id: agent.id,
        content: "@self-label 进展中",
        created_at: "",
        author: { id: agent.id, name: agent.name },
      },
    ],
    tasks: [],
    targetId: channel.id,
    baseSeq: 1,
  });
  assert.match(prompt, /YOUR OWN|your own/i);
  assert.match(prompt, /self-mention|not a demand/i);
});

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 两条创建途径的轮次收敛（createTask 事件消息 + board 途径自带用户消息）
// ---------------------------------------------------------------------------

test("board 途径（用户消息 + createTask 事件消息）只跑一轮：第一轮 drain 两条消息并 claim 成功", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "board-creator" });
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"reply","content":"on it","task":{"number":1,"op":"claim"}}' },
        { text: '{"action":"reply","content":"progressing","onConflict":"revise"}' },
      ],
    },
  });

  // driver 必须先起：enqueueWake 在未 started 时直接丢弃 hint。
  const stop = startAgentLoopDriver({ runtime });
  try {
    // board 途径：先 sendMessage（wake:true）再建任务（事件消息再 wake:true 一次）
    const userMessage = sendAsOwner(channel.id, "ship the release notes");
    createTask({ messageId: userMessage.id });

    const session = () => runtime.sessions.get(agent.id);
    // claim 落库即第一轮收口；留窗口给续工轮（§3.7 自醒，见下一条断言）
    await waitFor(() => listChannelTasks(channel.id)[0]?.status === "in_progress", 5000);
    await new Promise((r) => setTimeout(r, 300));

    // 同 target 的两条 hint 必须合并成一轮：drain 一次取尽用户消息 + 事件消息 ⇒
    // 房间版本停在 seq 2，claim 不被自己顶出的事件消息 hold。
    assert.match(session().prompts[0], /ship the release notes/, "第一轮 drain 到用户消息");
    assert.match(session().prompts[0], /Task #1 created/, "第一轮同时 drain 到事件消息");

    const channelRounds = globalThis.__workspliceDb
      .listRoundLogs(agent.id)
      .filter((r) => r.target_id === channel.id);
    assert.equal(channelRounds.length, 1, "channel 只起一轮（两条 hint 合并）");
    assert.equal(channelRounds[0].status, "replied");
    assert.doesNotMatch(
      channelRounds[0].reason ?? "",
      /claim held/,
      "第一轮 claim 未被事件消息 hold 让路",
    );
    // 注意 round_logs.base_seq 的既有语义：claim 轮返回的是**线程**版本
    // （deliverToTaskThread 的 threadAckSeq），不是 channel 的 drain 版本。
    // 「第一轮 drain 到两条消息」由 channel 游标（ack 收口到本轮读到的版本）证明。
    assert.equal(
      globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
      2,
      "一轮就 ack 到两条消息的版本（seq 1 + 事件消息 seq 2）",
    );

    const task = listChannelTasks(channel.id)[0];
    assert.equal(task.status, "in_progress", "第一轮 claim 成功");
    assert.equal(task.owner_id, agent.id);

    // 第二轮是 §3.7 任务延续自醒（owner 回复落自己的任务线程 → 续工轮），既有语义：
    // 目标不同（任务线程）、与本票的 hint 合并无关。
    assert.equal(session().prompts.length, 2);
    assert.match(session().prompts[1], /YOUR OWN/);

    // 认领回复落任务线程（anchor 消息 target），不回灌 channel
    const thread = globalThis.__workspliceDb.listMessages(userMessage.id);
    assert.equal(thread.length, 2, "claim 回复 + 一次续工回复");
    assert.equal(thread[0].content, "on it");
    assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 2, "用户消息 + 事件消息");
  } finally {
    stop();
  }
});

// ---------------------------------------------------------------------------
// 同 target hint 在「本轮已出队」之后到达：必须起新一轮，不得丢
// ---------------------------------------------------------------------------

test("a same-target hint arriving while its round is already dequeued starts a new round instead of being dropped", async () => {
  // 硬约束 1（绝不丢 hint）：合并窗口只覆盖「出队前」。第一轮出队并 drain 之后到达的
  // 同 target hint 已经不在那轮的 drain 视野里——把它并进在跑的那一轮等于丢消息，
  // 所以它必须留在队列里、被随后的循环 shift 出来跑新一轮。
  //
  // 用 gated session 把「在飞」窗口撑开：普通 fake session 在一个微任务里就发完
  // prompt_done，轮次瞬间收口，测试根本观察不到处理期间到达的 hint（那样这条用例
  // 会变成空断言）。这里由测试显式 release 第一轮，制造确定性的在飞窗口。
  const { agent, channel } = setupAgentAndChannel({ name: "late-hint" });
  // 第一轮 ignore：ack 只收口到**本轮 drain 到的版本**（seq 1），late 消息保持 pending
  // ⇒ 第二轮确实有东西可 drain（若第一轮就 ack 越过 late，第二轮会 noop，测不到东西）。
  const gated = makeFakeSession(
    [
      { text: '{"action":"ignore"}' },
      { text: '{"action":"reply","content":"answering the late ask"}' },
    ],
    { gated: true },
  );
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, gated);

  const stop = startAgentLoopDriver({ runtime });
  try {
    sendAsOwner(channel.id, "first ask");

    // 第一轮已出队、已 drain、已发 prompt——但被 gate 住没收口，此刻它确实「在飞」
    await waitFor(() => gated.pending.length === 1, 3000);
    assert.match(gated.prompts[0], /first ask/);

    // 处理期间到达的同 target hint：既不能并进在跑的一轮（那轮 drain 已完成），
    // 也不能被丢弃——它必须起第二轮。
    const late = sendAsOwner(channel.id, "second ask");
    // 等 hint 确实入队（driver 已把它 push 成第二条 entry），再用「没有第二个 prompt」
    // 证明它在飞的那轮里没有被消费掉。
    await waitFor(() => peekAgentLoopQueues().some((q) => q.agentId === agent.id && q.entries.length > 0), 3000);
    assert.equal(
      gated.prompts.length,
      1,
      "在飞的一轮不会被新 hint 打断重发 prompt（循环正 await 在跑的那轮）",
    );

    // 放行第一轮 → 循环 shift 出 late hint 跑第二轮
    gated.release(0);
    await waitFor(() => gated.pending.length === 2, 3000);
    gated.release(1);
    await waitFor(
      () => globalThis.__workspliceDb.listMessages(channel.id).length === 3,
      3000,
    );

    assert.equal(gated.prompts.length, 2, "late hint 起了第二轮，没有被丢弃");
    assert.doesNotMatch(
      gated.prompts[0],
      /second ask/,
      "第一轮 drain 早于 late 消息，不该看到它",
    );
    assert.match(gated.prompts[1], /second ask/, "第二轮 drain 到处理期间到达的 hint");

    // 落库证据：第二轮的回复写进 channel，游标收口到 late 消息的版本
    const messages = globalThis.__workspliceDb.listMessages(channel.id);
    assert.equal(messages.length, 3, "两条用户消息 + 第二轮回复");
    assert.equal(messages[0].content, "first ask");
    assert.equal(messages[1].content, "second ask");
    assert.equal(messages[2].content, "answering the late ask");
    assert.equal(messages[2].target_id, channel.id, "ordinary channel replies remain in the channel target");
    assert.equal(
      globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
      late.seq,
      "游标收口到 late hint 的 seq（它被消费了，不是被静默丢弃）",
    );
  } finally {
    gated.releaseAll();
    stop();
  }
});

test("Convert to Task 途径（无用户消息）也能起一轮：agent drain 到事件消息并 claim", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "convert-only" });
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"fixing it","task":{"number":1,"op":"claim"}}' }],
    },
  });

  // 锚点消息是更早发的、那一轮早已消费完；这里只让 createTask 的事件消息去唤醒，
  // 于是被测的就是「Convert 之后有没有新信号可 drain」这一件事。
  const anchor = sendAsOwner(channel.id, "please fix the flaky test");
  globalThis.__workspliceDb.setConsumedSeq(agent.id, channel.id, anchor.seq);
  const stop = startAgentLoopDriver({ runtime });
  try {
    // 右键 Convert to Task：只调 createTask，不先发消息。改前此处零 wake、零消息，
    // runAgentRound 在 drained.messages.length === 0 处早退 noop，任务永远躺在 todo。
    createTask({ messageId: anchor.id });

    const session = () => runtime.sessions.get(agent.id);
    const deadline = Date.now() + 5000;
    while ((session()?.prompts.length ?? 0) === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 300));

    // 第 1 轮 = 本票修的那条路（drain 到事件消息 → Related open tasks → claim）。
    // 第 2 轮 = §3.7 任务延续自醒：owner 回复落自己的任务线程 → 再起一轮续工（既有语义）。
    assert.equal(session().prompts.length, 2);
    assert.match(session().prompts[0], /Task #1 created/);
    assert.match(session().prompts[0], /Related open tasks/);
    assert.match(session().prompts[1], /YOUR OWN/);
    const tasks = listChannelTasks(channel.id);
    assert.equal(tasks[0].status, "in_progress", "agent 认领成功");
    assert.equal(tasks[0].owner_id, agent.id);
    // 认领回复落任务线程（anchor 消息 target），不回灌 channel
    assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 2);
    const thread = globalThis.__workspliceDb.listMessages(anchor.id);
    assert.equal(thread.length, 1);
    assert.equal(thread[0].content, "fixing it");
  } finally {
    stop();
  }
});

test("Owner 发消息并创建任务后，agent 认领且任务回复落锚点线程", async () => {
  const { agent: first, channel } = setupAgentAndChannel({ name: "task-route-first" });
  const second = createAgent({
    name: `task-route-second-${++fixtureSeq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-task-ws-")),
  });
  joinChannel(channel.id, second.id);
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [first.id]: [
        { text: '{"action":"reply","content":"first agent task answer","onConflict":"anyway"}' },
        { text: '{"action":"ignore"}' },
      ],
      [second.id]: [
        { text: '{"action":"reply","content":"second agent task answer","onConflict":"anyway"}' },
        { text: '{"action":"ignore"}' },
      ],
    },
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    const response = await postTask(new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: channel.id, content: "Please implement the export" }),
    }));
    assert.equal(response.status, 201);
    const { task: created } = await response.json();

    const db = globalThis.__workspliceDb;
    const agentIds = [first.id, second.id];
    await waitFor(() => agentIds.every((id) =>
      db.listRoundLogs(id).some((round) => round.target_id === channel.id),
    ));

    for (const id of agentIds) {
      const prompt = runtime.sessions.get(id).prompts[0];
      assert.match(prompt, /Task #1 created/, "the create-task event is in the drained prompt");
      assert.match(prompt, /Related open tasks:/, "the prompt sees the persisted task");
    }

    const task = listChannelTasks(channel.id)[0];
    const channelMessages = db.listMessages(channel.id);
    const threadReplies = db.listMessages(task.message_id);
    assert.deepEqual(
      {
        taskStatus: task.status,
        hasOwner: Boolean(task.owner_id),
        topLevelTaskReplies: channelMessages.filter((message) => message.content.endsWith("task answer")).length,
        threadReplyCount: threadReplies.length,
      },
      {
        taskStatus: "in_progress",
        hasOwner: true,
        topLevelTaskReplies: 0,
        threadReplyCount: 1,
      },
      "task creation should claim once and route the answer to its anchor thread",
    );

    assert.equal(task.id, created.id);
    assert.ok(agentIds.includes(task.owner_id));

    assert.equal(channelMessages[0].content, "Please implement the export");
    assert.match(channelMessages[1].content, /Task #1 created/);
    assert.equal(channelMessages.length, 2, "task answers must not become channel messages");
    assert.equal(threadReplies[0].target_id, task.message_id);
    assert.equal(threadReplies[0].author_id, task.owner_id);

    const loserId = agentIds.find((id) => id !== task.owner_id);
    const loserRound = db.listRoundLogs(loserId).find((round) => round.target_id === channel.id);
    assert.equal(loserRound.status, "yielded", "the losing claimant yields without a top-level reply");
  } finally {
    stop();
  }
});

test("task anchor 与普通频道消息同轮到达时，普通答复仍留在频道", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "task-route-mixed" });
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"answering the separate question"}' }],
    },
  });
  const response = await postTask(new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId: channel.id, content: "Please implement the export" }),
  }));
  assert.equal(response.status, 201);
  const { task: created } = await response.json();
  sendAsOwner(channel.id, "Task #1 created — What time is the review?");

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");
  const task = listChannelTasks(channel.id)[0];
  assert.equal(task.id, created.id);
  assert.equal(task.status, "todo", "the unrelated reply does not claim the task");
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages.at(-1).content, "answering the separate question");
  assert.equal(messages.at(-1).target_id, channel.id);
  assert.equal(globalThis.__workspliceDb.listMessages(task.message_id).length, 0);
});
