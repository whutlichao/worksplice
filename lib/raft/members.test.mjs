import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";
import { BUILTIN_CHANNEL_ID } from "../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-members-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, listAgents, getAgent, updateAgentWorkspace, setAgentStatus, deleteAgent, agentWorkspaceByAnother, setAgentRuntimeConfig } = await import(
  "./members.ts"
);
const { createChannel, joinChannel, listChannelMembers } = await import("./channels.ts");
const { sendMessage } = await import("./messages.ts");

function freshWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-ws-"));
  return dir;
}

test("createAgent persists name/description/workspace and joins #all", () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "bob", description: "helper", workspacePath: ws });
  assert.equal(agent.type, "agent");
  assert.equal(agent.name, "bob");
  assert.equal(agent.description, "helper");
  assert.equal(agent.workspace_path, ws);
  assert.equal(agent.status, "offline");
  assert.equal(agent.deleted, 0);
  assert.ok(listChannelMembers(BUILTIN_CHANNEL_ID).some((m) => m.id === agent.id));
  assert.ok(listAgents().some((a) => a.id === agent.id));
});

test("createAgent without workspace leaves the binding null but still joins #all", () => {
  const agent = createAgent({ name: "no-ws" });
  assert.equal(agent.workspace_path, null);
  assert.ok(listChannelMembers(BUILTIN_CHANNEL_ID).some((m) => m.id === agent.id));
});

test("createAgent rejects a workspace already bound by another agent", () => {
  const ws = freshWorkspace();
  createAgent({ name: "first", workspacePath: ws });
  assert.throws(() => createAgent({ name: "second", workspacePath: ws }), /already bound|bound to another agent/i);
});

test("createAgent rejects a workspace directory that does not exist", () => {
  assert.throws(
    () => createAgent({ name: "ghost", workspacePath: path.join(os.tmpdir(), "no-such-worksplice-dir") }),
    /does not exist/i,
  );
});

test("updateAgentWorkspace binds a new directory and clears the persisted session file", () => {
  const ws1 = freshWorkspace();
  const ws2 = freshWorkspace();
  const agent = createAgent({ name: "mover", workspacePath: ws1 });
  globalThis.__workspliceDb.setMemberWorkspace(agent.id, ws1, "/fake/session.jsonl");
  updateAgentWorkspace(agent.id, ws2);
  const updated = getAgent(agent.id);
  assert.equal(updated.workspace_path, ws2);
  assert.equal(updated.pi_session_file, null);
});

test("updateAgentWorkspace rejects a workspace already bound by another agent", () => {
  const ws1 = freshWorkspace();
  const ws2 = freshWorkspace();
  createAgent({ name: "owner-a", workspacePath: ws1 });
  const b = createAgent({ name: "owner-b", workspacePath: ws2 });
  assert.throws(() => updateAgentWorkspace(b.id, ws1), /already bound|bound to another agent/i);
});

test("updateAgentWorkspace rejects a missing directory", () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "stuck", workspacePath: ws });
  assert.throws(
    () => updateAgentWorkspace(agent.id, path.join(os.tmpdir(), "no-such-dir")),
    /does not exist/i,
  );
});

test("setAgentStatus persists the four-state status", () => {
  const agent = createAgent({ name: "statusy" });
  for (const status of ["online", "working", "error", "offline"]) {
    setAgentStatus(agent.id, status);
    assert.equal(getAgent(agent.id).status, status);
  }
});

test("deleteAgent soft-deletes: hidden from lists, channel memberships dropped, tasks unclaimed, consumed seqs cleared", () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "gone", workspacePath: ws });
  const db = globalThis.__workspliceDb;

  // 历史消息保留：成员行必须仍然存在（messages.author_id 外键）
  const channel = createChannel({ name: "keep-msg" });
  joinChannel(channel.id, agent.id, "owner");
  sendMessage({ targetId: channel.id, authorId: agent.id, content: "mine" });
  // 认领与消费游标
  const message = sendMessage({ targetId: channel.id, authorId: "owner", content: "task anchor" }).message;
  db.insertTask({ messageId: message.id, number: 1, ownerId: agent.id });
  db.setConsumedSeq(agent.id, channel.id, 3);

  deleteAgent(agent.id);

  assert.ok(!listAgents().some((a) => a.id === agent.id));
  assert.throws(() => getAgent(agent.id), /not found/i);
  assert.ok(db.getMember(agent.id), "member row kept for immutable message history");
  assert.equal(db.getMember(agent.id).deleted, 1);
  assert.ok(!listChannelMembers(BUILTIN_CHANNEL_ID).some((m) => m.id === agent.id));
  assert.ok(!listChannelMembers(channel.id).some((m) => m.id === agent.id));
  const tasks = db.listTasks().filter((t) => t.message_id === message.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].owner_id, null);
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 0);
  // 消息本体保留
  assert.ok(db.listMessages(channel.id).some((m) => m.author_id === agent.id));
});

test("deleteAgent of an unknown id throws", () => {
  assert.throws(() => deleteAgent("no-such-id"), /not found/i);
});

test("agentWorkspaceByAnother detects bindings by other live agents", () => {
  const ws = freshWorkspace();
  const a = createAgent({ name: "owner-x", workspacePath: ws });
  assert.equal(agentWorkspaceByAnother(ws, a.id), false);
  const b = createAgent({ name: "unbound" });
  assert.equal(agentWorkspaceByAnother(ws, b.id), true);
  assert.equal(agentWorkspaceByAnother(ws, a.id), false);
});

test("setAgentRuntimeConfig persists per-agent model overrides (runtime §3.10)", () => {
  const agent = createAgent({ name: "runtime-bob" });
  assert.equal(agent.model_provider, null);
  assert.equal(agent.model_id, null);
  assert.equal(agent.thinking_level, null);

  const updated = setAgentRuntimeConfig(agent.id, {
    modelProvider: "zenmux",
    modelId: "claude-sonnet-4-6",
    thinkingLevel: "high",
  });
  assert.equal(updated.model_provider, "zenmux");
  assert.equal(updated.model_id, "claude-sonnet-4-6");
  assert.equal(updated.thinking_level, "high");

  // 未提供的维度保持原值
  const partial = setAgentRuntimeConfig(agent.id, { thinkingLevel: "low" });
  assert.equal(partial.model_provider, "zenmux");
  assert.equal(partial.model_id, "claude-sonnet-4-6");
  assert.equal(partial.thinking_level, "low");
});

test("setAgentRuntimeConfig clears overrides back to global defaults", () => {
  const agent = createAgent({ name: "runtime-clear" });
  setAgentRuntimeConfig(agent.id, { modelProvider: "p", modelId: "m", thinkingLevel: "off" });
  const cleared = setAgentRuntimeConfig(agent.id, { modelProvider: null, modelId: null, thinkingLevel: null });
  assert.equal(cleared.model_provider, null);
  assert.equal(cleared.model_id, null);
  assert.equal(cleared.thinking_level, null);
});

test("setAgentRuntimeConfig rejects provider/modelId half-sets", () => {
  const agent = createAgent({ name: "runtime-half" });
  assert.throws(
    () => setAgentRuntimeConfig(agent.id, { modelProvider: "p" }),
    /set or cleared together/i,
  );
  assert.throws(
    () => setAgentRuntimeConfig(agent.id, { modelId: "m" }),
    /set or cleared together/i,
  );
  assert.throws(
    () => setAgentRuntimeConfig(agent.id, { modelProvider: null, modelId: "m" }),
    /set or cleared together/i,
  );
  // 单独 thinking 允许
  const ok = setAgentRuntimeConfig(agent.id, { thinkingLevel: "medium" });
  assert.equal(ok.thinking_level, "medium");
  assert.equal(ok.model_provider, null);
});
