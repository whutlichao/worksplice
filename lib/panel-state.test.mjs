import assert from "node:assert/strict";
import test from "node:test";
import {
  memberPanel,
  openPanel,
  closePanel,
  onChannelSwitched,
} from "./panel-state.ts";

// ---------------------------------------------------------------------------
// 面板转移规则（ticket 13）：中央与面板状态解耦后的纯状态模块
// 不变式：面板内容与中央频道无耦合；线程打开时中央保持当前频道。
// ---------------------------------------------------------------------------

test("memberPanel: 人类/agent 入口都映射为面板内容", () => {
  assert.deepEqual(memberPanel("owner", true), { kind: "human", id: "owner" });
  assert.deepEqual(memberPanel("a1", false), { kind: "agent", id: "a1" });
  assert.deepEqual(memberPanel("owner", false), { kind: "agent", id: "owner" });
});

test("openPanel: null 上打开任意内容", () => {
  assert.deepEqual(openPanel(null, { kind: "agent", id: "a1" }), { kind: "agent", id: "a1" });
  assert.deepEqual(openPanel(null, { kind: "human", id: "owner" }), { kind: "human", id: "owner" });
  assert.deepEqual(openPanel(null, { kind: "thread", id: "m1" }), { kind: "thread", id: "m1" });
});

test("openPanel: 单槽替换——agent→thread→human 任意两两替换", () => {
  assert.deepEqual(openPanel({ kind: "agent", id: "a1" }, { kind: "thread", id: "m9" }), {
    kind: "thread",
    id: "m9",
  });
  assert.deepEqual(openPanel({ kind: "thread", id: "m9" }, { kind: "human", id: "owner" }), {
    kind: "human",
    id: "owner",
  });
  assert.deepEqual(openPanel({ kind: "human", id: "owner" }, { kind: "agent", id: "a2" }), {
    kind: "agent",
    id: "a2",
  });
  assert.deepEqual(openPanel({ kind: "agent", id: "a1" }, { kind: "human", id: "owner" }), {
    kind: "human",
    id: "owner",
  });
  assert.deepEqual(openPanel({ kind: "thread", id: "m1" }, { kind: "agent", id: "a3" }), {
    kind: "agent",
    id: "a3",
  });
  assert.deepEqual(openPanel({ kind: "human", id: "owner" }, { kind: "thread", id: "m2" }), {
    kind: "thread",
    id: "m2",
  });
});

test("openPanel: id 透传（同内容重开保持同对象）", () => {
  assert.deepEqual(openPanel({ kind: "agent", id: "a1" }, { kind: "agent", id: "a1" }), {
    kind: "agent",
    id: "a1",
  });
  assert.deepEqual(openPanel({ kind: "thread", id: "m1" }, { kind: "thread", id: "m1" }), {
    kind: "thread",
    id: "m1",
  });
  assert.deepEqual(
    openPanel(
      { kind: "human", id: "owner" },
      { kind: "thread", id: "m1", taskId: "task-7" },
    ),
    { kind: "thread", id: "m1", taskId: "task-7" },
  );
});

test("closePanel: 任意内容 → null；null → null（幂等）", () => {
  assert.equal(closePanel({ kind: "agent", id: "a1" }), null);
  assert.equal(closePanel({ kind: "human", id: "owner" }), null);
  assert.equal(closePanel({ kind: "thread", id: "m1" }), null);
  assert.equal(closePanel(null), null);
});

test("onChannelSwitched: 清空面板（切换频道不被上一频道残留详情误导）", () => {
  assert.equal(onChannelSwitched({ kind: "agent", id: "a1" }), null);
  assert.equal(onChannelSwitched({ kind: "human", id: "owner" }), null);
  assert.equal(onChannelSwitched({ kind: "thread", id: "m1" }), null);
  assert.equal(onChannelSwitched(null), null);
});
