import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { BUILTIN_CHANNEL_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-members-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createAgent,
  listAgents,
  getAgent,
  updateAgentWorkspace,
  setAgentStatus,
  deleteAgent,
  homeDirOfAnotherAgent,
  agentHomePath,
  extractMentionedMemberIds,
  getOwner,
  setAgentRuntimeConfig,
  DuplicateAgentNameError,
} = await import("./members.ts");
const { createChannel, joinChannel, listChannelMembers } = await import(
  "./channels.ts"
);
const { sendMessage } = await import("./messages.ts");
const { agentSlug, MEMORY_FILE_NAME } = await import("../../data/dirs.ts");
const pathModule = await import("node:path");

function freshWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-ws-"));
  return dir;
}

test("createAgent auto-creates a unique home directory with a MEMORY.md outline and joins #all", () => {
  const agent = createAgent({ name: "bob", description: "helper" });
  assert.equal(agent.type, "agent");
  assert.equal(agent.name, "bob");
  assert.equal(agent.description, "helper");
  assert.equal(agent.status, "offline");
  assert.equal(agent.deleted, 0);
  const home = pathModule.join(
    root,
    "agents",
    `${agentSlug(agent.name)}-${agent.id.slice(0, 8)}`,
  );
  assert.equal(agent.workspace_path, home);
  assert.equal(agentHomePath(agent), home);
  assert.equal(fs.existsSync(home), true, "home directory created");
  const memory = fs.readFileSync(
    pathModule.join(home, MEMORY_FILE_NAME),
    "utf8",
  );
  assert.match(memory, /^# bob/);
  assert.match(memory, /helper/);
  assert.match(memory, /## Current work/);
  assert.match(memory, /## Workflow/);
  assert.match(memory, /## Skills/);
  assert.match(memory, /## Tools/);
  assert.match(memory, /## Other/);
  // 内容层无 CJK 的单点守卫在 content-language.test.mjs（不在此重复）
  assert.ok(
    listChannelMembers(BUILTIN_CHANNEL_ID).some((m) => m.id === agent.id),
  );
  assert.ok(listAgents().some((a) => a.id === agent.id));
});

test("createAgent persists the required model / thinking level selection", () => {
  const agent = createAgent({
    name: "modeled",
    provider: "zenmux",
    modelId: "claude-sonnet-4-6",
    thinkingLevel: "high",
  });
  assert.equal(agent.model_provider, "zenmux");
  assert.equal(agent.model_id, "claude-sonnet-4-6");
  assert.equal(agent.thinking_level, "high");
});

test("createAgent rejects a half-set model pair", () => {
  assert.throws(
    () => createAgent({ name: "half", provider: "zenmux" }),
    /set or cleared together/i,
  );
});

test("createAgent with an explicit workspacePath keeps the legacy binding behavior", () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "explicit", workspacePath: ws });
  assert.equal(agent.workspace_path, ws);
});

test("createAgent rejects a workspace directory that does not exist", () => {
  assert.throws(
    () =>
      createAgent({
        name: "ghost",
        workspacePath: path.join(os.tmpdir(), "no-such-worksplice-dir"),
      }),
    /does not exist/i,
  );
});

test("multiple agents can bind the same project directory (ADR-0001 shared collaboration)", () => {
  const ws = freshWorkspace();
  const first = createAgent({ name: "first", workspacePath: ws });
  const second = createAgent({ name: "second", workspacePath: ws });
  assert.equal(first.workspace_path, ws);
  assert.equal(second.workspace_path, ws);
});

test("updateAgentWorkspace binds a new directory and clears the persisted session file", () => {
  const ws1 = freshWorkspace();
  const ws2 = freshWorkspace();
  const agent = createAgent({ name: "mover", workspacePath: ws1 });
  globalThis.__workspliceDb.setMemberWorkspace(
    agent.id,
    ws1,
    "/fake/session.jsonl",
  );
  updateAgentWorkspace(agent.id, ws2);
  const updated = getAgent(agent.id);
  assert.equal(updated.workspace_path, ws2);
  assert.equal(updated.pi_session_file, null);
});

test("updateAgentWorkspace rejects binding another agent's home directory", () => {
  const other = createAgent({ name: "home-owner" });
  const b = createAgent({ name: "intruder", workspacePath: freshWorkspace() });
  assert.throws(
    () => updateAgentWorkspace(b.id, other.workspace_path),
    /another agent's home/i,
  );
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
  const message = sendMessage({
    targetId: channel.id,
    authorId: "owner",
    content: "task anchor",
  }).message;
  db.insertTask({ messageId: message.id, number: 1, ownerId: agent.id });
  db.setConsumedSeq(agent.id, channel.id, 3);

  deleteAgent(agent.id);

  assert.ok(!listAgents().some((a) => a.id === agent.id));
  assert.throws(() => getAgent(agent.id), /not found/i);
  assert.ok(
    db.getMember(agent.id),
    "member row kept for immutable message history",
  );
  assert.equal(db.getMember(agent.id).deleted, 1);
  assert.ok(
    !listChannelMembers(BUILTIN_CHANNEL_ID).some((m) => m.id === agent.id),
  );
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

test("homeDirOfAnotherAgent detects other live agents' homes (deleted and unbound agents excluded)", () => {
  const a = createAgent({ name: "owner-x" });
  assert.equal(homeDirOfAnotherAgent(a.workspace_path, a.id), false);
  const b = createAgent({ name: "legacy", workspacePath: freshWorkspace() });
  assert.equal(homeDirOfAnotherAgent(a.workspace_path, b.id), true);
  assert.equal(homeDirOfAnotherAgent(a.workspace_path, a.id), false);
  deleteAgent(a.id);
  assert.equal(
    homeDirOfAnotherAgent(
      agentHomePath(globalThis.__workspliceDb.getMember(a.id)),
      b.id,
    ),
    false,
  );
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
  setAgentRuntimeConfig(agent.id, {
    modelProvider: "p",
    modelId: "m",
    thinkingLevel: "off",
  });
  const cleared = setAgentRuntimeConfig(agent.id, {
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
  });
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
    () =>
      setAgentRuntimeConfig(agent.id, { modelProvider: null, modelId: "m" }),
    /set or cleared together/i,
  );
  // 单独 thinking 允许
  const ok = setAgentRuntimeConfig(agent.id, { thinkingLevel: "medium" });
  assert.equal(ok.thinking_level, "medium");
  assert.equal(ok.model_provider, null);
});

test("getOwner returns the human member", () => {
  const owner = getOwner();
  assert.ok(owner, "owner row exists");
  assert.equal(owner.type, "human");
});

test("createAgent rejects a duplicate name (exact, case-insensitive, whitespace-trimmed)", () => {
  createAgent({ name: "Alice" });
  // 精确同名
  assert.throws(() => createAgent({ name: "Alice" }), DuplicateAgentNameError);
  // 仅大小写不同
  assert.throws(() => createAgent({ name: "alice" }), /already exists/);
  // 首尾空格差异（trim 后重名）
  assert.throws(
    () => createAgent({ name: "  Alice  " }),
    /Alice.*already exists/,
  );
  // 成员列表不出现第二个同名 agent
  assert.equal(
    listAgents().filter((a) => a.name.toLowerCase() === "alice").length,
    1,
  );
});

test("createAgent rejects a name colliding with the human owner", () => {
  assert.throws(() => createAgent({ name: "Owner" }), /already exists/);
  assert.throws(() => createAgent({ name: "OWNER" }), /already exists/);
});

test("createAgent allows reusing the name after the previous agent is soft-deleted", () => {
  const original = createAgent({ name: "recyclable" });
  deleteAgent(original.id);
  const replacement = createAgent({ name: "recyclable" });
  assert.equal(replacement.name, "recyclable");
  assert.equal(replacement.id !== original.id, true);
  assert.equal(listAgents().filter((a) => a.name === "recyclable").length, 1);
});

test("extractMentionedMemberIds resolves plain and quoted mentions (shared parser)", () => {
  createAgent({ name: "mention-target" });
  createAgent({ name: "spacey target" });
  const ids = extractMentionedMemberIds(
    'ping @mention-target and @"spacey target"',
  );
  assert.equal(ids.length, 2);
  assert.ok(ids.includes(getAgentBy("mention-target").id));
  assert.ok(ids.includes(getAgentBy("spacey target").id));
  assert.equal(extractMentionedMemberIds("@nobody @ghost").length, 0);
});

function getAgentBy(name) {
  return listAgents().find((a) => a.name === name);
}
