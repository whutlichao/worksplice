import assert from "node:assert/strict";
import test from "node:test";
import { deriveLiveAgentStatus } from "./agent-runtime.ts";

const MEMBER = {
  id: "agent-1",
  type: "agent",
  name: "bob",
  description: "",
  role: "member",
  workspace_path: "/tmp/ws",
  pi_session_file: null,
  status: "offline",
  deleted: 0,
  created_at: "2026-08-03T00:00:00.000Z",
};

function fakeSession({ alive, running }) {
  return {
    isAlive: () => alive,
    isRunning: () => running,
  };
}

test("no wrapper derives null (DB fallback decides)", () => {
  assert.equal(deriveLiveAgentStatus(MEMBER, undefined), null);
  assert.equal(deriveLiveAgentStatus(MEMBER, fakeSession({ alive: false, running: false })), null);
});

test("a running session derives working regardless of DB status", () => {
  assert.equal(deriveLiveAgentStatus({ ...MEMBER, status: "offline" }, fakeSession({ alive: true, running: true })), "working");
  assert.equal(deriveLiveAgentStatus({ ...MEMBER, status: "error" }, fakeSession({ alive: true, running: true })), "working");
});

test("an idle live session derives online unless the DB records an error", () => {
  assert.equal(deriveLiveAgentStatus(MEMBER, fakeSession({ alive: true, running: false })), "online");
  assert.equal(deriveLiveAgentStatus({ ...MEMBER, status: "error" }, fakeSession({ alive: true, running: false })), null);
});
