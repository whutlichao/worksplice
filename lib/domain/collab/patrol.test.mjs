import assert from "node:assert/strict";
import test from "node:test";

/**
 * 巡检判定层（票 #267）：纯函数、零 IO——时间与任务快照全部注入。
 *
 * 只断言判定结论与汇总正文，不碰数据库、不起会话；接入层（投递 / 落点 / 开关）由
 * `patrol-run.test.mjs` 覆盖。
 */

const {
  PATROL_UNCLAIMED_TODO_MS,
  PATROL_HANDOFF_BLOCKED_MS,
  PATROL_IN_REVIEW_MS,
  PATROL_WINDOW_MS,
  findPatrolFindings,
  patrolSignatureOf,
  buildPatrolSummary,
} = await import("./patrol.ts");

const NOW = new Date("2026-03-01T12:00:00.000Z");

function agoMs(ms) {
  return new Date(NOW.getTime() - ms).toISOString();
}

function hoursAgo(hours) {
  return agoMs(hours * 60 * 60_000);
}

function minutesAgo(minutes) {
  return agoMs(minutes * 60_000);
}

function task(overrides = {}) {
  return {
    taskId: "task-1",
    channelId: "channel-1",
    number: 7,
    status: "todo",
    ownerId: null,
    handoffState: null,
    anchorCreatedAt: minutesAgo(120),
    updatedAt: minutesAgo(120),
    ...overrides,
  };
}

test("未认领 todo：29 分钟不报、31 分钟报（阈值只有一处定义）", () => {
  assert.equal(PATROL_UNCLAIMED_TODO_MS, 30 * 60_000);

  assert.deepEqual(
    findPatrolFindings({ now: NOW, tasks: [task({ updatedAt: minutesAgo(29) })] }),
    [],
  );

  const findings = findPatrolFindings({
    now: NOW,
    tasks: [task({ updatedAt: minutesAgo(31) })],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "unclaimed_todo");
  assert.equal(findings[0].taskId, "task-1");
  assert.equal(findings[0].channelId, "channel-1");
  assert.equal(findings[0].number, 7);
});

test("未认领 todo：已有 owner 的 todo 不算卡住", () => {
  const findings = findPatrolFindings({
    now: NOW,
    tasks: [
      task({ ownerId: "alice", updatedAt: minutesAgo(31) }),
    ],
  });
  assert.deepEqual(findings, []);
});

test("空任务集返回空发现", () => {
  assert.deepEqual(findPatrolFindings({ now: NOW, tasks: [] }), []);
});

test("分流卡住：blocked 29 分钟不报、31 分钟报", () => {
  assert.equal(PATROL_HANDOFF_BLOCKED_MS, 30 * 60_000);

  assert.deepEqual(
    findPatrolFindings({
      now: NOW,
      tasks: [task({ handoffState: "blocked", updatedAt: minutesAgo(29) })],
    }),
    [],
  );

  const findings = findPatrolFindings({
    now: NOW,
    tasks: [task({ handoffState: "blocked", updatedAt: minutesAgo(31) })],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "handoff_blocked");
});

test("分流卡住：已认领的 blocked 历史不算卡住（claim 不清 handoff_state）", () => {
  const findings = findPatrolFindings({
    now: NOW,
    tasks: [
      task({
        status: "in_progress",
        ownerId: "alice",
        handoffState: "blocked",
        updatedAt: minutesAgo(31),
      }),
    ],
  });
  assert.deepEqual(findings, []);
});

test("待互审：23 小时不报、25 小时报", () => {
  assert.equal(PATROL_IN_REVIEW_MS, 24 * 60 * 60_000);

  assert.deepEqual(
    findPatrolFindings({
      now: NOW,
      tasks: [task({ status: "in_review", ownerId: "alice", updatedAt: hoursAgo(23) })],
    }),
    [],
  );

  const findings = findPatrolFindings({
    now: NOW,
    tasks: [task({ status: "in_review", ownerId: "alice", updatedAt: hoursAgo(25) })],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "review_stale");
});

test("7 天窗口：更早创建的任务不进巡检（即便卡住得够久）", () => {
  assert.equal(PATROL_WINDOW_MS, 7 * 24 * 60 * 60_000);

  const inside = findPatrolFindings({
    now: NOW,
    tasks: [
      task({
        anchorCreatedAt: hoursAgo(7 * 24 - 1),
        updatedAt: minutesAgo(31),
      }),
    ],
  });
  assert.equal(inside.length, 1);

  const outside = findPatrolFindings({
    now: NOW,
    tasks: [
      task({
        anchorCreatedAt: hoursAgo(7 * 24 + 1),
        updatedAt: minutesAgo(31),
      }),
    ],
  });
  assert.deepEqual(outside, []);
});

test("去重签名只由（任务、状态、详情摘要）决定：时长漂移不改签名", () => {
  const first = patrolSignatureOf(finding({ stalledMs: 31 * 60_000 }));
  const later = patrolSignatureOf(finding({ stalledMs: 90 * 60_000 }));
  assert.equal(first, later, "同一任务同一状态只报一次");

  assert.notEqual(patrolSignatureOf(finding({ kind: "review_stale" })), first);
  assert.notEqual(patrolSignatureOf(finding({ taskId: "task-2" })), first);
});

test("汇总：空发现不产出正文；多条发现拼成一条英文正文", () => {
  assert.equal(buildPatrolSummary([]), null);

  const content = buildPatrolSummary([
    finding({ kind: "unclaimed_todo", number: 4, stalledMs: 31 * 60_000 }),
    finding({
      kind: "handoff_blocked",
      taskId: "task-2",
      number: 7,
      stalledMs: 80 * 60_000,
    }),
    finding({
      kind: "review_stale",
      taskId: "task-3",
      channelId: "channel-2",
      channelName: "ops",
      number: 9,
      stalledMs: 25 * 60 * 60_000,
    }),
  ]);
  assert.match(content, /^Task patrol: 3 stalled tasks/);
  assert.match(content, /#4 in #team: todo unclaimed for 31m/);
  assert.match(content, /#7 in #team: todo \(handoff blocked\) for 1h 20m/);
  assert.match(content, /#9 in #ops: in review for 25h/);
  assert.doesNotMatch(content, /[\u4e00-\u9fff]/, "产品内容英文硬编码");
});

function finding(overrides = {}) {
  return {
    kind: "unclaimed_todo",
    taskId: "task-1",
    channelId: "channel-1",
    channelName: "team",
    number: 7,
    stalledMs: 31 * 60_000,
    ...overrides,
  };
}
