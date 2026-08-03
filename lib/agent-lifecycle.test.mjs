import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./data/db.ts";
import { normalizeWorkspacePath } from "./raft/members.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-lifecycle-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, getAgent, listAgents } = await import("./raft/members.ts");
const { createChannel, joinChannel, listChannelMembers } = await import("./raft/channels.ts");
const { sendMessage } = await import("./raft/messages.ts");
const { BUILTIN_CHANNEL_ID } = await import("./data/schema.ts");
const {
  restartAgent,
  sessionResetAgent,
  fullResetAgent,
  changeAgentWorkspace,
  deleteAgentIdentity,
} = await import("./agent-lifecycle.ts");
const { BusyCwdError } = await import("./agent-runtime.ts");
const { publishAgentStatus, subscribeAgentStatuses, setAgentStatusLookup } = await import(
  "./agent-status.ts"
);

function freshWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-lc-ws-"));
}

function makeFakeRuntime() {
  const sessions = new Map();
  return {
    busyCwd: null,
    sessions,
    started: [],
    sessionFiles: [],
    findSession: (member) => sessions.get(member.id),
    async startSession(member) {
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      const cwd = normalizeWorkspacePath(member.workspace_path);
      if (this.busyCwd === cwd) throw new BusyCwdError(cwd);
      const sessionFile = member.pi_session_file ?? `/sessions/${member.id}.jsonl`;
      sessions.set(member.id, { sessionFile });
      this.started.push({ id: member.id, sessionFile });
      this.sessionFiles.push({ cwd, path: sessionFile });
      publishAgentStatus(member.id, "online"); // 与真实 runtime 行为一致
      return { sessionId: member.id, sessionFile };
    },
    async destroySession(member) {
      sessions.delete(member.id);
      publishAgentStatus(member.id, "offline"); // 与真实 runtime 行为一致
    },
    async removeSessionFilesForCwd(cwd) {
      const target = normalizeWorkspacePath(cwd);
      for (const file of this.sessionFiles) {
        if (normalizeWorkspacePath(file.cwd) === target && fs.existsSync(file.path)) {
          fs.rmSync(file.path, { force: true });
        }
      }
    },
  };
}

function fakeLookup(runtime) {
  setAgentStatusLookup((member) => {
    const session = runtime.sessions.get(member.id);
    return session ? "online" : null;
  });
}

test("restartAgent keeps the same session file (Restart 沿用 session 接着干)", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "restarter", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  db.setMemberWorkspace(agent.id, ws, "/sessions/restarter.jsonl");
  const runtime = makeFakeRuntime();
  fakeLookup(runtime);

  let lastStatus = null;
  const unsubscribe = subscribeAgentStatuses((snapshot) => (lastStatus = snapshot[agent.id]));
  await restartAgent(agent.id, runtime);
  unsubscribe();

  // 同一 session 文件被复用（上下文保留），并回填/发布 online
  assert.equal(runtime.sessions.get(agent.id).sessionFile, "/sessions/restarter.jsonl");
  assert.equal(getAgent(agent.id).pi_session_file, "/sessions/restarter.jsonl");
  assert.equal(lastStatus, "online");

  // 再次 restart：先销毁再按同一文件重启
  await restartAgent(agent.id, runtime);
  assert.equal(runtime.sessions.get(agent.id).sessionFile, "/sessions/restarter.jsonl");
  assert.equal(runtime.started.length, 2);
});

test("restartAgent on an unbound agent rejects", async () => {
  const agent = createAgent({ name: "nobound" });
  await assert.rejects(() => restartAgent(agent.id, makeFakeRuntime()), /no workspace bound/i);
});

test("a second session cannot start while another session is busy in the same cwd", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "contender", workspacePath: ws });
  const runtime = makeFakeRuntime();
  runtime.busyCwd = normalizeWorkspacePath(ws); // 同一 cwd 已有活跃会话（§5.2）
  await assert.rejects(
    () => restartAgent(agent.id, runtime),
    (error) => error instanceof BusyCwdError,
  );
});

test("sessionResetAgent deletes the session file and clears the binding but keeps the workspace", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "reset", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const sessionFile = path.join(ws, "session.jsonl");
  fs.writeFileSync(sessionFile, '{"type":"session"}\n');
  db.setMemberWorkspace(agent.id, ws, sessionFile);
  fs.writeFileSync(path.join(ws, "notes.md"), "keep me");
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await sessionResetAgent(agent.id, runtime);

  assert.equal(fs.existsSync(sessionFile), false, "session file deleted");
  assert.equal(getAgent(agent.id).pi_session_file, null);
  assert.equal(fs.existsSync(ws), true, "workspace dir kept");
  assert.equal(fs.readFileSync(path.join(ws, "notes.md"), "utf8"), "keep me", "workspace content kept");
  assert.equal(runtime.sessions.has(agent.id), false, "session destroyed");
  assert.equal(getAgent(agent.id).status, "offline");
});

test("sessionResetAgent removes every session file in the cwd so restart cannot resurrect old context", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "reset-all", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const currentFile = path.join(ws, "current.jsonl");
  const oldFile = path.join(ws, "older.jsonl");
  fs.writeFileSync(currentFile, '{"type":"session"}\n');
  fs.writeFileSync(oldFile, '{"type":"session"}\n');
  db.setMemberWorkspace(agent.id, ws, currentFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);
  runtime.sessionFiles.push({ cwd: ws, path: oldFile }); // cwd 下残留的旧会话文件

  await sessionResetAgent(agent.id, runtime);
  await restartAgent(agent.id, runtime);

  // reset 后 restart 得到的是全新会话（无旧文件可回落），而不是旧上下文
  assert.equal(fs.existsSync(currentFile), false);
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(runtime.started.at(-1).sessionFile, `/sessions/${agent.id}.jsonl`);
});

test("fullResetAgent clears session and workspace contents but keeps the directory", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "full", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const sessionFile = path.join(ws, "session.jsonl");
  fs.writeFileSync(sessionFile, '{"type":"session"}\n');
  db.setMemberWorkspace(agent.id, ws, sessionFile);
  fs.mkdirSync(path.join(ws, "memories"));
  fs.writeFileSync(path.join(ws, "memories", "context.md"), "forget me");
  fs.writeFileSync(path.join(ws, "scratch.txt"), "forget me too");
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await fullResetAgent(agent.id, runtime);

  assert.equal(fs.existsSync(sessionFile), false);
  assert.equal(fs.existsSync(path.join(ws, "memories")), false);
  assert.equal(fs.existsSync(path.join(ws, "scratch.txt")), false);
  assert.equal(fs.existsSync(ws), true, "workspace dir itself kept for rebinding");
  assert.equal(getAgent(agent.id).pi_session_file, null);
  assert.equal(getAgent(agent.id).status, "offline");
});

test("changeAgentWorkspace destroys the old-cwd session, rebinds and clears the session record", async () => {
  const ws1 = freshWorkspace();
  const ws2 = freshWorkspace();
  const agent = createAgent({ name: "mover", workspacePath: ws1 });
  const db = globalThis.__workspliceDb;
  db.setMemberWorkspace(agent.id, ws1, "/sessions/mover.jsonl");
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await changeAgentWorkspace(agent.id, ws2, runtime);

  assert.equal(runtime.sessions.has(agent.id), false, "old session destroyed (换目录即换会话)");
  assert.equal(getAgent(agent.id).workspace_path, ws2);
  assert.equal(getAgent(agent.id).pi_session_file, null);
  assert.equal(getAgent(agent.id).status, "offline");
});

test("changeAgentWorkspace validates the new path BEFORE killing the live session", async () => {
  const ws1 = freshWorkspace();
  const agent = createAgent({ name: "saver", workspacePath: ws1 });
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await assert.rejects(
    () => changeAgentWorkspace(agent.id, path.join(os.tmpdir(), "no-such-dir"), runtime),
    /does not exist/i,
  );
  assert.equal(runtime.sessions.has(agent.id), true, "bad path must not kill the live session");
  assert.equal(getAgent(agent.id).workspace_path, ws1);
});

test("deleteAgentIdentity destroys the session, removes the workspace dir and soft-deletes the identity", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "doomed", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const sessionFile = path.join(ws, "session.jsonl");
  fs.writeFileSync(sessionFile, '{"type":"session"}\n');
  db.setMemberWorkspace(agent.id, ws, sessionFile);

  const channel = createChannel({ name: "lc-channel" });
  joinChannel(channel.id, agent.id, "owner");
  const message = sendMessage({ targetId: channel.id, authorId: agent.id, content: "legacy" }).message;
  db.insertTask({ messageId: message.id, number: 1, ownerId: agent.id });
  db.setConsumedSeq(agent.id, channel.id, 2);

  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await deleteAgentIdentity(agent.id, runtime);

  assert.equal(runtime.sessions.has(agent.id), false, "session destroyed");
  assert.equal(fs.existsSync(ws), false, "workspace directory removed");
  assert.equal(fs.existsSync(sessionFile), false);
  assert.ok(!listAgents().some((a) => a.id === agent.id));
  assert.equal(db.getMember(agent.id).deleted, 1, "identity soft-deleted, history row kept");
  assert.ok(!listChannelMembers(BUILTIN_CHANNEL_ID).some((m) => m.id === agent.id));
  assert.ok(!listChannelMembers(channel.id).some((m) => m.id === agent.id));
  assert.equal(db.listTasks().find((t) => t.message_id === message.id).owner_id, null);
  assert.ok(db.listMessages(channel.id).some((m) => m.author_id === agent.id), "messages kept");
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 0);
});

test("publishAgentStatus is used to broadcast lifecycle transitions", async () => {
  const agent = createAgent({ name: "status-wired", workspacePath: freshWorkspace() });
  const runtime = makeFakeRuntime();
  fakeLookup(runtime);
  const statuses = [];
  const unsubscribe = subscribeAgentStatuses((snapshot) => statuses.push(snapshot[agent.id]));
  publishAgentStatus(agent.id, "offline");
  await restartAgent(agent.id, runtime);
  unsubscribe();

  assert.ok(statuses.includes("online"), `expected an online transition, got ${JSON.stringify(statuses)}`);
});
