import assert from "node:assert/strict";
import test from "node:test";

const { ROUND_SKIP_REASONS, decideRoundAdmission } = await import("./admission.ts");

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
    hasOpenTaskEvent: false,
    chiefInvited: false,
    isEffectiveChief: false,
    secretaryHandoff: false,
    taskEventAnchorInvited: false,
    taskOwnerMentioned: false,
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
