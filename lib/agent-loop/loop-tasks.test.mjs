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

const { createAgent, getAgent } = await import("../domain/collab/members.ts");
// 名字唯一性（agent-name-uniqueness）：同一 DB 内多次创建用唯一后缀避免重名拒绝
let fixtureSeq = 0;
const { createChannel, joinChannel } = await import(
  "../domain/collab/channels.ts"
);
const { sendMessage } = await import("../domain/collab/messages.ts");
const { createTask, claimTask, updateTaskStatus, listChannelTasks } =
  await import("../domain/collab/tasks.ts");
const { ack } = await import("../domain/collab/inbox.ts");
const { parseAgentAction, buildReplyPrompt, runAgentRound, runTaskOperation, CONTENT_PLACEMENT_RUBRIC } =
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
    onConflict: "resend",
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
// P2：内容分工 rubric——频道轮 / 线程轮 / 任务线程轮共用同一固定骨架块
// ---------------------------------------------------------------------------

test("the content-placement rubric is the same fixed block for channel, plain thread and task thread, ordered between onConflict and the task protocol", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "rubric-placement" });
  const plainAnchor = sendAsOwner(channel.id, "side question");
  const taskAnchor = sendAsOwner(channel.id, "please build the widget");
  createTask({ messageId: taskAnchor.id });

  for (const targetId of [channel.id, plainAnchor.id, taskAnchor.id]) {
    const prompt = buildReplyPrompt({
      agent,
      channel,
      messages: [],
      tasks: [],
      targetId,
      baseSeq: 1,
    });
    for (const line of CONTENT_PLACEMENT_RUBRIC) {
      assert.ok(
        prompt.includes(line),
        `target ${targetId} 必须带同一条 rubric 骨架行：${line}`,
      );
    }
    const onConflictAt = prompt.indexOf(
      "onConflict applies only if the room changed",
    );
    const rubricAt = prompt.indexOf(CONTENT_PLACEMENT_RUBRIC[0]);
    const protocolAt = prompt.indexOf("Task protocol:");
    assert.ok(onConflictAt >= 0 && rubricAt >= 0 && protocolAt >= 0);
    assert.ok(
      onConflictAt < rubricAt && rubricAt < protocolAt,
      "rubric 必须落在 onConflict 之后、Task protocol 之前",
    );
    assert.match(
      prompt,
      /the app decides delivery/,
      "投递目标由系统决定：rubric 不构成模型自行改投线程的手段",
    );
  }
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

test('an agent-authored task anchor and creation event route an ordinary reply to the thread', async () => {
  const { agent, channel } = setupAgentAndChannel({ name: 'agent-authored-task-anchor' });
  const db = globalThis.__workspliceDb;
  const anchorResult = sendMessage({
    targetId: channel.id,
    authorId: agent.id,
    content: 'please build the widget',
  });
  assert.equal(anchorResult.held, false);
  const anchor = anchorResult.message;
  const task = createTask({ messageId: anchor.id });
  const event = db.listMessages(channel.id).at(-1);
  assert.equal(event.author_id, OWNER_MEMBER_ID);
  assert.match(event.content, /^Task #1 created(?: — .*)?$/);

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"reply","content":"building it now"}' },
      ],
    },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  const channelReplies = db
    .listMessages(channel.id)
    .filter((message) => message.content === 'building it now');
  assert.deepEqual(
    channelReplies.map((message) => message.target_id),
    [],
    'the reply must not target the channel',
  );
  const thread = db.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].target_id, anchor.id);
  assert.equal(thread[0].author_id, agent.id);
  assert.equal(thread[0].content, 'building it now');
  assert.equal(db.listMessages(channel.id).length, 2);

  const claimed = db.getTaskById(task.id);
  assert.equal(claimed.status, 'in_progress');
  assert.equal(claimed.owner_id, agent.id);
});

test('an ordinary reply claims a task created from an already consumed anchor', async () => {
  const { agent, channel } = setupAgentAndChannel({ name: 'task-route-late-created' });
  const db = globalThis.__workspliceDb;
  const anchor = sendAsOwner(channel.id, 'please build the widget');
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore"}' },
        { text: '{"action":"reply","content":"building it now"}' },
      ],
    },
  });

  const firstOutcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(firstOutcome.status, 'ignored');
  const consumedSeq = db.getConsumedSeq(agent.id, channel.id);
  assert.equal(consumedSeq, anchor.seq);

  const task = createTask({ messageId: anchor.id });
  const newActivity = db
    .listMessages(channel.id)
    .filter((message) => message.seq > consumedSeq);
  assert.equal(newActivity.length, 1);
  assert.equal(newActivity[0].author_id, OWNER_MEMBER_ID);
  assert.match(newActivity[0].content, /^Task #1 created(?: — .*)?$/);

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  assert.deepEqual(
    db
      .listMessages(channel.id)
      .filter((message) => message.content === 'building it now')
      .map((message) => message.target_id),
    [],
    'the task reply must not be posted in the channel',
  );
  const thread = db.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].target_id, anchor.id);
  assert.equal(thread[0].author_id, agent.id);
  assert.equal(thread[0].content, 'building it now');
  assert.equal(db.listMessages(channel.id).length, 2);

  const claimed = db.getTaskById(task.id);
  assert.equal(claimed.status, 'in_progress');
  assert.equal(claimed.owner_id, agent.id);
});

test('a self-authored reply left in the drain does not block automatic task claims', async () => {
  const db = globalThis.__workspliceDb;
  const observations = [];

  for (const route of ['anchor-plus-event', 'event-only']) {
    const { agent, channel } = setupAgentAndChannel({ name: `self-drain-${route}` });
    const firstMessage = sendAsOwner(channel.id, `initial request ${route}`);
    const firstReply = `ordinary reply ${route}`;
    const taskReply = `task reply ${route}`;
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [agent.id]: [
          { text: JSON.stringify({ action: 'reply', content: firstReply }) },
          { text: JSON.stringify({ action: 'reply', content: taskReply }) },
        ],
      },
    });

    const firstOutcome = await runAgentRound(agent.id, channel.id, runtime);
    assert.equal(firstOutcome.status, 'replied');
    const consumedSeq = db.getConsumedSeq(agent.id, channel.id);
    assert.equal(consumedSeq, firstMessage.seq);
    const priorReply = db
      .listMessages(channel.id)
      .find((message) => message.content === firstReply);
    assert.equal(priorReply?.target_id, channel.id);
    assert.ok(priorReply.seq > consumedSeq);

    const anchor =
      route === 'event-only'
        ? firstMessage
        : sendAsOwner(channel.id, `task request ${route}`);
    const task = createTask({ messageId: anchor.id });
    const event = db.listMessages(channel.id).at(-1);
    assert.equal(event.author_id, OWNER_MEMBER_ID);
    assert.match(event.content, /^Task #1 created(?: — .*)?$/);
    assert.equal(route === 'event-only', anchor.seq <= consumedSeq);
    if (route === 'anchor-plus-event') assert.equal(event.seq, anchor.seq + 1);
    else assert.ok(event.seq > consumedSeq);

    const outcome = await runAgentRound(agent.id, channel.id, runtime);
    const claimed = db.getTaskById(task.id);
    const taskReplies = [...db.listMessages(channel.id), ...db.listMessages(anchor.id)]
      .filter((message) => message.content === taskReply);

    observations.push({
      route,
      outcome: outcome.status,
      taskStatus: claimed.status,
      claimedByAgent: claimed.owner_id === agent.id,
      taskReplyTargets: taskReplies.map((message) =>
        message.target_id === anchor.id
          ? 'task anchor'
          : message.target_id === channel.id
            ? 'channel'
            : 'other',
      ),
      channelReplyCount: taskReplies.filter((message) => message.target_id === channel.id)
        .length,
    });
  }

  assert.deepEqual(observations, [
    {
      route: 'anchor-plus-event',
      outcome: 'replied',
      taskStatus: 'in_progress',
      claimedByAgent: true,
      taskReplyTargets: ['task anchor'],
      channelReplyCount: 0,
    },
    {
      route: 'event-only',
      outcome: 'replied',
      taskStatus: 'in_progress',
      claimedByAgent: true,
      taskReplyTargets: ['task anchor'],
      channelReplyCount: 0,
    },
  ]);
});

test('a nonadjacent Owner creation event still routes the reply to its matching task thread', async () => {
  // 新语义（A）：判定只看本轮最新一条其他作者消息——创建事件按 #N 唯一匹配开放任务，
  // 不要求事件与锚点相邻；同轮更早的消息即使是本 agent 自己的也不阻断。
  const { agent, channel } = setupAgentAndChannel({ name: 'task-route-self-nonadjacent' });
  const db = globalThis.__workspliceDb;
  const initialMessage = sendAsOwner(channel.id, 'initial request');
  const taskReply = 'reply to the matching task';
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: JSON.stringify({ action: 'reply', content: 'ordinary reply' }) },
        { text: JSON.stringify({ action: 'reply', content: taskReply }) },
      ],
    },
  });

  const firstOutcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(firstOutcome.status, 'replied');
  assert.equal(db.getConsumedSeq(agent.id, channel.id), initialMessage.seq);

  const anchorResult = sendMessage({
    targetId: channel.id,
    authorId: agent.id,
    content: 'task anchor authored by agent',
  });
  assert.equal(anchorResult.held, false);
  const anchor = anchorResult.message;
  const interveningResult = sendMessage({
    targetId: channel.id,
    authorId: agent.id,
    content: 'another agent-authored channel message',
  });
  assert.equal(interveningResult.held, false);
  const task = createTask({ messageId: anchor.id });
  const event = db.listMessages(channel.id).at(-1);
  assert.equal(event.author_id, OWNER_MEMBER_ID);
  assert.equal(event.seq, anchor.seq + 2);

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  const currentTask = db.getTaskById(task.id);
  assert.equal(currentTask.status, 'in_progress');
  assert.equal(currentTask.owner_id, agent.id);
  assert.equal(
    db
      .listMessages(channel.id)
      .filter((message) => message.content === taskReply).length,
    0,
    '任务回复不得落在频道顶层',
  );
  const thread = db.listMessages(anchor.id);
  assert.deepEqual(
    thread.map((message) => message.target_id),
    [anchor.id],
  );
  assert.equal(thread[0].content, taskReply);
});

test('the creation event number selects its task even with another open anchor visible', async () => {
  // 新语义（A/B）：事件体里的 #N 是唯一裁决依据——即便频道里还看得见另一个
  // 开放任务锚点，回复也只投 #N 的线程；另一个任务原样不动。
  const { agent, channel } = setupAgentAndChannel({ name: 'task-route-visible-anchor' });
  const db = globalThis.__workspliceDb;
  const consumedAnchor = sendAsOwner(channel.id, 'previous task anchor');
  const consumedTask = createTask({ messageId: consumedAnchor.id });
  const consumedEvent = db.listMessages(channel.id).at(-1);
  ack(agent.id, channel.id, consumedEvent.seq);

  const visibleAnchorResult = sendMessage({
    targetId: channel.id,
    authorId: agent.id,
    content: 'another task anchor authored by agent',
  });
  assert.equal(visibleAnchorResult.held, false);
  const visibleAnchor = visibleAnchorResult.message;
  const visibleTask = db.insertTask({ messageId: visibleAnchor.id, number: 2 });
  const event = sendAsOwner(channel.id, 'Task #1 created');
  const replyText = 'reply to task one only';
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: JSON.stringify({ action: 'reply', content: replyText }) },
      ],
    },
  });

  assert.equal(db.getConsumedSeq(agent.id, channel.id), consumedEvent.seq);
  assert.equal(event.seq, visibleAnchor.seq + 1);
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  const firstTask = db.getTaskById(consumedTask.id);
  assert.equal(firstTask.status, 'in_progress');
  assert.equal(firstTask.owner_id, agent.id);
  const otherTask = db.getTaskById(visibleTask.id);
  assert.equal(otherTask.status, 'todo');
  assert.equal(otherTask.owner_id, null);
  assert.equal(
    db
      .listMessages(channel.id)
      .filter((message) => message.content === replyText).length,
    0,
    '任务回复不得落在频道顶层',
  );
  const thread = db.listMessages(consumedAnchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].target_id, consumedAnchor.id);
  assert.equal(thread[0].content, replyText);
  assert.equal(db.listMessages(visibleAnchor.id).length, 0);
});

test('event-only task replies respect closed and reopened guards; an owned task takes a participant reply', async () => {
  const db = globalThis.__workspliceDb;
  async function replyToOnlyTaskEvent(name, prepareTask) {
    const { agent, channel } = setupAgentAndChannel({ name });
    const anchor = sendAsOwner(channel.id, `request for ${name}`);
    const replyText = `${name} reply`;
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [agent.id]: [
          { text: '{"action":"ignore"}' },
          { text: `{"action":"reply","content":"${replyText}"}` },
        ],
      },
    });

    const first = await runAgentRound(agent.id, channel.id, runtime);
    assert.equal(first.status, 'ignored');
    assert.equal(db.getConsumedSeq(agent.id, channel.id), anchor.seq);
    const task = createTask({ messageId: anchor.id });
    const event = db.listMessages(channel.id).at(-1);
    assert.equal(event.author_id, OWNER_MEMBER_ID);
    assert.match(event.content, /^Task #1 created(?: — .*)?$/);
    prepareTask({ agent, channel, task });

    const outcome = await runAgentRound(agent.id, channel.id, runtime);
    return { agent, anchor, channel, outcome, replyText, task };
  }

  const closed = await replyToOnlyTaskEvent('event-only-closed', ({ agent, channel, task }) => {
    claimTask({ channelId: channel.id, taskNumber: task.number, memberId: agent.id });
    updateTaskStatus({
      channelId: channel.id,
      taskNumber: task.number,
      status: 'closed',
      memberId: agent.id,
    });
  });
  assert.equal(closed.outcome.status, 'replied');
  assert.equal(db.getTaskById(closed.task.id).status, 'closed');
  assert.equal(db.getTaskById(closed.task.id).owner_id, closed.agent.id);
  assert.deepEqual(
    db
      .listMessages(closed.channel.id)
      .filter((message) => message.content === closed.replyText)
      .map((message) => message.target_id),
    [closed.channel.id],
  );
  assert.equal(db.listMessages(closed.anchor.id).length, 0);

  const reopened = await replyToOnlyTaskEvent('event-only-reopened', ({ agent, channel, task }) => {
    claimTask({ channelId: channel.id, taskNumber: task.number, memberId: agent.id });
    updateTaskStatus({
      channelId: channel.id,
      taskNumber: task.number,
      status: 'closed',
      memberId: agent.id,
    });
    updateTaskStatus({
      channelId: channel.id,
      taskNumber: task.number,
      status: 'todo',
      memberId: agent.id,
    });
  });
  assert.equal(reopened.outcome.status, 'yielded');
  assert.equal(db.getTaskById(reopened.task.id).status, 'todo');
  assert.equal(db.getTaskById(reopened.task.id).owner_id, null);
  assert.equal(db.getTaskById(reopened.task.id).reopened, 1);
  assert.equal(db.listMessages(reopened.channel.id).length, 2);
  assert.equal(db.listMessages(reopened.anchor.id).length, 0);

  let rival;
  const claimed = await replyToOnlyTaskEvent('event-only-claimed', ({ channel, task }) => {
    rival = createAgent({
      name: `event-only-rival-${++fixtureSeq}`,
      workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), 'ws-event-only-rival-')),
    });
    joinChannel(channel.id, rival.id);
    claimTask({ channelId: channel.id, taskNumber: task.number, memberId: rival.id });
  });
  // B：任务已被其他 agent 持有 → 不 claim，直接作为参与者写入线程（回复不丢）。
  assert.equal(claimed.outcome.status, 'replied');
  const claimedTask = db.getTaskById(claimed.task.id);
  assert.equal(claimedTask.status, 'in_progress');
  assert.equal(claimedTask.owner_id, rival.id);
  assert.equal(db.listMessages(claimed.channel.id).length, 2, '频道顶层零任务回复');
  const claimedThread = db.listMessages(claimed.anchor.id);
  assert.equal(claimedThread.length, 1);
  assert.equal(claimedThread[0].target_id, claimed.anchor.id);
  assert.equal(claimedThread[0].author_id, claimed.agent.id);
  assert.equal(claimedThread[0].content, claimed.replyText);
});

test('the latest creation event selects its task when several arrive together', async () => {
  // 新语义（A）：无歧义地以本轮最新一条其他作者消息为准——两条创建事件同轮到达时，
  // 只认最新那条指向的 #2；更早的 #1 不会被顺带认领。
  const { agent, channel } = setupAgentAndChannel({ name: 'task-route-multiple-events' });
  const db = globalThis.__workspliceDb;
  const firstAnchor = sendAsOwner(channel.id, 'first request');
  const secondAnchor = sendAsOwner(channel.id, 'second request');
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore"}' },
        { text: '{"action":"reply","content":"taking the latest one"}' },
      ],
    },
  });

  const firstOutcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(firstOutcome.status, 'ignored');
  assert.equal(db.getConsumedSeq(agent.id, channel.id), secondAnchor.seq);
  const firstTask = createTask({ messageId: firstAnchor.id });
  const secondTask = createTask({ messageId: secondAnchor.id });
  const newActivity = db
    .listMessages(channel.id)
    .filter((message) => message.seq > secondAnchor.seq);
  assert.equal(newActivity.length, 2);
  assert.match(newActivity[0].content, /^Task #1 created(?: — .*)?$/);
  assert.match(newActivity[1].content, /^Task #2 created(?: — .*)?$/);

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  const firstCurrent = db.getTaskById(firstTask.id);
  assert.equal(firstCurrent.status, 'todo');
  assert.equal(firstCurrent.owner_id, null);
  const secondCurrent = db.getTaskById(secondTask.id);
  assert.equal(secondCurrent.status, 'in_progress');
  assert.equal(secondCurrent.owner_id, agent.id);
  assert.equal(db.listMessages(firstAnchor.id).length, 0);
  const secondThread = db.listMessages(secondAnchor.id);
  assert.equal(secondThread.length, 1);
  assert.equal(secondThread[0].target_id, secondAnchor.id);
  assert.equal(secondThread[0].content, 'taking the latest one');
  const channelMessages = db.listMessages(channel.id);
  assert.equal(channelMessages.length, 4, '频道顶层不得新增任务回复');
  assert.equal(
    channelMessages.filter((message) => message.author_id === agent.id).length,
    0,
  );
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

/** 任务线程 + peer owner in_review 的前置（peer @ / peer 收束两条回归共用）。 */
function setupPeerOwnedInReviewTask({ agentName, peerPrefix, wsPrefix }) {
  const { agent, channel } = setupAgentAndChannel({ name: agentName });
  const anchor = sendAsOwner(channel.id, "refactor the module");
  createTask({ messageId: anchor.id });
  const peer = createAgent({
    name: `${peerPrefix}-${++fixtureSeq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), wsPrefix)),
  });
  joinChannel(channel.id, peer.id);
  claimTask({ channelId: channel.id, taskNumber: 1, memberId: peer.id });
  const moved = updateTaskStatus({
    channelId: channel.id,
    taskNumber: 1,
    memberId: peer.id,
    status: "in_review",
  });
  assert.equal(moved.status, "updated");
  return { agent, channel, anchor, peer };
}

test("a peer agent's @mention in someone else's in_review task thread is not a must-respond signal", async () => {
  // 2026-10-20 现场回归：task #1 在 peer agent 名下 in_review，peer 收口时 @ 本 agent。
  // agent 的 @ 不是确定信号——ignore 落 ignored 分支（线程游标推进、状态点不变红），
  // 不该逼出空回复（修复前误判成 must-respond，留下 status=error）。
  const { agent, anchor, peer } = setupPeerOwnedInReviewTask({
    agentName: "peer-thread-ignorer",
    peerPrefix: "peer-thread-owner",
    wsPrefix: "worksplice-loop-task-peer-",
  });

  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@peer-thread-ignorer 一致，无补充。task #1 在我名下 in_review，不动。停在。",
  });

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });
  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "ignored");
  // 本 harness 不派生 runtime 的 agent_end→online（loop.test.mjs 那条覆盖），
  // 这里断言状态点不被置 error 即可
  assert.notEqual(getAgent(agent.id).status, "error", "不落 error 状态点");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    1,
    "线程游标推进",
  );
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id).length,
    1,
    "没有空回复落库",
  );
});

test("a peer sign-off in someone else's in_review task thread closes it: a reply does not land", async () => {
  // 现场同款（showcase task #1）：peer 在 in_review 任务线程里收口并 @ 本 agent。
  // 收束后不得再被拉回对话——模型仍想 reply 也不落库（代码层收口），不记 error、状态点不红。
  const { agent, anchor, peer } = setupPeerOwnedInReviewTask({
    agentName: "peer-signoff-thread",
    peerPrefix: "peer-signoff-owner",
    wsPrefix: "worksplice-loop-task-signoff-",
  });

  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@peer-signoff-thread 一致，无补充。task #1 在我名下 in_review，不动。停在。",
  });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"收到，我再补一句"}' }],
    },
  });
  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.equal(outcome.reason, "peer closed the exchange");
  assert.notEqual(getAgent(agent.id).status, "error", "不落 error 状态点");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    1,
    "线程游标推进",
  );
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id).length,
    1,
    "不得产出新的对话消息",
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
          text: '{"action":"reply","content":"done, please verify","onConflict":"revise","task":{"number":1,"op":"complete"}}',
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
          text: '{"action":"reply","content":"done, please verify","onConflict":"revise","task":{"number":1,"op":"complete"}}',
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
        threadReplyCount: 2,
      },
      "one agent claims; the other answers as a participant — both land in the anchor thread",
    );

    assert.equal(task.id, created.id);
    assert.ok(agentIds.includes(task.owner_id));

    assert.equal(channelMessages[0].content, "Please implement the export");
    assert.match(channelMessages[1].content, /Task #1 created/);
    assert.equal(channelMessages.length, 2, "task answers must not become channel messages");
    assert.ok(
      threadReplies.every((message) => message.target_id === task.message_id),
      "every answer targets the anchor thread",
    );
    assert.deepEqual(
      [...new Set(threadReplies.map((message) => message.author_id))].sort(),
      [...agentIds].sort(),
      "both agents contribute in the thread",
    );
    assert.ok(threadReplies.some((message) => message.author_id === task.owner_id));

    const loserId = agentIds.find((id) => id !== task.owner_id);
    const loserRound = db.listRoundLogs(loserId).find((round) => round.target_id === channel.id);
    assert.equal(
      loserRound.status,
      "replied",
      "the non-owner replies as a participant instead of yielding",
    );
    const loserReply = threadReplies.find((message) => message.author_id === loserId);
    assert.equal(
      loserReply?.content,
      loserId === first.id ? "first agent task answer" : "second agent task answer",
    );
  } finally {
    stop();
  }
});

test("task creation event 与普通频道消息同轮到达时，最新一条是普通消息 → 答复仍留在频道", async () => {
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
  // 同轮里有创建事件（更早），但最新一条其他作者消息是普通提问 → F 反例：
  // 不得因为频道里存在开放任务就把这条答复改投线程。
  sendAsOwner(channel.id, "What time is the review?");

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

// ---------------------------------------------------------------------------
// 任务回复路由（task-thread-reply-routing）：本轮最新一条其他作者消息
// 是匹配开放任务的 Owner 创建事件时，回复必须落锚点线程；混合未读不阻断。
// ---------------------------------------------------------------------------

/** 让房间版本在每次读取时前进：模拟持续并发写入，令同轮 claim 重试全部 held。 */
async function withChangingRoom(db, channelId, fn) {
  const realMaxSeq = db.maxSeq.bind(db);
  const patchedMaxSeq = (targetId) => {
    if (targetId !== channelId) return realMaxSeq(targetId);
    // 临时移除 own property，让 sendMessage 内部的 maxSeq 走原型实现，避免递归。
    delete db.maxSeq;
    try {
      sendAsOwner(channelId, 'concurrent room change');
    } finally {
      db.maxSeq = patchedMaxSeq;
    }
    return realMaxSeq(channelId);
  };
  db.maxSeq = patchedMaxSeq;
  try {
    return await fn();
  } finally {
    // 删除测试注入的 own property，恢复原型实现（不在共享 DB 上留 bound 残留）。
    delete db.maxSeq;
  }
}

function routeReply(replyText) {
  return JSON.stringify({ action: 'reply', content: replyText });
}

/** 断言回复只出现在锚点线程、频道顶层零条（R1/R2/D 共用）。 */
function assertOnlyThreadReply({ db, channel, anchor, replyText, authorId }) {
  assert.equal(
    db
      .listMessages(channel.id)
      .filter((message) => message.content === replyText).length,
    0,
    '频道顶层不得出现任务回复',
  );
  const thread = db.listMessages(anchor.id);
  assert.deepEqual(
    thread.map((message) => ({
      target_id: message.target_id,
      author_id: message.author_id,
      content: message.content,
    })),
    [{ target_id: anchor.id, author_id: authorId, content: replyText }],
  );
}

test('R1 混合未读 + 任务已被他人持有：回复以参与者身份落锚点线程，频道顶层零回复', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r1-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;
  const rival = createAgent({
    name: `route-r1-rival-${++fixtureSeq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), 'ws-route-r1-rival-')),
  });
  joinChannel(channel.id, rival.id);

  // 同轮更早的未读频道消息（别的作者）：混合活动不得把任务信号压回频道。
  sendAsOwner(channel.id, 'earlier owner context');
  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  claimTask({
    channelId: channel.id,
    taskNumber: task.number,
    memberId: rival.id,
  });
  const replyText = 'participant status note';

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: routeReply(replyText) }] },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, anchor.id);
  assert.equal(
    db.listMessages(channel.id).length,
    3,
    '频道顶层不得新增任务回复',
  );
  assertOnlyThreadReply({
    db,
    channel,
    anchor,
    replyText,
    authorId: agent.id,
  });
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'in_progress');
  assert.equal(current.owner_id, rival.id, '已有 owner 与状态均不变');
});

test('R2 混合未读 + 任务无 owner：本轮 claim 成功，回复落锚点线程，频道顶层零回复', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r2-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;

  sendAsOwner(channel.id, 'earlier owner context');
  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  const replyText = 'claiming and starting now';

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: routeReply(replyText) }] },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, anchor.id);
  assert.equal(db.listMessages(channel.id).length, 3);
  assertOnlyThreadReply({
    db,
    channel,
    anchor,
    replyText,
    authorId: agent.id,
  });
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'in_progress');
  assert.equal(current.owner_id, agent.id);
});

test('R3 drain 后房间变化导致 claim held：同轮按 roomSeq 重试成功，回复落锚点线程', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r3-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;

  sendAsOwner(channel.id, 'earlier owner context');
  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  const replyText = 'claimed after the room moved';

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: routeReply(replyText) }] },
    prestarted: [agent.id],
  });
  const session = runtime.sessions.get(agent.id);
  const originalSend = session.send.bind(session);
  let injected = false;
  session.send = async (command) => {
    // prompt 发出时 drain 已完成：此刻落一条并发消息，制造 freshness hold。
    if (command.type === 'prompt' && !injected) {
      injected = true;
      sendAsOwner(channel.id, 'a message lands while the agent is drafting');
    }
    return originalSend(command);
  };

  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(injected, true, 'the held window was exercised');
  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, anchor.id);
  assert.equal(db.listMessages(channel.id).length, 4);
  assert.equal(
    db.listMessages(channel.id).filter((message) => message.author_id === agent.id)
      .length,
    0,
    '频道顶层零任务回复',
  );
  const thread = db.listMessages(anchor.id);
  assert.deepEqual(
    thread.map((message) => message.target_id),
    [anchor.id],
  );
  assert.equal(thread[0].content, replyText);
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'in_progress', '任务不留在 todo');
  assert.equal(current.owner_id, agent.id);
  // 游标只推进到本轮已读版本：draft 期间到达的消息留待下一轮 drain（不静默跳过）。
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 3);
});

test('D 自己已持有任务：最新创建事件仍把回复投到锚点线程，不重复 claim', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-d-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;

  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  claimTask({
    channelId: channel.id,
    taskNumber: task.number,
    memberId: agent.id,
  });
  // 同任务的创建事件再次到达（例如游标回滚后的重投）：本轮最新消息是它。
  sendAsOwner(channel.id, 'Task #1 created');
  const replyText = 'progress while I own it';

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: routeReply(replyText) }] },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, anchor.id);
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'in_progress');
  assert.equal(current.owner_id, agent.id);
  assert.equal(db.listMessages(channel.id).length, 3, '频道顶层零任务回复');
  assertOnlyThreadReply({
    db,
    channel,
    anchor,
    replyText,
    authorId: agent.id,
  });
});

test('A 崩溃窗口：最新消息是自己但本轮仍有创建事件时，不跳过而 claim 并回线程', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r4-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;

  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  // 模拟崩溃窗口：agent 的频道回复已落库，但游标未推进；它现在是频道最新消息。
  const crashReply = sendMessage({
    targetId: channel.id,
    authorId: agent.id,
    content: 'crash-window channel reply',
  });
  assert.equal(crashReply.held, false);
  const replyText = 'now handled in the thread';

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: routeReply(replyText) }] },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, anchor.id);
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'in_progress');
  assert.equal(current.owner_id, agent.id);
  assert.equal(db.listMessages(channel.id).length, 3, '频道顶层零任务回复');
  const thread = db.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].target_id, anchor.id);
  assert.equal(thread[0].content, replyText);
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 3);
});

test('R3b claim 每次都被 held：重试耗尽后让路，创建事件保持未消费', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r3b-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;

  sendAsOwner(channel.id, 'earlier owner context');
  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  const event = db.listMessages(channel.id).at(-1);
  assert.match(event.content, /^Task #1 created(?: — .*)?$/);
  const replyText = 'must not be delivered';

  // 模拟持续变化的房间：同一轮的三次 roomSeq 重试全部 held。
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: routeReply(replyText) }] },
  });
  const outcome = await withChangingRoom(db, channel.id, () =>
    runAgentRound(agent.id, channel.id, runtime),
  );

  assert.equal(outcome.status, 'yielded');
  assert.match(outcome.reason, /held/);
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'todo');
  assert.equal(current.owner_id, null);
  assert.equal(db.listMessages(anchor.id).length, 0);
  assert.equal(
    db
      .listMessages(channel.id)
      .filter((message) => message.content === replyText).length,
    0,
  );
  assert.equal(
    db.getConsumedSeq(agent.id, channel.id),
    event.seq - 1,
    '让路轮必须停在创建事件之前，事件保持 pending',
  );
  assert.ok(
    db.getConsumedSeq(agent.id, channel.id) < event.seq,
    '创建事件不得被静默消费成永无 owner',
  );
  // drain 读 1 次房间版本 + 初始 claim + 3 次重试 = 至少 5 次并发写入；
  // 每次 held 都重试过，而不是首轮直接让路。

  const bumps = db
    .listMessages(channel.id)
    .filter((message) => message.content === 'concurrent room change').length;
  assert.ok(bumps >= 5, `expected the claim retries, got ${bumps} room changes`);
});

test('R3c held 耗尽后下一轮普通消息：pending claim 优先收敛且不认领历史任务', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r3c-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;

  // 历史开放任务 #1：创建事件已消费；本轮不得顺带认领。
  const oldAnchor = sendAsOwner(channel.id, 'old request');
  const oldTask = createTask({ messageId: oldAnchor.id });
  const oldEvent = db.listMessages(channel.id).at(-1);
  ack(agent.id, channel.id, oldEvent.seq);

  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  const event = db.listMessages(channel.id).at(-1);
  const heldReply = 'held reply never delivered';
  const recoveredReply = 'claimed on the next round';
  const channelReply = 'ordinary channel answer';

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: routeReply(heldReply) },
        { text: routeReply(recoveredReply) },
        { text: routeReply(channelReply) },
      ],
    },
  });

  const heldOutcome = await withChangingRoom(db, channel.id, () =>
    runAgentRound(agent.id, channel.id, runtime),
  );
  assert.equal(heldOutcome.status, 'yielded');
  assert.equal(db.getTaskById(task.id).status, 'todo');
  assert.equal(db.getConsumedSeq(agent.id, channel.id), event.seq - 1);

  // 下一轮先到一条普通频道消息：最新一条不是任务信号，但 pending #2 优先 claim。
  sendAsOwner(channel.id, 'what is the status?');
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'in_progress');
  assert.equal(current.owner_id, agent.id);
  const oldCurrent = db.getTaskById(oldTask.id);
  assert.equal(oldCurrent.status, 'todo', '历史开放任务不得被顺带认领');
  assert.equal(oldCurrent.owner_id, null);
  assert.equal(db.listMessages(oldAnchor.id).length, 0);
  const thread = db.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].target_id, anchor.id);
  assert.equal(thread[0].content, recoveredReply);
  assert.equal(
    db
      .listMessages(channel.id)
      .filter((message) => message.content === recoveredReply).length,
    0,
  );

  // 成功后 pending 立即清除：下一条普通消息按普通频道回复，不再优先回线程。
  sendAsOwner(channel.id, 'one more ordinary question');
  const third = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(third.status, 'replied');
  const last = db.listMessages(channel.id).at(-1);
  assert.equal(last.content, channelReply);
  assert.equal(last.target_id, channel.id);
  assert.equal(
    db.listMessages(anchor.id).length,
    1,
    'pending 已清除，不再追加线程回复',
  );
});

test('R3d 最新创建事件指向 closed 任务：不落到 pending，普通答复回频道', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r3d-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;

  // 已关闭任务 #1。
  const closedAnchor = sendAsOwner(channel.id, 'closed request');
  const closedTask = createTask({ messageId: closedAnchor.id });
  claimTask({
    channelId: channel.id,
    taskNumber: closedTask.number,
    memberId: agent.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: closedTask.number,
    status: 'closed',
    memberId: agent.id,
  });

  // 待收敛任务 #2：第一轮 held 耗尽后进入 pending。
  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  const event = db.listMessages(channel.id).at(-1);
  const channelReply = 'ordinary channel answer';
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: routeReply('held reply never delivered') },
        { text: routeReply(channelReply) },
      ],
    },
  });

  const heldOutcome = await withChangingRoom(db, channel.id, () =>
    runAgentRound(agent.id, channel.id, runtime),
  );
  assert.equal(heldOutcome.status, 'yielded');
  assert.equal(db.getConsumedSeq(agent.id, channel.id), event.seq - 1);

  // 最新一条是 closed 任务 #1 的创建事件：按规范不路由，也不得落到 pending #2。
  sendAsOwner(channel.id, 'Task #1 created');
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, 'replied');
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'todo', 'pending 任务不得被顺带认领');
  assert.equal(current.owner_id, null);
  assert.equal(db.listMessages(anchor.id).length, 0);
  const last = db.listMessages(channel.id).at(-1);
  assert.equal(last.content, channelReply);
  assert.equal(last.target_id, channel.id);
});

test('E 线程投递失败时不得消费创建事件：频道游标停在事件之前', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-e-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;
  const rival = createAgent({
    name: `route-e-rival-${++fixtureSeq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), 'ws-route-e-rival-')),
  });
  joinChannel(channel.id, rival.id);

  sendAsOwner(channel.id, 'earlier owner context');
  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  const event = db.listMessages(channel.id).at(-1);
  claimTask({
    channelId: channel.id,
    taskNumber: task.number,
    memberId: rival.id,
  });

  // 线程已被并发修改：投递 held，重写又退化为空内容 → error，回复没有落线程。
  const outcome = await runTaskOperation({
    agent,
    channel,
    targetId: channel.id,
    action: {
      action: 'reply',
      content: 'participant note',
      onConflict: 'revise',
    },
    baseSeq: event.seq,
    route: { taskNumber: task.number, eventSeq: event.seq, mode: 'thread' },
    promptFn: async () => '{"action":"reply"}',
    send: () => ({ held: true, roomSeq: 1, whatHappened: 'thread moved' }),
  });

  assert.equal(outcome.status, 'error');
  assert.equal(db.listMessages(anchor.id).length, 0, '回复未落线程');
  assert.equal(
    db.getConsumedSeq(agent.id, channel.id),
    0,
    '创建事件必须保持 pending',
  );
  assert.equal(db.getTaskById(task.id).owner_id, rival.id);
});

test('F 反例：最新一条是普通频道消息时回复仍回频道，历史开放任务不被认领', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-f-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;

  const anchor = sendAsOwner(channel.id, 'please implement the export');
  const task = createTask({ messageId: anchor.id });
  const question = sendAsOwner(channel.id, 'What time is the review?');
  const firstReply = 'The review is at three.';
  const secondReply = 'In the small room.';

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: routeReply(firstReply) },
        { text: routeReply(secondReply) },
      ],
    },
  });

  // 第一轮：创建事件在同轮更早位置，但最新一条是普通消息 → 不路由、不 claim。
  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, 'replied');
  const afterFirst = db.getTaskById(task.id);
  assert.equal(afterFirst.status, 'todo');
  assert.equal(afterFirst.owner_id, null);
  assert.equal(db.listMessages(anchor.id).length, 0);
  const firstReplyRow = db.listMessages(channel.id).at(-1);
  assert.equal(firstReplyRow.content, firstReply);
  assert.equal(firstReplyRow.target_id, channel.id);
  assert.equal(firstReplyRow.seq, question.seq + 1);

  // 第二轮：历史开放任务（事件已消费）仍在池中，普通答复依旧回频道。
  const secondQuestion = sendAsOwner(channel.id, 'And where?');
  const second = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(second.status, 'replied');
  const afterSecond = db.getTaskById(task.id);
  assert.equal(afterSecond.status, 'todo');
  assert.equal(afterSecond.owner_id, null);
  assert.equal(db.listMessages(anchor.id).length, 0);
  const secondReplyRow = db.listMessages(channel.id).at(-1);
  assert.equal(secondReplyRow.content, secondReply);
  assert.equal(secondReplyRow.target_id, channel.id);
  assert.equal(secondReplyRow.seq, secondQuestion.seq + 1);
});

// ---------------------------------------------------------------------------
// hold 重路由（thread-routing-four P0）：频道轮的草稿被 hold 后，用写稿版本之后
// 到达的新消息重跑自动路由裁决；命中创建事件则按与普通轮完全相同的语义投递
// （无 owner 先 claim，再投任务锚点线程）。revise / resend 都要生效；
// 未命中（最新一条是普通消息 / 任务 done·closed·缺失）保持既有 hold 处理。
// ---------------------------------------------------------------------------

/** gated session 的轮次：prompt 发出后由测试显式 release，撑开「写稿在飞」窗口。 */

test('R5 hold + resend: an Owner creation event that lands while the draft is in flight reroutes into the anchor thread and claims', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r5-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;
  const anchor = sendAsOwner(channel.id, 'please implement the export'); // seq 1
  const replyText = 'claiming from the hold window';

  const gated = makeFakeSession([{ text: routeReply(replyText) }], { gated: true });
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, gated);
  const round = runAgentRound(agent.id, channel.id, runtime);
  await waitFor(() => gated.pending.length === 1, 3000);
  // 草稿在飞时 Owner 创建任务：创建事件 seq 2 落在 hold 窗口里
  const task = createTask({ messageId: anchor.id });
  gated.release(0);

  const outcome = await round;

  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, anchor.id);
  assert.equal(db.listMessages(channel.id).length, 2, '频道顶层零新增（锚点 + 创建事件）');
  assertOnlyThreadReply({ db, channel, anchor, replyText, authorId: agent.id });
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'in_progress');
  assert.equal(current.owner_id, agent.id, '无 owner 先 claim');
  assert.equal(
    db.getConsumedSeq(agent.id, channel.id),
    2,
    '频道游标推进到 held 的 roomSeq（创建事件版本）',
  );
  assert.equal(db.getConsumedSeq(agent.id, anchor.id), 0, '线程投递不得污染频道游标');
});

test('R5b hold + revise: the rewritten reply lands in the anchor thread (the revision round reroutes too)', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r5b-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;
  const anchor = sendAsOwner(channel.id, 'please implement the export'); // seq 1

  const gated = makeFakeSession(
    [
      { text: '{"action":"reply","content":"draft version","onConflict":"revise"}' },
      { text: '{"action":"reply","content":"rewritten version","onConflict":"silent"}' },
    ],
    { gated: true },
  );
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, gated);
  const round = runAgentRound(agent.id, channel.id, runtime);
  await waitFor(() => gated.pending.length === 1, 3000);
  const task = createTask({ messageId: anchor.id }); // seq 2
  gated.release(0);

  await waitFor(() => gated.pending.length === 2, 3000);
  assert.match(
    gated.prompts[1],
    /Task #1 created/,
    'revise prompt 读到 hold 期间到达的创建事件',
  );
  gated.release(1);

  const outcome = await round;

  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, anchor.id);
  assert.equal(outcome.message?.content, 'rewritten version');
  assert.equal(db.listMessages(channel.id).length, 2, '重写稿不得落频道顶层');
  assertOnlyThreadReply({
    db,
    channel,
    anchor,
    replyText: 'rewritten version',
    authorId: agent.id,
  });
  const current = db.getTaskById(task.id);
  assert.equal(current.owner_id, agent.id);
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 2);
  assert.equal(db.getConsumedSeq(agent.id, anchor.id), 0);
});

test('R5c hold reroute with an existing owner: posts as a participant and does not claim', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r5c-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;
  const rival = createAgent({
    name: `route-r5c-rival-${++fixtureSeq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), 'ws-route-r5c-')),
  });
  joinChannel(channel.id, rival.id);
  const anchor = sendAsOwner(channel.id, 'please implement the export'); // seq 1
  const replyText = 'participant note from the hold window';

  const gated = makeFakeSession([{ text: routeReply(replyText) }], { gated: true });
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, gated);
  const round = runAgentRound(agent.id, channel.id, runtime);
  await waitFor(() => gated.pending.length === 1, 3000);
  const task = createTask({ messageId: anchor.id }); // seq 2
  claimTask({ channelId: channel.id, taskNumber: task.number, memberId: rival.id });
  gated.release(0);

  const outcome = await round;

  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, anchor.id);
  assertOnlyThreadReply({ db, channel, anchor, replyText, authorId: agent.id });
  const current = db.getTaskById(task.id);
  assert.equal(current.owner_id, rival.id, '已有 owner 不被抢走');
  assert.equal(current.status, 'in_progress');
});

test('R5d hold window whose latest message is ordinary: stays in the channel (docs/spec.md:172 guard)', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r5d-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;
  const anchor = sendAsOwner(channel.id, 'please implement the export'); // seq 1
  const replyText = 'The review is at three.';

  const gated = makeFakeSession([{ text: routeReply(replyText) }], { gated: true });
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, gated);
  const round = runAgentRound(agent.id, channel.id, runtime);
  await waitFor(() => gated.pending.length === 1, 3000);
  const task = createTask({ messageId: anchor.id }); // seq 2
  const question = sendAsOwner(channel.id, 'What time is the review?'); // seq 3（最新一条）
  gated.release(0);

  const outcome = await round;

  assert.equal(outcome.status, 'replied');
  assert.equal(outcome.message?.target_id, channel.id, '普通答复留在频道');
  assert.equal(db.listMessages(anchor.id).length, 0, '不得改投线程');
  const top = db.listMessages(channel.id);
  assert.equal(top.at(-1)?.content, replyText);
  assert.equal(top.at(-1)?.seq, question.seq + 1);
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'todo');
  assert.equal(current.owner_id, null, '不得因频道存在开放任务就认领');
  assert.equal(db.getConsumedSeq(agent.id, channel.id), question.seq);
});

test('R5e hold reroute where the claim stays held: yields, posts nowhere, cursor stops before the creation event', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r5e-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;
  const anchor = sendAsOwner(channel.id, 'please implement the export'); // seq 1

  const gated = makeFakeSession([{ text: routeReply('draft that must not land') }], {
    gated: true,
  });
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, gated);
  const round = runAgentRound(agent.id, channel.id, runtime);
  await waitFor(() => gated.pending.length === 1, 3000);
  const task = createTask({ messageId: anchor.id }); // seq 2 = 创建事件

  // 激活后每次读频道版本都前进 1：草稿 send 与后续 claim 全部 held。
  const realMaxSeq = db.maxSeq.bind(db);
  let bumps = 0;
  db.maxSeq = (targetId) =>
    targetId === channel.id ? realMaxSeq(targetId) + (bumps += 1) : realMaxSeq(targetId);
  let outcome;
  try {
    gated.release(0);
    outcome = await round;
  } finally {
    delete db.maxSeq;
  }

  assert.equal(outcome.status, 'yielded');
  assert.match(outcome.reason, /held/);
  const current = db.getTaskById(task.id);
  assert.equal(current.status, 'todo');
  assert.equal(current.owner_id, null);
  assert.equal(db.listMessages(anchor.id).length, 0, '线程里零回复');
  assert.equal(
    db.listMessages(channel.id).filter((m) => m.author_id === agent.id).length,
    0,
    '频道顶层零回复（不向频道兜底）',
  );
  assert.equal(
    db.getConsumedSeq(agent.id, channel.id),
    task.anchor.seq,
    'claim 耗尽时游标停在创建事件之前（事件 seq = 锚点 seq + 1）',
  );
});

test('R5f hold reroute onto a reopened task: yields without a channel fallback', async () => {
  const { agent, channel } = setupAgentAndChannel({
    name: `route-r5f-${++fixtureSeq}`,
  });
  const db = globalThis.__workspliceDb;
  const anchor = sendAsOwner(channel.id, 'rework the export'); // seq 1
  const task = createTask({ messageId: anchor.id }); // seq 2
  claimTask({ channelId: channel.id, taskNumber: task.number, memberId: agent.id });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: task.number,
    status: 'closed',
    memberId: agent.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: task.number,
    status: 'todo',
    memberId: agent.id,
  });
  ack(agent.id, channel.id, 2); // 历史事件已消费
  sendAsOwner(channel.id, 'please have another look'); // seq 3 = 本轮 drain 的触发消息

  const gated = makeFakeSession([{ text: routeReply('on it again') }], { gated: true });
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, gated);
  const round = runAgentRound(agent.id, channel.id, runtime);
  await waitFor(() => gated.pending.length === 1, 3000);
  // 草稿在飞时创建事件再次到达（游标回滚后的重投形态）
  sendAsOwner(channel.id, 'Task #1 created'); // seq 4
  gated.release(0);

  const outcome = await round;

  assert.equal(outcome.status, 'yielded');
  assert.match(outcome.reason, /reopened/);
  const current = db.getTaskById(task.id);
  assert.equal(current.owner_id, null, 'reopened 任务仍留在池中');
  assert.equal(current.reopened, 1);
  assert.equal(db.listMessages(anchor.id).length, 0, '线程里零回复');
  assert.equal(
    db.listMessages(channel.id).filter((m) => m.author_id === agent.id).length,
    0,
    '频道顶层零回复（不向频道兜底）',
  );
});

test('R5g hold reroute when the task is done/closed or missing: stays in the channel', async () => {
  // done/closed
  {
    const { agent, channel } = setupAgentAndChannel({
      name: `route-r5g-closed-${++fixtureSeq}`,
    });
    const db = globalThis.__workspliceDb;
    const anchor = sendAsOwner(channel.id, 'please implement the export'); // seq 1
    const replyText = 'ordinary channel answer';

    const gated = makeFakeSession([{ text: routeReply(replyText) }], { gated: true });
    const runtime = makeFakeRuntime();
    runtime.sessions.set(agent.id, gated);
    const round = runAgentRound(agent.id, channel.id, runtime);
    await waitFor(() => gated.pending.length === 1, 3000);
    const task = createTask({ messageId: anchor.id }); // seq 2
    claimTask({
      channelId: channel.id,
      taskNumber: task.number,
      memberId: OWNER_MEMBER_ID,
    });
    updateTaskStatus({
      channelId: channel.id,
      taskNumber: task.number,
      status: 'closed',
      memberId: OWNER_MEMBER_ID,
    });
    gated.release(0);

    const outcome = await round;

    assert.equal(outcome.status, 'replied');
    assert.equal(outcome.message?.target_id, channel.id, 'closed 任务不路由');
    assert.equal(db.listMessages(anchor.id).length, 0);
    assert.equal(db.listMessages(channel.id).at(-1)?.content, replyText);
    assert.equal(db.getTaskById(task.id).status, 'closed');
  }
  // 任务行缺失：只有格式匹配的创建事件文本
  {
    const { agent, channel } = setupAgentAndChannel({
      name: `route-r5g-missing-${++fixtureSeq}`,
    });
    const db = globalThis.__workspliceDb;
    sendAsOwner(channel.id, 'please implement the export'); // seq 1
    const replyText = 'channel answer despite the event text';

    const gated = makeFakeSession([{ text: routeReply(replyText) }], { gated: true });
    const runtime = makeFakeRuntime();
    runtime.sessions.set(agent.id, gated);
    const round = runAgentRound(agent.id, channel.id, runtime);
    await waitFor(() => gated.pending.length === 1, 3000);
    sendAsOwner(channel.id, 'Task #9 created'); // seq 2（无对应任务行）
    gated.release(0);

    const outcome = await round;

    assert.equal(outcome.status, 'replied');
    assert.equal(outcome.message?.target_id, channel.id, '任务缺失不路由');
    assert.equal(db.listMessages(channel.id).at(-1)?.content, replyText);
  }
});
