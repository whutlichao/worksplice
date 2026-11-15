import assert from "node:assert/strict";
import test from "node:test";

/**
 * 巡检接入层（票 #267）：`runPatrolOnce` 的**外部可观察**结果——是否投递、几条、正文、
 * 落在哪个频道、以及开关。任务快照 / 频道范围 / 时钟 / 投递器全部注入，因此这里不碰数据库；
 * 默认接线（真实 SQLite + 系统事件语义）在 `patrol-run-wiring.test.mjs`。
 */

const { isPatrolDisabled, runPatrolOnce, setPatrolSignatureStore } = await import(
  "./patrol-run.ts"
);

const NOW = new Date("2026-03-01T12:00:00.000Z");
const CHIEF = { id: "susan", name: "Susan" };

test.afterEach(() => {
  setPatrolSignatureStore(null);
});

function agoMs(ms) {
  return new Date(NOW.getTime() - ms).toISOString();
}

function snapshot(overrides = {}) {
  return {
    taskId: "task-1",
    channelId: "c1",
    channelName: "team",
    number: 7,
    status: "todo",
    ownerId: null,
    handoffState: null,
    anchorCreatedAt: agoMs(2 * 60 * 60_000),
    updatedAt: agoMs(31 * 60_000),
    ...overrides,
  };
}

function harness({
  channels = [{ channelId: "c1", chiefHere: true }],
  tasks = {},
  signatures = new Set(),
  disabled,
  readChief = () => CHIEF,
} = {}) {
  const delivered = [];
  const result = runPatrolOnce({
    now: () => NOW,
    readChief,
    readChannels: () => channels,
    readTasks: (channelId) => tasks[channelId] ?? [],
    deliver: (input) => delivered.push(input),
    signatures,
    disabled,
  });
  return { result, delivered };
}

test("无发现：零消息（不讲“一切正常”）", () => {
  const { result, delivered } = harness({ tasks: { c1: [snapshot({ updatedAt: agoMs(29 * 60_000) })] } });
  assert.deepEqual(delivered, []);
  assert.equal(result.status, "silent");
});

test("有发现：恰好一条汇总，作者是首席，落在发现所在的频道", () => {
  const { result, delivered } = harness({
    tasks: {
      c1: [
        snapshot({ number: 4, updatedAt: agoMs(31 * 60_000) }),
        snapshot({ taskId: "task-2", number: 9, updatedAt: agoMs(45 * 60_000) }),
      ],
    },
  });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].channelId, "c1");
  assert.equal(delivered[0].authorId, CHIEF.id);
  assert.match(delivered[0].content, /^Task patrol: 2 stalled tasks/);
  assert.match(delivered[0].content, /#4 in #team: todo unclaimed for 31m/);
  assert.match(delivered[0].content, /#9 in #team: todo unclaimed for 45m/);
  assert.equal(result.status, "reported");
  assert.equal(result.reported, 2);
});

test("签名去重：同一任务同一状态只报一次，状态变化后重新上报", () => {
  const signatures = new Set();
  const stalled = { c1: [snapshot({ updatedAt: agoMs(31 * 60_000) })] };

  const first = harness({ tasks: stalled, signatures });
  assert.equal(first.delivered.length, 1);
  assert.equal(first.result.reported, 1);

  const second = harness({ tasks: stalled, signatures });
  assert.deepEqual(second.delivered, []);
  assert.equal(second.result.status, "silent");

  const changed = harness({
    tasks: {
      c1: [
        snapshot({
          status: "in_review",
          ownerId: "alice",
          updatedAt: agoMs(25 * 60 * 60_000),
        }),
      ],
    },
    signatures,
  });
  assert.equal(changed.delivered.length, 1);
  assert.match(changed.delivered[0].content, /in review/);
  assert.equal(changed.result.reported, 1);
});

test("签名去重：本轮只报新发现；修好后再卡住算新事件", () => {
  const signatures = new Set();
  const both = {
    c1: [
      snapshot({ number: 4, updatedAt: agoMs(31 * 60_000) }),
      snapshot({ taskId: "task-2", number: 9, updatedAt: agoMs(40 * 60_000) }),
    ],
  };
  assert.equal(harness({ tasks: both, signatures }).delivered.length, 1);

  // #4 修好了（不再命中）：#9 已报过 ⇒ 本轮沉默，但 #4 的签名要随扫描结论一起淡出。
  const afterFix = harness({
    tasks: { c1: [snapshot({ taskId: "task-2", number: 9, updatedAt: agoMs(41 * 60_000) })] },
    signatures,
  });
  assert.deepEqual(afterFix.delivered, []);

  // #4 重新卡住：是新事件，再报一次。
  const restalled = harness({
    tasks: {
      c1: [
        snapshot({ number: 4, updatedAt: agoMs(32 * 60_000) }),
        snapshot({ taskId: "task-2", number: 9, updatedAt: agoMs(41 * 60_000) }),
      ],
    },
    signatures,
  });
  assert.equal(restalled.delivered.length, 1);
  assert.match(restalled.delivered[0].content, /#4 in #team/);
  assert.doesNotMatch(restalled.delivered[0].content, /#9 in #team/, "已报过的不重复进汇总");
  assert.equal(restalled.result.reported, 1);
});
test("落点优先：她作为生效首席的频道（即便不是扫描列表第一条）", () => {
  const { delivered } = harness({
    channels: [
      { channelId: "c1", chiefHere: false },
      { channelId: "c2", chiefHere: true },
    ],
    tasks: {
      c1: [snapshot({ channelId: "c1", channelName: "team", updatedAt: agoMs(31 * 60_000) })],
      c2: [
        snapshot({
          taskId: "task-2",
          channelId: "c2",
          channelName: "ops",
          number: 3,
          updatedAt: agoMs(31 * 60_000),
        }),
      ],
    },
  });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].channelId, "c2");
  assert.match(delivered[0].content, /#3 in #ops/);
  assert.match(delivered[0].content, /#7 in #team/, "跨频道发现汇成同一条");
});

test("落点兜底：她不是任何相关频道的首席时，退到第一个公开频道", () => {
  const { delivered } = harness({
    channels: [
      { channelId: "c1", chiefHere: false },
      { channelId: "c2", chiefHere: false },
    ],
    tasks: {
      c2: [
        snapshot({
          channelId: "c2",
          channelName: "ops",
          number: 5,
          updatedAt: agoMs(31 * 60_000),
        }),
      ],
    },
  });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].channelId, "c1", "不往发现所在频道硬塞，退到第一个公开频道");
});

test("无可用频道 / 无首席：静默不报", () => {
  const noChannel = harness({ channels: [], tasks: { c1: [snapshot()] } });
  assert.deepEqual(noChannel.delivered, []);
  assert.equal(noChannel.result.status, "silent");

  const noChief = harness({ readChief: () => null });
  assert.deepEqual(noChief.delivered, []);
  assert.equal(noChief.result.status, "no-chief");
});

test("开关：WORKSPLICE_PATROL_DISABLED=1 整体关闭巡检（零读取、零投递）", () => {
  assert.equal(isPatrolDisabled({}), false);
  assert.equal(isPatrolDisabled({ WORKSPLICE_PATROL_DISABLED: "0" }), false);
  assert.equal(isPatrolDisabled({ WORKSPLICE_PATROL_DISABLED: "1" }), true);

  const delivered = [];
  const result = runPatrolOnce({
    disabled: true,
    readChief: () => {
      throw new Error("关闭时不得读取任何状态");
    },
    deliver: (input) => delivered.push(input),
  });
  assert.deepEqual(delivered, []);
  assert.equal(result.status, "disabled");

  const previous = process.env.WORKSPLICE_PATROL_DISABLED;
  process.env.WORKSPLICE_PATROL_DISABLED = "1";
  try {
    const fromEnv = runPatrolOnce({
      readChief: () => CHIEF,
      readChannels: () => [{ channelId: "c1", chiefHere: true }],
      readTasks: () => [snapshot()],
      deliver: (input) => delivered.push(input),
    });
    assert.deepEqual(delivered, [], "环境变量是真的接线，不是只测常量");
    assert.equal(fromEnv.status, "disabled");
  } finally {
    if (previous === undefined) delete process.env.WORKSPLICE_PATROL_DISABLED;
    else process.env.WORKSPLICE_PATROL_DISABLED = previous;
  }
});
