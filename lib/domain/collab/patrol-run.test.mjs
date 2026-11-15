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
const { patrolSignatureOf } = await import("./patrol.ts");

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
  channels = [{ channelId: "c1", channelName: "c1", chiefHere: true, isPublic: true }],
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
    readTasks: (channel) => tasks[channel.channelId] ?? [],
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
      { channelId: "c1", channelName: "c1", chiefHere: false, isPublic: true },
      { channelId: "c2", channelName: "c2", chiefHere: true, isPublic: true },
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

test("落点兜底：她不是任何相关频道的首席时，兜底只从公开频道里取", () => {
  const { delivered } = harness({
    channels: [
      { channelId: "secret", channelName: "secret", chiefHere: false, isPublic: false },
      { channelId: "c2", channelName: "c2", chiefHere: false, isPublic: true },
    ],
    tasks: {
      secret: [
        snapshot({
          taskId: "task-secret",
          channelId: "secret",
          channelName: "vault",
          number: 8,
          updatedAt: agoMs(31 * 60_000),
        }),
      ],
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
  assert.equal(delivered[0].channelId, "c2", "跳过排在前面的私有频道，退到第一个公开频道");
  assert.match(delivered[0].content, /#5 in #ops/);
  assert.doesNotMatch(delivered[0].content, /#8|vault/, "私有频道的发现不跟着进公开频道");
});

test("落点兜底：没有任何公开频道 ⇒ 静默（不往私有频道硬塞）", () => {
  const { delivered, result } = harness({
    channels: [{ channelId: "secret", channelName: "secret", chiefHere: false, isPublic: false }],
    tasks: {
      secret: [
        snapshot({ channelId: "secret", channelName: "vault", updatedAt: agoMs(31 * 60_000) }),
      ],
    },
  });
  assert.deepEqual(delivered, []);
  assert.equal(result.status, "silent");
});

test("可见性：落点是公开频道时，私有且非落点的发现不进汇总", () => {
  const { delivered } = harness({
    channels: [
      { channelId: "pub", channelName: "pub", chiefHere: false, isPublic: true },
      { channelId: "secret", channelName: "secret", chiefHere: false, isPublic: false },
    ],
    tasks: {
      secret: [
        snapshot({
          taskId: "task-secret",
          channelId: "secret",
          channelName: "vault",
          number: 8,
          updatedAt: agoMs(31 * 60_000),
        }),
      ],
      pub: [
        snapshot({
          channelId: "pub",
          channelName: "ops",
          number: 5,
          updatedAt: agoMs(31 * 60_000),
        }),
      ],
    },
  });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].channelId, "pub");
  assert.match(delivered[0].content, /#5 in #ops/);
  assert.doesNotMatch(delivered[0].content, /#8|vault/, "私有频道的名字与任务号不得进公开频道");
});

test("可见性：落点自身是私有频道时，允许聚合公开频道的发现", () => {
  const { delivered } = harness({
    channels: [
      { channelId: "secret", channelName: "secret", chiefHere: true, isPublic: false },
      { channelId: "pub", channelName: "pub", chiefHere: false, isPublic: true },
    ],
    tasks: {
      secret: [
        snapshot({
          taskId: "task-secret",
          channelId: "secret",
          channelName: "vault",
          number: 8,
          updatedAt: agoMs(31 * 60_000),
        }),
      ],
      pub: [
        snapshot({
          channelId: "pub",
          channelName: "ops",
          number: 5,
          updatedAt: agoMs(31 * 60_000),
        }),
      ],
    },
  });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].channelId, "secret");
  assert.match(delivered[0].content, /#8 in #vault/);
  assert.match(delivered[0].content, /#5 in #ops/, "私有可见面 ⊆ 公开可见面，不是泄露");
});

test("签名集只记可上报的发现：私有非落点两轮都不报，成为其首席后才报", () => {
  const signatures = new Set();
  const tasks = {
    pub: [],
    secret: [
      snapshot({
        taskId: "task-secret",
        channelId: "secret",
        channelName: "vault",
        number: 8,
        updatedAt: agoMs(31 * 60_000),
      }),
    ],
  };
  const notChief = [
    { channelId: "pub", channelName: "pub", chiefHere: false, isPublic: true },
    { channelId: "secret", channelName: "secret", chiefHere: false, isPublic: false },
  ];

  for (const round of [1, 2]) {
    const { delivered, result } = harness({ channels: notChief, tasks, signatures });
    assert.deepEqual(delivered, [], `第 ${round} 轮：私有非落点的发现不上报`);
    assert.equal(result.status, "silent");
  }
  assert.equal(
    signatures.has(patrolSignatureOf({ taskId: "task-secret", kind: "unclaimed_todo" })),
    false,
    "不上报的发现不写进签名集（将来成为那个频道的首席时还要能报出来）",
  );

  // 她成为该私有频道的生效首席：同一条发现变成可上报，本轮就报。
  const chiefThere = harness({
    channels: [
      { channelId: "pub", channelName: "pub", chiefHere: false, isPublic: true },
      { channelId: "secret", channelName: "secret", chiefHere: true, isPublic: false },
    ],
    tasks,
    signatures,
  });
  assert.equal(chiefThere.delivered.length, 1);
  assert.equal(chiefThere.delivered[0].channelId, "secret");
  assert.match(chiefThere.delivered[0].content, /#8 in #vault/);
});

test("落点轮转：两个首席频道（A 公开在前、B 私有在后）依次上报，第三轮静默", () => {
  const signatures = new Set();
  const channels = [
    { channelId: "A", channelName: "A", chiefHere: true, isPublic: true },
    { channelId: "B", channelName: "B", chiefHere: true, isPublic: false },
  ];
  const tasks = {
    A: [
      snapshot({ channelId: "A", channelName: "team", number: 4, updatedAt: agoMs(31 * 60_000) }),
    ],
    B: [
      snapshot({
        taskId: "task-B",
        channelId: "B",
        channelName: "vault",
        number: 8,
        updatedAt: agoMs(31 * 60_000),
      }),
    ],
  };

  const first = harness({ channels, tasks, signatures });
  assert.equal(first.delivered.length, 1);
  assert.equal(first.delivered[0].channelId, "A");
  assert.match(first.delivered[0].content, /#4 in #team/);
  assert.doesNotMatch(
    first.delivered[0].content,
    /#8|vault/,
    "B 是私有频道：它的发现不跟着进 A 的汇总",
  );

  const second = harness({ channels, tasks, signatures });
  assert.equal(
    second.delivered.length,
    1,
    "A 报过之后轮到 B：前一个频道一直卡着不得让后面的首席频道永久沉默",
  );
  assert.equal(second.delivered[0].channelId, "B");
  assert.match(second.delivered[0].content, /#8 in #vault/);
  assert.doesNotMatch(second.delivered[0].content, /#4 in #team/, "A 已报过，不重复进汇总");

  const third = harness({ channels, tasks, signatures });
  assert.deepEqual(third.delivered, [], "两个落点都报过 ⇒ 第三轮静默");
  assert.equal(third.result.status, "silent");
});

test("落点轮转：B 报过之后不再重报（A 状态变化时只报 A）", () => {
  const signatures = new Set();
  const channels = [
    { channelId: "A", channelName: "A", chiefHere: true, isPublic: true },
    { channelId: "B", channelName: "B", chiefHere: true, isPublic: false },
  ];
  const aTask = (overrides = {}) =>
    snapshot({ channelId: "A", channelName: "team", number: 4, ...overrides });
  const bTask = snapshot({
    taskId: "task-B",
    channelId: "B",
    channelName: "vault",
    number: 8,
    updatedAt: agoMs(31 * 60_000),
  });

  harness({ channels, tasks: { A: [aTask()], B: [bTask] }, signatures });
  assert.equal(harness({ channels, tasks: { A: [aTask()], B: [bTask] }, signatures }).delivered[0].channelId, "B");

  // A 的任务进入待互审（状态变了 ⇒ 新签名）：本轮回到 A，B 报过的那条仍不重报。
  const changed = harness({
    channels,
    tasks: {
      A: [
        aTask({
          status: "in_review",
          ownerId: "alice",
          updatedAt: agoMs(25 * 60 * 60_000),
        }),
      ],
      B: [bTask],
    },
    signatures,
  });
  assert.equal(changed.delivered.length, 1);
  assert.equal(changed.delivered[0].channelId, "A");
  assert.match(changed.delivered[0].content, /#4 in #team: in review/);
  assert.doesNotMatch(changed.delivered[0].content, /vault/, "B 报过的发现不再重报");

  // 全部报过 ⇒ 静默。
  const quiet = harness({
    channels,
    tasks: {
      A: [aTask({ status: "in_review", ownerId: "alice", updatedAt: agoMs(25 * 60 * 60_000) })],
      B: [bTask],
    },
    signatures,
  });
  assert.deepEqual(quiet.delivered, []);
});

test("落点兜底：首席频道都报过之后，兜底仍只取第一个公开频道（不往私有频道塞）", () => {
  const signatures = new Set();
  const channels = [
    { channelId: "A", channelName: "A", chiefHere: true, isPublic: false },
    { channelId: "pub", channelName: "pub", chiefHere: false, isPublic: true },
    { channelId: "secret", channelName: "secret", chiefHere: false, isPublic: false },
  ];
  const secretTask = snapshot({
    taskId: "task-secret",
    channelId: "secret",
    channelName: "deep",
    number: 12,
    updatedAt: agoMs(31 * 60_000),
  });
  const tasks = {
    A: [
      snapshot({ channelId: "A", channelName: "vault", number: 8, updatedAt: agoMs(31 * 60_000) }),
    ],
    pub: [],
    secret: [secretTask],
  };

  const first = harness({ channels, tasks, signatures });
  assert.equal(first.delivered[0].channelId, "A", "第一轮：她作为首席的私有频道");

  const second = harness({ channels, tasks, signatures });
  assert.deepEqual(second.delivered, [], "兜底是第一个公开频道，它没有可上报的发现 ⇒ 静默");
  assert.equal(
    signatures.has(patrolSignatureOf({ taskId: "task-secret", kind: "unclaimed_todo" })),
    false,
    "私有非落点的发现既不上报、也不被签名字集吞掉",
  );
});

test("频道范围自带频道名：readTasks 直接拿 scope（含 channelName），不再回查频道", () => {
  const seen = [];
  const delivered = [];
  runPatrolOnce({
    now: () => NOW,
    readChief: () => CHIEF,
    readChannels: () => [{ channelId: "c1", channelName: "team", chiefHere: true, isPublic: true }],
    readTasks: (channel) => {
      seen.push(channel);
      // 默认接线从 scope 取频道名（不再 `getChannel` 回查）：快照只补判定需要的列。
      return [
        snapshot({
          channelId: channel.channelId,
          channelName: channel.channelName,
          updatedAt: agoMs(31 * 60_000),
        }),
      ];
    },
    deliver: (input) => delivered.push(input),
    signatures: new Set(),
  });

  assert.deepEqual(seen, [
    { channelId: "c1", channelName: "team", chiefHere: true, isPublic: true },
  ]);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].content, /#7 in #team: todo unclaimed for 31m/);
});

test("投递失败不消耗签名：下一轮重报", () => {
  const signatures = new Set();
  const tasks = { c1: [snapshot({ updatedAt: agoMs(31 * 60_000) })] };
  const failing = runPatrolOnce({
    now: () => NOW,
    readChief: () => CHIEF,
    readChannels: () => [{ channelId: "c1", channelName: "c1", chiefHere: true, isPublic: true }],
    readTasks: (channel) => tasks[channel.channelId] ?? [],
    deliver: () => {
      throw new Error("channel went away");
    },
    signatures,
    disabled: false,
  });
  assert.equal(failing.status, "failed");

  const retry = harness({ tasks, signatures });
  assert.equal(retry.delivered.length, 1, "失败的发现留到下一轮再报");
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
      readChannels: () => [{ channelId: "c1", channelName: "c1", chiefHere: true, isPublic: true }],
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
