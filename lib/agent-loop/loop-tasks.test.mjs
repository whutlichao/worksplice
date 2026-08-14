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

const { createAgent } = await import("../domain/raft/members.ts");
const { createChannel, joinChannel } = await import("../domain/raft/channels.ts");
const { sendMessage } = await import("../domain/raft/messages.ts");
const { createTask, claimTask, updateTaskStatus, listChannelTasks } = await import("../domain/raft/tasks.ts");
const { ack } = await import("../domain/raft/inbox.ts");
const { parseAgentAction, buildReplyPrompt, runAgentRound, runTaskOperation } = await import("./loop.ts");
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
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
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
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      const session = makeFakeSession(repliesByAgent[member.id] ?? []);
      sessions.set(member.id, session);
      return { sessionId: member.id, sessionFile: `/sessions/${member.id}.jsonl` };
    },
  };
}

function setupAgentAndChannel({ name, channelName = "task-loop", join = true }) {
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
  const withClaim = parseAgentAction('{"action":"reply","content":"on it","task":{"number":2,"op":"claim"}}');
  assert.deepEqual(withClaim, { action: "reply", content: "on it", onConflict: "revise", task: { number: 2, op: "claim" } });

  const withComplete = parseAgentAction('{"action":"reply","content":"done","task":{"number":1,"op":"complete"}}');
  assert.equal(withComplete.task.op, "complete");

  const malformed = parseAgentAction('{"action":"reply","content":"x","task":{"number":0,"op":"claim"}}');
  assert.equal(malformed.task, undefined);
  const badOp = parseAgentAction('{"action":"reply","content":"x","task":{"number":1,"op":"steal"}}');
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
    tasks: [{ number: 1, status: "todo", preview: "fix", ownerName: "unassigned" }],
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
      [agent.id]: [{ text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}' }],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "replied");
  const db = globalThis.__workspliceDb;
  // 回复落在任务线程（anchor 消息 target），channel 本体只有原来的消息
  assert.equal(db.listMessages(channel.id).length, 1);
  const thread = db.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].author_id, agent.id);
  assert.equal(thread[0].content, "building it now");

  const claimed = db.getTaskById(task.id);
  assert.equal(claimed.status, "in_progress");
  assert.equal(claimed.owner_id, agent.id);
  // channel 游标收口到已读版本；线程游标故意留口（自醒续工信号，见 wake.ts）
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 1);
  assert.equal(db.getConsumedSeq(agent.id, anchor.id), 0);
});

test("claim held: the agent yields without replying and only acks what it read", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "held-claimer" });
  const anchor = sendAsOwner(channel.id, "please build the widget");
  const task = createTask({ messageId: anchor.id });
  // 房间在 agent 写稿期间变化（seq 2）：baseSeq=1 已过期
  sendAsOwner(channel.id, "please hurry");

  const outcome = await runTaskOperation({
    agent,
    channel,
    targetId: channel.id,
    action: { action: "reply", content: "building it now", onConflict: "revise", task: { number: 1, op: "claim" } },
    baseSeq: 1,
    promptFn: async () => {
      throw new Error("must not prompt after a held claim");
    },
  });

  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /held/);
  const db = globalThis.__workspliceDb;
  assert.equal(db.listMessages(channel.id).length, 2, "nothing was posted");
  assert.equal(db.getTaskById(task.id).owner_id, null, "the claim was not written");
  // 只推进到已读版本：seq 2 未消费 → 其 wake 会再触发一轮重读
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 1);
  assert.equal(db.getConsumedSeq(agent.id, anchor.id), 0);
});

test("claim conflict: another agent already claimed; this agent yields", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "loser" });
  const anchor = sendAsOwner(channel.id, "race task");
  const task = createTask({ messageId: anchor.id });
  const rival = createAgent({ name: "rival", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-race-")) });
  joinChannel(channel.id, rival.id);
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: rival.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"mine!","task":{"number":1,"op":"claim"}}' }],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /already claimed/);
  const db = globalThis.__workspliceDb;
  assert.equal(db.listMessages(anchor.id).length, 0, "no reply was posted");
  assert.equal(db.getTaskById(task.id).owner_id, rival.id, "ownership unchanged");
});

test("claim blocked: a reopened task cannot be auto-claimed; the agent yields", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "reopened-blocked" });
  const anchor = sendAsOwner(channel.id, "rework the widget");
  const task = createTask({ messageId: anchor.id });
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });
  // close → reopen（任何成员可执行）：置 reopened 标记回池
  updateTaskStatus({ channelId: channel.id, taskNumber: 1, status: "closed", memberId: agent.id });
  const reopened = updateTaskStatus({ channelId: channel.id, taskNumber: 1, status: "todo", memberId: agent.id });
  assert.equal(reopened.task.reopened, 1);

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"on it again","task":{"number":1,"op":"claim"}}' }],
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
      [agent.id]: [{ text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}' }],
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
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_progress");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id), 0, "thread cursor not advanced");
});

test("a task error round does not reset the must-respond streak (05: only success rounds reset)", async () => {
  // §05「成功轮（delivered / 任务操作 / 无信号 ignore）重置计数」——任务 error 轮不是成功轮：
  // 任务路径此前在 error 判定前无条件 reset，模型可交替「ignore → 任务 error」无限规避
  // cap-ack 逃逸口（streak 永不达 2）。修复后 error 轮不重置，下一次 ignore 即 capped。
  const { agent, channel } = setupAgentAndChannel({ name: "streak-task-error" });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });

  // 轮 1：线程他人消息（must-respond）→ ignore = 失败（streak 1，线程游标不推进）
  sendAsOwner(anchor.id, "any progress?");
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore"}' },
        { text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}' },
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
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_review");

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
  const owner = createAgent({ name: "real-owner", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-owner-")) });
  joinChannel(channel.id, owner.id);
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: owner.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"I finished it","task":{"number":1,"op":"complete"}}' }],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /not owned/);
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_progress");
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
      [agent.id]: [{ text: '{"action":"ignore","task":{"number":1,"op":"unclaim"}}' }],
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
        { text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}' },
        { text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}' },
      ],
    },
  });

  await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_progress");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);

  // agent 干活的"期间"频道来了新消息（其语境停留在 consumed=1）
  sendAsOwner(channel.id, "update from the human mid-work");

  const second = await runAgentRound(agent.id, anchor.id, runtime);
  assert.equal(second.status, "silent");
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_review", "held 后按 roomSeq 重试成功");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id), 2);
});

test("complete: a revised empty thread reply is an error round, not a silent badge (11)", async () => {
  // 11-整改：complete 的线程回复被 hold 后重写也退化（reply 无内容）= error 轮——
  // 不标「已放弃」badge（silent 会被标，但线程消息仍 pending、下次 wake 会续工重试）；
  // 任务状态收口不受影响（in_review）
  const { agent, channel } = setupAgentAndChannel({ name: "held-complete-empty" });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}' },
        { text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}' },
        { text: '{"action":"reply","content":""}' },
      ],
    },
  });

  await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_progress");

  // 续工轮 drain 后线程来了他人消息（写稿期间到达 → 线程回复被 hold → revise → 空内容）
  const outcomePromise = runAgentRound(agent.id, anchor.id, runtime);
  sendAsOwner(anchor.id, "reviewer note mid-work");
  const outcome = await outcomePromise;

  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "revised reply had no content");
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_review", "任务状态收口不受影响");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    1,
    "线程游标停在已读版本——写稿期间到达的 reviewer note（seq 2）保持 pending",
  );
  assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 2, "空内容重写不落库（claim 回复 + reviewer note）");
});

test("complete: a reviewer closing the task mid-work does not crash the round and acks the cursors", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "scooped" });
  const anchor = sendAsOwner(channel.id, "build it");
  const task = createTask({ messageId: anchor.id });
  const reviewer = createAgent({ name: "reviewer", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-scoop-")) });
  joinChannel(channel.id, reviewer.id);
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: agent.id });
  ack(agent.id, channel.id, 1);

  // 审查者（另一成员）在 agent 干活期间取消任务
  const closed = await import("../domain/raft/tasks.ts").then((m) =>
    m.updateTaskStatus({ channelId: channel.id, taskNumber: 1, status: "closed", memberId: reviewer.id }),
  );
  assert.equal(closed.status, "updated");

  const outcome = await runTaskOperation({
    agent,
    channel,
    targetId: anchor.id,
    action: { action: "reply", content: "done, please verify", onConflict: "revise", task: { number: 1, op: "complete" } },
    baseSeq: 0,
    promptFn: async () => "",
  });

  assert.equal(outcome.status, "silent");
  assert.match(outcome.reason, /update failed|transition/);
  const db = globalThis.__workspliceDb;
  assert.equal(db.getTaskById(task.id).status, "closed", "任务保持审查者取消的状态");
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
      [agent.id]: [{ text: '{"action":"reply","content":"on it","task":{"number":9,"op":"claim"}}' }],
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
        { text: '{"action":"reply","content":"building it now","task":{"number":1,"op":"claim"}}' },
        { text: '{"action":"reply","content":"done, please verify","task":{"number":1,"op":"complete"}}' },
      ],
    },
  });

  // 第一轮 wake（channel）：claim + 回复落线程；线程游标留口 = 自醒续工信号
  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, "replied");
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_progress");

  // 第二轮（自醒，target = 锚点线程）：drain 到自己的进度 → 续工 → complete → in_review
  const session = runtime.sessions.get(agent.id);
  assert.equal(session.prompts.length, 1);
  const second = await runAgentRound(agent.id, anchor.id, runtime);
  assert.equal(second.status, "silent");
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "in_review");
  assert.equal(session.prompts.length, 2, "continuation round re-prompts with the thread context");
  assert.match(session.prompts[1], /task #1 \[in_progress\]/);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id), 2, "线程游标在收口后推进");

  // 人（或另一 agent）互审：approve → done
  const reviewer = createAgent({ name: "reviewer", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-review-")) });
  joinChannel(channel.id, reviewer.id);
  const updated = await import("../domain/raft/tasks.ts").then((m) =>
    m.updateTaskStatus({ channelId: channel.id, taskNumber: 1, status: "done", memberId: reviewer.id }),
  );
  assert.equal(updated.status, "updated");
  assert.equal(updated.task.status, "done");
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).owner_id, agent.id);

  // done 后任务不再出现在 open 列表（board 收口）
  const board = listChannelTasks(channel.id);
  assert.equal(board[0].status, "done");
});
