import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-status-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, deleteAgent } = await import("./raft/members.ts");
const {
  setAgentStatusLookup,
  publishAgentStatus,
  getAgentStatusSnapshot,
  subscribeAgentStatuses,
  startAgentStatusSweeper,
  stopAgentStatusSweeper,
} = await import("./agent-status.ts");

function freshWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-status-ws-"));
}

function clearLookup() {
  setAgentStatusLookup(null);
}

test("publishAgentStatus persists to the members table and broadcasts to subscribers", () => {
  const agent = createAgent({ name: "pub" });
  // 身份推导：快照直接镜像发布的 online/working 值（真实场景由存活 wrapper 推导）
  setAgentStatusLookup((m) => (m.id === agent.id ? m.status : null));
  const received = [];
  const unsubscribe = subscribeAgentStatuses((snapshot) => received.push(snapshot[agent.id]));
  publishAgentStatus(agent.id, "working");
  publishAgentStatus(agent.id, "online");
  unsubscribe();
  clearLookup();

  assert.deepEqual(received, ["working", "online"]);
  const persisted = globalThis.__workspliceDb.getMember(agent.id);
  assert.equal(persisted.status, "online");
});

test("getAgentStatusSnapshot covers all live agents and excludes deleted ones", () => {
  const a = createAgent({ name: "snap-a", workspacePath: freshWorkspace() });
  createAgent({ name: "snap-b" });
  setAgentStatusLookup((m) => (m.id === a.id ? "working" : null));
  publishAgentStatus(a.id, "working");

  const snapshot = getAgentStatusSnapshot();
  assert.equal(snapshot[a.id], "working");
  assert.ok(Object.keys(snapshot).length >= 2);

  // 删除身份后状态点消失（§3.6）
  deleteAgent(a.id);
  const afterDelete = getAgentStatusSnapshot();
  assert.equal(afterDelete[a.id], undefined);
});

test("a live wrapper lookup overrides DB status; dead wrapper falls back to offline/error", () => {
  const agent = createAgent({ name: "live", workspacePath: freshWorkspace() });
  publishAgentStatus(agent.id, "error");

  // 有存活 wrapper：idle → online，running → working
  setAgentStatusLookup((member) => (member.id === agent.id ? "online" : null));
  assert.equal(getAgentStatusSnapshot()[agent.id], "online");
  setAgentStatusLookup((member) => (member.id === agent.id ? "working" : null));
  assert.equal(getAgentStatusSnapshot()[agent.id], "working");

  // wrapper 死掉：error 状态保留（会话错误直到重启才清除），online/working 回落 offline
  setAgentStatusLookup(() => null);
  assert.equal(getAgentStatusSnapshot()[agent.id], "error");

  const idle = createAgent({ name: "idle" });
  publishAgentStatus(idle.id, "online");
  assert.equal(getAgentStatusSnapshot()[idle.id], "offline");
});

test("status changes dedupe broadcasts (same value does not re-notify)", () => {
  const agent = createAgent({ name: "dedupe" });
  setAgentStatusLookup((m) => (m.id === agent.id ? m.status : null));
  let calls = 0;
  const unsubscribe = subscribeAgentStatuses(() => calls++);
  publishAgentStatus(agent.id, "online");
  publishAgentStatus(agent.id, "online");
  assert.equal(calls, 1);
  publishAgentStatus(agent.id, "working");
  assert.equal(calls, 2);
  unsubscribe();
  clearLookup();
});

test("the status sweeper flushes derived changes to subscribers", async () => {
  clearLookup();
  const agent = createAgent({ name: "sweep" });
  let lastSnapshot = null;
  const unsubscribe = subscribeAgentStatuses((snapshot) => (lastSnapshot = snapshot));
  publishAgentStatus(agent.id, "online");

  startAgentStatusSweeper(20);
  await new Promise((resolve) => setTimeout(resolve, 80));
  stopAgentStatusSweeper();

  // 无 wrapper：sweeper 把 stale online 修正为 offline 并广播
  assert.equal(lastSnapshot[agent.id], "offline");
  unsubscribe();
});
