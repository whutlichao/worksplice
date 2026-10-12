import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./data/sqlite.ts";
import { normalizeWorkspacePath } from "./domain/collab/members.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-lifecycle-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, getAgent, listAgents, agentHomePath } = await import("./domain/collab/members.ts");
const { createChannel, joinChannel, listChannelMembers } = await import("./domain/collab/channels.ts");
const { sendMessage } = await import("./domain/collab/messages.ts");
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
const { searchArchivedSessionEntries } = await import("./session-archive.ts");

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
    async listSessionFilesForCwd(cwd) {
      const target = normalizeWorkspacePath(cwd);
      return this.sessionFiles
        .filter((file) => normalizeWorkspacePath(file.cwd) === target)
        .map((file) => file.path);
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

test("家目录派生绑定（存 NULL）：重启用当前数据目录下的家目录，不再有「未绑定」态", async () => {
  const agent = createAgent({ name: "nobound" });
  // NULL = 未显式绑定项目目录 → 工作区 = 家目录（ADR-0001）；读取侧按当前数据目录重推
  globalThis.__workspliceDb.setMemberWorkspace(agent.id, null, null);
  const runtime = makeFakeRuntime();
  await restartAgent(agent.id, runtime);
  assert.equal(
    runtime.sessionFiles[0].cwd,
    normalizeWorkspacePath(agentHomePath(getAgent(agent.id))),
    "会话 cwd 取当前数据目录下的家目录",
  );
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

/** 合成 session JSONL：头行 + 一条用户消息（埋关键事实），用于归档断言。 */
function sessionFileContent(cwd, fact) {
  return (
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "synthetic-1",
        timestamp: "2026-10-12T00:00:00.000Z",
        cwd,
      }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-10-12T00:00:01.000Z",
        message: { role: "user", content: `关键事实：${fact}` },
      }),
    ].join("\n") + "\n"
  );
}

test("sessionResetAgent 先把原始会话记录归档进数据目录再删除（B1/B6）", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "archiving-reset", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const sessionFile = path.join(ws, "session.jsonl");
  const original = sessionFileContent(ws, "重置前的暗号 BLUEPRINT-8");
  fs.writeFileSync(sessionFile, original);
  db.setMemberWorkspace(agent.id, ws, sessionFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await sessionResetAgent(agent.id, runtime);

  // B6：活动上下文不再包含它们（既有删除语义照旧）
  assert.equal(fs.existsSync(sessionFile), false, "原始 session 文件仍按既有逻辑删除");
  assert.equal(runtime.sessions.has(agent.id), false, "session destroyed");
  assert.equal(getAgent(agent.id).status, "offline");
  // B1：归档副本在数据目录内、逐字节一致、可解析出与重置前一致的会话条目
  const archiveDir = path.join(db.paths.sessionArchivesDir, agent.id);
  const copies = fs.readdirSync(archiveDir);
  assert.equal(copies.length, 1, "绑定 session 文件落一份归档副本");
  const archived = fs.readFileSync(path.join(archiveDir, copies[0]), "utf8");
  assert.equal(archived, original, "副本与重置前逐字节一致");
  const entries = archived.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(entries.length, 2, "重置后可解析出重置前的全部会话条目");
  assert.equal(entries[1].message.content, "关键事实：重置前的暗号 BLUEPRINT-8");
  // B2：重置后该事实仍可经归档索引命中（票 07 才接线消费面）
  const hits = searchArchivedSessionEntries("BLUEPRINT-8");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].agent_id, agent.id);
});

test("fullResetAgent 归档家目录 cwd 下的全部 session 文件后再清理（B6）", async () => {
  const agent = createAgent({ name: "home-archivist" }); // 无显式绑定 → 工作区 = 家目录
  const db = globalThis.__workspliceDb;
  const home = agent.workspace_path;
  const boundFile = path.join(home, "current.jsonl");
  const olderFile = path.join(home, "older.jsonl");
  const boundContent = sessionFileContent(home, "家目录当前会话 HOME-BOUND-1");
  const olderContent = sessionFileContent(home, "家目录历史会话 HOME-OLDER-2");
  fs.writeFileSync(boundFile, boundContent);
  fs.writeFileSync(olderFile, olderContent);
  db.setMemberWorkspace(agent.id, home, boundFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);
  runtime.sessionFiles.push({ cwd: home, path: olderFile }); // 家目录下的历史会话文件

  await fullResetAgent(agent.id, runtime);

  assert.equal(fs.existsSync(boundFile), false);
  assert.equal(fs.existsSync(olderFile), false);
  assert.equal(fs.existsSync(path.join(home, "MEMORY.md")), true, "MEMORY.md survives full reset");
  const archiveDir = path.join(db.paths.sessionArchivesDir, agent.id);
  const copies = fs.readdirSync(archiveDir);
  assert.equal(copies.length, 2, "家目录（构造上私有）cwd 下的全部 session 文件都被归档");
  const archived = copies.map((name) => fs.readFileSync(path.join(archiveDir, name), "utf8"));
  assert.ok(archived.includes(boundContent), "绑定文件已归档");
  assert.ok(archived.includes(olderContent), "家目录下的历史 session 文件已归档");
  assert.equal(searchArchivedSessionEntries("HOME-OLDER-2").length, 1);
});

test("共享项目目录 reset 只归档可确认归属的绑定文件（不碰归属不明的 cwd 文件）", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "shared-cwd-reset", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const boundFile = path.join(ws, "bound.jsonl");
  const orphanFile = path.join(ws, "human-or-orphan.jsonl");
  const boundContent = sessionFileContent(ws, "归属明确 BOUND-7");
  const orphanContent = sessionFileContent(ws, "归属不明 ORPHAN-9");
  fs.writeFileSync(boundFile, boundContent);
  fs.writeFileSync(orphanFile, orphanContent);
  db.setMemberWorkspace(agent.id, ws, boundFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);
  runtime.sessionFiles.push({ cwd: ws, path: orphanFile });

  await sessionResetAgent(agent.id, runtime);

  const archiveDir = path.join(db.paths.sessionArchivesDir, agent.id);
  const copies = fs.readdirSync(archiveDir);
  assert.equal(copies.length, 1, "共享 cwd 只归档绑定文件");
  assert.equal(
    fs.readFileSync(path.join(archiveDir, copies[0]), "utf8"),
    boundContent,
    "归档的是可确认归属的绑定文件",
  );
});

test("重复 reset 不产生重复归档副本与重复索引行", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "double-reset", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const sessionFile = path.join(ws, "session.jsonl");
  const content = sessionFileContent(ws, "重复重置暗号 RE-RUN-3");
  fs.writeFileSync(sessionFile, content);
  db.setMemberWorkspace(agent.id, ws, sessionFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await sessionResetAgent(agent.id, runtime);

  // 同一内容再次出现（重置后同文件重新落盘并重新绑定）→ 再 reset 一次
  fs.writeFileSync(sessionFile, content);
  db.setMemberWorkspace(agent.id, ws, sessionFile);
  runtime.sessionFiles.push({ cwd: ws, path: sessionFile });
  await sessionResetAgent(agent.id, runtime);

  const copies = fs.readdirSync(path.join(db.paths.sessionArchivesDir, agent.id));
  assert.equal(copies.length, 1, "同一内容不产生重复副本");
  assert.equal(searchArchivedSessionEntries("RE-RUN-3").length, 1, "不产生重复索引行");
});

test("无 session 文件可归档时 reset 正常跳过、不造空档", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "nothing-to-archive", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const runtime = makeFakeRuntime();

  await sessionResetAgent(agent.id, runtime);

  assert.equal(
    fs.existsSync(path.join(db.paths.sessionArchivesDir, agent.id)),
    false,
    "没有可归档的会话文件时不落归档目录",
  );
  assert.equal(getAgent(agent.id).pi_session_file, null, "绑定仍按既有逻辑清空");
});

test("fullResetAgent clears the home session and contents but keeps the directory and MEMORY.md", async () => {
  const agent = createAgent({ name: "full", description: "memorable" });
  const db = globalThis.__workspliceDb;
  const home = agent.workspace_path;
  const sessionFile = path.join(home, "session.jsonl");
  fs.writeFileSync(sessionFile, '{"type":"session"}\n');
  db.setMemberWorkspace(agent.id, home, sessionFile);
  fs.mkdirSync(path.join(home, "memories"));
  fs.writeFileSync(path.join(home, "memories", "context.md"), "forget me");
  fs.writeFileSync(path.join(home, "scratch.txt"), "forget me too");
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await fullResetAgent(agent.id, runtime);

  assert.equal(fs.existsSync(sessionFile), false);
  assert.equal(fs.existsSync(path.join(home, "memories")), false);
  assert.equal(fs.existsSync(path.join(home, "scratch.txt")), false);
  assert.equal(fs.existsSync(path.join(home, "MEMORY.md")), true, "MEMORY.md survives full reset");
  assert.equal(fs.existsSync(home), true, "home dir itself kept");
  assert.equal(getAgent(agent.id).pi_session_file, null);
  assert.equal(getAgent(agent.id).status, "offline");
});

test("fullResetAgent refuses a bound shared project directory", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "shared-worker", workspacePath: ws });
  await assert.rejects(
    () => fullResetAgent(agent.id, makeFakeRuntime()),
    /home directory/i,
  );
  assert.equal(fs.existsSync(ws), true, "shared project dir untouched");
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

test("avatar tint survives restart, session reset, workspace changes and full reset", async () => {
  const agent = createAgent({ name: "tint-lifecycle" });
  const db = globalThis.__workspliceDb;
  const home = agent.workspace_path;
  const runtime = makeFakeRuntime();
  db.setMemberAvatarTint(agent.id, 3);

  await runtime.startSession(agent);
  await restartAgent(agent.id, runtime);
  assert.equal(getAgent(agent.id).avatar_tint, 3);

  await sessionResetAgent(agent.id, runtime);
  assert.equal(getAgent(agent.id).avatar_tint, 3);

  const project = freshWorkspace();
  await changeAgentWorkspace(agent.id, project, runtime);
  assert.equal(getAgent(agent.id).avatar_tint, 3);

  await changeAgentWorkspace(agent.id, home, runtime);
  await fullResetAgent(agent.id, runtime);
  assert.equal(getAgent(agent.id).avatar_tint, 3);
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

test("deleteAgentIdentity removes the home directory and soft-deletes the identity", async () => {
  const agent = createAgent({ name: "doomed", description: "gone soon" });
  const db = globalThis.__workspliceDb;
  const home = agent.workspace_path;
  const sessionFile = path.join(home, "session.jsonl");
  fs.writeFileSync(sessionFile, '{"type":"session"}\n');
  db.setMemberWorkspace(agent.id, home, sessionFile);

  const channel = createChannel({ name: "lc-channel" });
  joinChannel(channel.id, agent.id, "owner");
  const message = sendMessage({ targetId: channel.id, authorId: agent.id, content: "legacy" }).message;
  db.insertTask({ messageId: message.id, number: 1, ownerId: agent.id });
  db.setConsumedSeq(agent.id, channel.id, 2);

  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await deleteAgentIdentity(agent.id, runtime);

  assert.equal(runtime.sessions.has(agent.id), false, "session destroyed");
  assert.equal(fs.existsSync(home), false, "home directory removed");
  assert.equal(fs.existsSync(sessionFile), false);
  assert.ok(!listAgents().some((a) => a.id === agent.id));
  assert.equal(db.getMember(agent.id).deleted, 1, "identity soft-deleted, history row kept");
  assert.ok(!listChannelMembers(BUILTIN_CHANNEL_ID).some((m) => m.id === agent.id));
  assert.ok(!listChannelMembers(channel.id).some((m) => m.id === agent.id));
  assert.equal(db.listTasks().find((t) => t.message_id === message.id).owner_id, null);
  assert.ok(db.listMessages(channel.id).some((m) => m.author_id === agent.id), "messages kept");
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 0);
});

test("deleteAgentIdentity keeps a bound shared project directory", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "project-worker", workspacePath: ws });
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await deleteAgentIdentity(agent.id, runtime);

  assert.equal(fs.existsSync(ws), true, "shared project dir must never be removed");
  assert.equal(globalThis.__workspliceDb.getMember(agent.id).deleted, 1);
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
