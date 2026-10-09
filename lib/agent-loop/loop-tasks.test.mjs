import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

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
const { startAgentLoopDriver } = await import("./loop.ts");
const { emitWake } = await import("../domain/collab/wake.ts");
const { setAgentStatusLookup } = await import("../agent-status.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

setAgentStatusLookup(() => null);

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  const session = {
    replies,
    lastText: "",
    prompts: [],
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
    async send(command) {
      if (command.type === "prompt") {
        this.prompts.push(command.message);
        const reply = this.replies.shift();
        running = true;
        this.emit({ type: "agent_start" });
        queueMicrotask(() => {
          running = false;
          if (reply?.error) {
            this.emit({ type: "prompt_error", errorMessage: reply.error });
          } else {
            this.lastText = reply?.text ?? "";
            this.emit({ type: "prompt_done" });
          }
          this.emit({ type: "agent_end" });
        });
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

test("board 途径（用户消息 + createTask 事件消息）跑两轮：第一轮 claim 被事件消息 hold 让路（已知代价）", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "board-creator" });
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"reply","content":"on it","task":{"number":1,"op":"claim"}}' },
        { text: '{"action":"reply","content":"event message round"}' },
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
    const deadline = Date.now() + 5000;
    while ((session()?.prompts.length ?? 0) < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 300));

    // 已知代价（建单票的报告项，非本票可修）：两条 wake hint 到 driver 时，
    // 第一条已被 processAgent 同步 shift 出队，enqueueWake 的「同 (agent,target) 合并」
    // 因此无从生效 ⇒ 两轮。第一轮 baseSeq=1 已被事件消息推到 seq 2，claim 被 hold 让路。
    assert.equal(session().prompts.length, 2);
    assert.match(session().prompts[0], /ship the release notes/);
    assert.doesNotMatch(session().prompts[0], /Task #1 created/);

    const rounds = globalThis.__workspliceDb.listRoundLogs(agent.id);
    // 顺序不敏感：断言两轮各是什么，而不是它们在列表里的先后
    assert.deepEqual(
      rounds.map((r) => [r.status, r.base_seq]).sort(),
      [["replied", 2], ["yielded", 1]],
      "一轮 claim held 让路且不落回复，一轮 drain 到事件消息后正常应答",
    );
    assert.match(
      rounds.find((r) => r.status === "yielded").reason,
      /claim held/,
    );
    // 第二轮的回复落在 channel（该回复无 task op）；事件消息没被重复投递
    assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 3);
    assert.equal(
      globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
      2,
      "两轮都 ack 到已读版本",
    );
  } finally {
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
