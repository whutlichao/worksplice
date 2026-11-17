import assert from "node:assert/strict";
import test from "node:test";

const {
  ROUND_SKIP_REASONS,
  decideRoundAdmission,
  isTaskActionableForSomeActor,
  isTaskActionableForActor,
  messageWindowRecipients,
  selectRoundWindowSignals,
} = await import("./admission.ts");

function input(overrides = {}) {
  return {
    agentId: "reviewer",
    isDM: false,
    isMember: true,
    isTaskThread: true,
    task: { status: "in_review", ownerId: "owner-agent", reopened: 0 },
    reason: "message",
    continuing: false,
    humanMentioned: false,
    humanAllMentioned: false,
    hasActionableTaskEvent: false,
    chiefInvited: false,
    isEffectiveChief: false,
    secretaryHandoff: false,
    taskEventAnchorInvited: false,
    taskOwnerMentioned: false,
    canChangeTaskStatus: false,
    ...overrides,
  };
}

test("an in_review task owner's @mentions admit a non-owner as task-reviewer", () => {
  assert.deepEqual(
    decideRoundAdmission(input({ taskOwnerMentioned: true })),
    { admit: true, role: "task-reviewer", useRoomGate: false },
  );
});

test("task-owner attention does not widen in_progress or done/closed rounds", () => {
  assert.deepEqual(
    decideRoundAdmission(
      input({
        task: { status: "in_progress", ownerId: "owner-agent", reopened: 0 },
        taskOwnerMentioned: true,
      }),
    ),
    { admit: false, reason: ROUND_SKIP_REASONS.taskOwnerOnly },
  );
  assert.deepEqual(
    decideRoundAdmission(
      input({
        task: { status: "done", ownerId: "owner-agent", reopened: 0 },
        taskOwnerMentioned: true,
      }),
    ),
    { admit: false, reason: ROUND_SKIP_REASONS.taskDoneOrClosed },
  );
});

test("without human or task-owner attention an in_review reviewer stays skipped", () => {
  assert.deepEqual(decideRoundAdmission(input()), {
    admit: false,
    reason: ROUND_SKIP_REASONS.taskReviewerNotInvited,
  });
});

test("task-owner attention never penetrates a non-member", () => {
  assert.deepEqual(
    decideRoundAdmission(input({ isMember: false, taskOwnerMentioned: true })),
    { admit: false, reason: ROUND_SKIP_REASONS.notMember },
  );
});

test("only the current task-status authority enters an in_progress thread for task-status", () => {
  const task = { status: "in_progress", ownerId: "owner-agent", reopened: 0 };
  assert.deepEqual(
    decideRoundAdmission(
      input({
        agentId: "chief",
        task,
        reason: "task-status",
        canChangeTaskStatus: true,
      }),
    ),
    { admit: true, role: "task-reviewer", useRoomGate: false },
  );
  assert.deepEqual(
    decideRoundAdmission(
      input({
        agentId: "not-authorized",
        task,
        reason: "task-status",
        canChangeTaskStatus: false,
      }),
    ),
    { admit: false, reason: ROUND_SKIP_REASONS.taskOwnerOnly },
  );
  assert.deepEqual(
    decideRoundAdmission(
      input({
        agentId: "chief",
        task: { ...task, status: "in_review" },
        reason: "task-status",
        canChangeTaskStatus: true,
      }),
    ),
    { admit: false, reason: ROUND_SKIP_REASONS.taskReviewerNotInvited },
    "task-status only opens the in_progress branch",
  );
});

test("a reopened task admits the task-status authority on a human mention", () => {
  const reopened = { status: "todo", ownerId: null, reopened: 1 };
  assert.deepEqual(
    decideRoundAdmission(
      input({
        task: reopened,
        humanMentioned: true,
        canChangeTaskStatus: true,
      }),
    ),
    { admit: true, role: "human-mention", useRoomGate: false },
  );
  assert.deepEqual(
    decideRoundAdmission(
      input({
        task: reopened,
        humanMentioned: true,
        canChangeTaskStatus: false,
      }),
    ),
    { admit: false, reason: ROUND_SKIP_REASONS.taskReopened },
  );
  assert.deepEqual(
    decideRoundAdmission(
      input({
        task: reopened,
        humanAllMentioned: true,
        canChangeTaskStatus: true,
      }),
    ),
    { admit: true, role: "all-mention", useRoomGate: false },
  );
});

function windowDirectory(overrides = {}) {
  return {
    mentionsOf: () => [],
    memberOf: () => undefined,
    isChannelMember: () => true,
    taskByChannelNumber: () => undefined,
    chiefRecipientOf: () => null,
    ...overrides,
  };
}

function humanMessage(content, overrides = {}) {
  return {
    id: "message-1",
    target_id: "room",
    author_id: "owner",
    content,
    author: { type: "human" },
    ...overrides,
  };
}

function actor(id, isMember = true) {
  return { id, type: "agent", isMember };
}

test("a reopened TODO is actionable for a human and closed to an agent", () => {
  const reopened = { status: "todo", reopened: 1 };
  assert.equal(isTaskActionableForActor(reopened, "human"), true);
  assert.equal(isTaskActionableForActor(reopened, "agent"), false);

  assert.equal(
    isTaskActionableForActor({ status: "todo", reopened: 0 }, "agent"),
    true,
  );
  assert.equal(
    isTaskActionableForActor({ status: "done", reopened: 0 }, "human"),
    false,
  );
  assert.equal(
    isTaskActionableForActor({ status: "closed", reopened: 1 }, "human"),
    false,
  );
  assert.equal(isTaskActionableForActor(null, "human"), false);
  assert.equal(isTaskActionableForActor(undefined, "agent"), false);
});

test("the derived any-actor question keeps reopened alive for window boundaries", () => {
  // 窗口停窗 / 任务线程投递目标问的是「还有任何 actor 能行动吗」，不是
  // 「当前 agent 能不能做」：reopened 对人类可行动 ⇒ 仍算「有任务事件」。
  assert.equal(
    isTaskActionableForSomeActor({ status: "todo", reopened: 1 }),
    true,
  );
  assert.equal(
    isTaskActionableForSomeActor({ status: "todo", reopened: 0 }),
    true,
  );
  assert.equal(
    isTaskActionableForSomeActor({ status: "done", reopened: 0 }),
    false,
  );
  assert.equal(
    isTaskActionableForSomeActor({ status: "closed", reopened: 1 }),
    false,
  );
  assert.equal(isTaskActionableForSomeActor(null), false);
});

test("the same reopened TODO event is open for a human actor and closed for an agent actor", () => {
  const event = humanMessage("Task #1 created — rework the widget");
  const directory = windowDirectory({
    taskByChannelNumber: (_channelId, number) =>
      number === 1
        ? {
            id: "task-1",
            message_id: "anchor-1",
            status: "todo",
            owner_id: null,
            reopened: 1,
          }
        : undefined,
  });
  const base = {
    messages: [event],
    channel: { id: "room", type: "public" },
    targetId: "room",
    task: null,
    directory,
  };

  assert.equal(
    selectRoundWindowSignals({
      ...base,
      actor: { id: "owner", type: "human", isMember: true },
    }).hasActionableTaskEvent,
    true,
  );
  assert.equal(
    selectRoundWindowSignals({ ...base, actor: actor("alpha") })
      .hasActionableTaskEvent,
    false,
  );
});

function verdictFor({
  message,
  invitations,
  handoffChief = null,
  directory = windowDirectory(),
  task = null,
}) {
  const recipients = messageWindowRecipients({ invitations, handoffChief });
  return {
    ...recipients,
    signalsFor: (who) =>
      selectRoundWindowSignals({
        messages: [message],
        channel: { id: "room", type: "public" },
        targetId: "room",
        task,
        actor: who,
        directory,
      }),
  };
}

function admissionForVerdict(
  verdict,
  who,
  { task = null, isEffectiveChief = false, secretaryHandoff = false } = {},
) {
  return decideRoundAdmission({
    agentId: who.id,
    isDM: false,
    isMember: who.isMember,
    isTaskThread: Boolean(task),
    task: task
      ? {
          status: task.status,
          ownerId: task.owner_id,
          reopened: task.reopened,
        }
      : null,
    reason: "message",
    continuing: Boolean(
      task && task.status === "in_progress" && task.owner_id === who.id,
    ),
    ...verdict.signalsFor(who),
    isEffectiveChief,
    secretaryHandoff,
  });
}

test("window length 1: the admission verdict and the wake candidate set agree", () => {
  const scenarios = [
    {
      name: "personal mention",
      message: humanMessage("@alpha please look"),
      invitations: {
        all: false,
        mentioned: ["alpha"],
        candidates: ["alpha"],
        chief: null,
      },
      directory: windowDirectory({
        mentionsOf: (content) =>
          content.includes("@alpha") ? ["alpha"] : [],
      }),
      people: [actor("alpha"), actor("beta")],
    },
    {
      name: "@all",
      message: humanMessage("@all please sync"),
      invitations: {
        all: true,
        mentioned: [],
        candidates: ["alpha", "beta"],
        chief: null,
      },
      people: [actor("alpha"), actor("beta"), actor("gamma", false)],
    },
    {
      name: "chief default recipient",
      message: humanMessage("hello there"),
      invitations: {
        all: false,
        mentioned: [],
        candidates: ["chief"],
        chief: "chief",
      },
      directory: windowDirectory({ chiefRecipientOf: () => "chief" }),
      people: [actor("alpha"), actor("chief")],
    },
    {
      name: "task-associated human message (handoff chief is wake-only)",
      message: humanMessage("@alpha Task #1 needs an owner"),
      invitations: {
        all: false,
        mentioned: ["alpha"],
        candidates: ["alpha"],
        chief: null,
      },
      directory: windowDirectory({
        mentionsOf: (content) =>
          content.includes("@alpha") ? ["alpha"] : [],
      }),
      handoffChief: "chief",
      people: [actor("alpha"), actor("chief")],
      effectiveChief: "chief",
    },
    {
      name: "task thread owner continuation",
      message: humanMessage("please continue"),
      invitations: {
        all: false,
        mentioned: [],
        candidates: ["alpha"],
        chief: null,
      },
      task: {
        id: "task-1",
        message_id: "anchor-1",
        status: "in_progress",
        owner_id: "alpha",
        reopened: 0,
      },
      people: [actor("alpha"), actor("beta")],
    },
    {
      name: "task creation event",
      message: humanMessage("Task #1 created — please route this"),
      invitations: {
        all: false,
        mentioned: [],
        candidates: [],
        chief: null,
      },
      directory: windowDirectory({
        taskByChannelNumber: (_channelId, number) =>
          number === 1
            ? {
                id: "task-1",
                message_id: "anchor-1",
                status: "todo",
                owner_id: null,
                reopened: 0,
              }
            : undefined,
      }),
      handoffChief: "chief",
      people: [actor("alpha"), actor("chief")],
      effectiveChief: "chief",
    },
  ];

  for (const scenario of scenarios) {
    const verdict = verdictFor(scenario);
    for (const who of scenario.people) {
      const admitted = admissionForVerdict(verdict, who, {
        task: scenario.task ?? null,
        isEffectiveChief: scenario.effectiveChief === who.id,
        secretaryHandoff:
          Boolean(scenario.handoffChief) && scenario.handoffChief === who.id,
      });
      assert.equal(
        admitted.admit,
        verdict.wakeRecipients.includes(who.id),
        `${scenario.name}: ${who.id} admission must agree with the wake candidate set`,
      );
    }
  }
});

test("window signals keep the per-window semantics (latest human, owner attention, anchor invite)", () => {
  const base = {
    channel: { id: "room", type: "public" },
    targetId: "room",
    task: null,
    actor: actor("reviewer"),
  };

  // 最新一条人类消息说了算：早先的 @ 不能伪装成新邀请。
  const staleMention = selectRoundWindowSignals({
    ...base,
    messages: [
      humanMessage("@reviewer look", { id: "m1" }),
      humanMessage("no mention here", { id: "m2" }),
    ],
    directory: windowDirectory({
      mentionsOf: (content) =>
        content.includes("@reviewer") ? ["reviewer"] : [],
    }),
  });
  assert.equal(staleMention.humanMentioned, false);

  // in_review 任务 owner 的最新一条消息 @ 了 reviewer：互审注意力信号；
  // 收束语不算。
  const task = {
    id: "task-1",
    message_id: "anchor-1",
    status: "in_review",
    owner_id: "owner-agent",
    reopened: 0,
  };
  const directory = windowDirectory({
    mentionsOf: (content) =>
      content.includes("@reviewer") ? ["reviewer"] : [],
    memberOf: (memberId) =>
      memberId === "owner-agent"
        ? { id: "owner-agent", type: "agent", deleted: 0 }
        : undefined,
  });
  const attention = selectRoundWindowSignals({
    ...base,
    task,
    messages: [
      {
        id: "m1",
        target_id: "anchor-1",
        author_id: "owner-agent",
        content: "@reviewer please verify",
        author: { type: "agent" },
      },
    ],
    directory,
  });
  assert.equal(attention.taskOwnerMentioned, true);

  const closing = selectRoundWindowSignals({
    ...base,
    task,
    messages: [
      {
        id: "m1",
        target_id: "anchor-1",
        author_id: "owner-agent",
        content: "@reviewer looks good, no more from me",
        author: { type: "agent" },
      },
    ],
    directory,
    isPeerCloseText: () => true,
  });
  assert.equal(closing.taskOwnerMentioned, false);

  // 最新任务事件的锚点在同一个窗口里且直接 @ 了 reviewer。
  const anchorInvite = selectRoundWindowSignals({
    ...base,
    messages: [
      humanMessage("@reviewer please take this", { id: "anchor-1" }),
      humanMessage("Task #1 created — please take this", { id: "event-1" }),
    ],
    directory: windowDirectory({
      mentionsOf: (content) =>
        content.includes("@reviewer") ? ["reviewer"] : [],
      taskByChannelNumber: (_channelId, number) =>
        number === 1
          ? {
              id: "task-1",
              message_id: "anchor-1",
              status: "todo",
              owner_id: null,
              reopened: 0,
            }
          : undefined,
    }),
  });
  assert.equal(anchorInvite.taskEventAnchorInvited, true);
  assert.equal(anchorInvite.hasActionableTaskEvent, true);
});
