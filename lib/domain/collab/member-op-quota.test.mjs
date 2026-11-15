import assert from "node:assert/strict";
import test from "node:test";

// 配额 store（票 chief-capability-converge）：两条执行路径（ops 面 / 首席 tools 面）共用**同一个
// 实例**，所以「同一 agent 的同一会话内 createAgent 至多成功 1 次」在换写法时同样成立。
const {
  createMemberOpQuotaStore,
  getMemberOpQuotaStore,
  setMemberOpQuotaStore,
} = await import("./member-op-quota.ts");
const { MEMBER_AGENT_CREATE_LIMIT } = await import("./member-capabilities.ts");

/** 收集告警的实现（退化时必须能读到原因，而不是默默收紧/放松）。 */
function recordingStore(extra = {}) {
  const warnings = [];
  const store = createMemberOpQuotaStore({ warn: (message) => warnings.push(message), ...extra });
  return { store, warnings };
}

// ---------------------------------------------------------------------------
// 口径：同一 agent 的同一会话内成功至多 1 次
// ---------------------------------------------------------------------------

test("同一 agent 的同一会话：第一次未耗尽，成功后耗尽（上限取自能力表，不可注入）", () => {
  const { store } = recordingStore();
  assert.equal(MEMBER_AGENT_CREATE_LIMIT, 1, "本用例钉的就是能力表里那个 1");

  assert.equal(store.isExhausted("agent-a", "session-1"), false);
  store.recordSuccess("agent-a", "session-1");
  assert.equal(store.isExhausted("agent-a", "session-1"), true);
  assert.equal(store.used("agent-a", "session-1"), MEMBER_AGENT_CREATE_LIMIT);

  // 重复记账不会把状态改回去，也不会把计数算成 2 条命。
  store.recordSuccess("agent-a", "session-1");
  assert.equal(store.isExhausted("agent-a", "session-1"), true);
});

test("换会话 = 新窗口：同一 agent 的另一个会话重新开始", () => {
  const { store } = recordingStore();
  store.recordSuccess("agent-a", "session-1");
  assert.equal(store.isExhausted("agent-a", "session-1"), true);
  assert.equal(store.isExhausted("agent-a", "session-2"), false);
});

test("换 agent = 各算各的：同一会话里两个 agent 的配额互不影响", () => {
  const { store } = recordingStore();
  store.recordSuccess("agent-a", "session-1");
  assert.equal(store.isExhausted("agent-a", "session-1"), true);
  assert.equal(store.isExhausted("agent-b", "session-1"), false);
});

test("失败不消耗：只有 recordSuccess 推进计数（isExhausted 是只读的）", () => {
  const { store } = recordingStore();
  assert.equal(store.isExhausted("agent-a", "session-1"), false);
  assert.equal(store.isExhausted("agent-a", "session-1"), false);
  assert.equal(store.used("agent-a", "session-1"), 0);
});

// ---------------------------------------------------------------------------
// fail-closed 退化：拿不到会话标识 ⇒ 该 agent 在本进程内至多 1 次，并说明原因
// ---------------------------------------------------------------------------

test("拿不到会话标识时退化为「该 agent 在本进程内至多 1 次」，不是跳过配额", () => {
  const { store, warnings } = recordingStore();
  assert.equal(store.isExhausted("agent-a", null), false);
  store.recordSuccess("agent-a", null);
  assert.equal(store.isExhausted("agent-a", null), true, "退化的 key 也必须真的计数");
  assert.equal(store.isExhausted("agent-a", null), true, "重复询问不再新增告警（只报一次）");

  assert.equal(warnings.length, 1, "退化要在日志里说明原因（每个 agent 只报一次，不刷屏）");
  assert.match(warnings[0], /agent-a/);
  assert.match(warnings[0], /session/i);
  assert.match(warnings[0], /process/i);

  // 另一个 agent 的退化 key 不受影响（退化不是「全进程共用一次」）。
  assert.equal(store.isExhausted("agent-b", null), false);
  assert.equal(warnings.length, 2, "每个 agent 各有一条退化说明");
  assert.match(warnings[1], /agent-b/);
  // 退化 key 与会话 key 不互相冒充：有会话标识的调用不会被无标识调用消耗。
  assert.equal(store.isExhausted("agent-a", "session-1"), false);
});

test("有会话标识时不产生退化告警", () => {
  const { store, warnings } = recordingStore();
  store.isExhausted("agent-a", "session-1");
  store.recordSuccess("agent-a", "session-1");
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------------
// 单例与测试接缝（与房间轮次预算同一套热重载纪律：挂 globalThis）
// ---------------------------------------------------------------------------

test("单例：默认挂在 globalThis 上，可整体替换 / 清空（下次访问重建）", () => {
  const first = getMemberOpQuotaStore();
  assert.equal(getMemberOpQuotaStore(), first, "同一进程内必须是同一个实例（跨路径共享的前提）");

  setMemberOpQuotaStore(null);
  const recreated = getMemberOpQuotaStore();
  assert.notEqual(recreated, first, "清空后要重建（热重载 / 测试隔离）");
  assert.equal(recreated.isExhausted("agent-a", "session-1"), false);

  const injected = createMemberOpQuotaStore();
  setMemberOpQuotaStore(injected);
  assert.equal(getMemberOpQuotaStore(), injected);
  setMemberOpQuotaStore(null);
});
