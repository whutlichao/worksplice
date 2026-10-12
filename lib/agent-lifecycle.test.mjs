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
    // 票 09 收口：runtime 只按调用方给出的路径执行删除（归属判定在 agent-lifecycle 侧）
    async removeSessionFiles(paths) {
      for (const file of paths) {
        if (fs.existsSync(file)) fs.rmSync(file, { force: true });
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

test("sessionResetAgent：家目录 cwd 下的 session 全部清理，重启不复活旧上下文", async () => {
  const agent = createAgent({ name: "reset-all" }); // 无显式绑定 → 工作区 = 家目录（构造上唯一私有）
  const db = globalThis.__workspliceDb;
  const home = agent.workspace_path;
  const currentFile = path.join(home, "current.jsonl");
  const oldFile = path.join(home, "older.jsonl");
  fs.writeFileSync(currentFile, sessionFileContent(home, "家目录当前会话 RESET-HOME-1"));
  fs.writeFileSync(oldFile, sessionFileContent(home, "家目录旧会话 RESET-HOME-2"));
  db.setMemberWorkspace(agent.id, home, currentFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);
  runtime.sessionFiles.push({ cwd: home, path: oldFile }); // 家目录下残留的旧会话文件

  await sessionResetAgent(agent.id, runtime);
  await restartAgent(agent.id, runtime);

  // 家目录（归属可确认）：全部清理 ⇒ restart 得到全新会话（无旧文件可回落）
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

test("共享项目目录 reset 只归档并清理可确认归属的绑定文件（归属不明的 session 保留）", async () => {
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
  runtime.sessionFiles.push({ cwd: ws, path: orphanFile }); // 无任何成员登记（人类会话/遗留）

  await sessionResetAgent(agent.id, runtime);

  // 归档：只含可确认归属的绑定文件（票 06 落点）
  const archiveDir = path.join(db.paths.sessionArchivesDir, agent.id);
  const copies = fs.readdirSync(archiveDir);
  assert.equal(copies.length, 1, "共享 cwd 只归档绑定文件");
  assert.equal(
    fs.readFileSync(path.join(archiveDir, copies[0]), "utf8"),
    boundContent,
    "归档的是可确认归属的绑定文件",
  );
  // 清理（票 09 收口）：绑定文件被清、归属不明 session 逐字节保留
  assert.equal(fs.existsSync(boundFile), false, "可确认归属的绑定文件被清理");
  assert.equal(getAgent(agent.id).pi_session_file, null, "绑定登记清空");
  assert.equal(
    fs.readFileSync(orphanFile, "utf8"),
    orphanContent,
    "归属不明的 session 未被删除",
  );
  // 共享目录不回填无主文件：restart 仍是全新会话，不复活旧上下文
  await restartAgent(agent.id, runtime);
  assert.equal(runtime.started.at(-1).sessionFile, `/sessions/${agent.id}.jsonl`);
});

test("其他成员登记的 session 文件（登记冲突）在 reset 时保留、不归档", async () => {
  const agent = createAgent({ name: "conflict-owner" }); // 家目录
  const db = globalThis.__workspliceDb;
  const home = agent.workspace_path;
  const boundFile = path.join(home, "bound.jsonl");
  const conflictedFile = path.join(home, "claimed-by-other.jsonl");
  const boundContent = sessionFileContent(home, "本人绑定 CONFLICT-OWN-1");
  const conflictedContent = sessionFileContent(home, "他人登记 CONFLICT-OTHER-2");
  fs.writeFileSync(boundFile, boundContent);
  fs.writeFileSync(conflictedFile, conflictedContent);
  db.setMemberWorkspace(agent.id, home, boundFile);
  // 另一个成员固化登记了该路径（ADR-0003 所有权凭证冲突）：归属不确定 ⇒ 保留、不归档
  const other = createAgent({ name: "conflict-claimer", workspacePath: freshWorkspace() });
  db.setMemberWorkspace(other.id, other.workspace_path, conflictedFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);
  runtime.sessionFiles.push({ cwd: home, path: conflictedFile });

  await sessionResetAgent(agent.id, runtime);

  assert.equal(fs.existsSync(boundFile), false, "本人绑定文件仍按既有逻辑清理");
  assert.equal(
    fs.readFileSync(conflictedFile, "utf8"),
    conflictedContent,
    "他人登记的路径保留（不确定 = 保留）",
  );
  const archiveDir = path.join(db.paths.sessionArchivesDir, agent.id);
  const copies = fs.readdirSync(archiveDir);
  assert.equal(copies.length, 1, "登记冲突的文件不进归档");
  assert.equal(fs.readFileSync(path.join(archiveDir, copies[0]), "utf8"), boundContent);
});

test("绑定文件被其他成员登记时（登记冲突）保留文件、只清本 agent 的登记", async () => {
  const ws = freshWorkspace();
  const agent = createAgent({ name: "bound-conflict", workspacePath: ws });
  const db = globalThis.__workspliceDb;
  const file = path.join(ws, "claimed-by-both.jsonl");
  const content = sessionFileContent(ws, "双方登记 CONFLICT-BOUND-3");
  fs.writeFileSync(file, content);
  db.setMemberWorkspace(agent.id, ws, file);
  const other = createAgent({ name: "bound-conflict-other", workspacePath: ws });
  db.setMemberWorkspace(other.id, ws, file);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await sessionResetAgent(agent.id, runtime);

  assert.equal(fs.readFileSync(file, "utf8"), content, "登记冲突路径保留（不确定 = 保留）");
  assert.equal(getAgent(agent.id).pi_session_file, null, "本 agent 的登记仍清空");
  assert.equal(getAgent(other.id).pi_session_file, file, "他人登记不受影响");
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

test("deleteAgentIdentity 清私有归档副本与索引、清私有持久记忆、保协作历史（B7）", async () => {
  const agent = createAgent({ name: "archive-doomed", description: "gone soon" });
  const db = globalThis.__workspliceDb;
  const home = agent.workspace_path;
  const sessionFile = path.join(home, "session.jsonl");
  const fact = "被删 agent 暗号 PURGED-5";
  fs.writeFileSync(sessionFile, sessionFileContent(home, fact));
  db.setMemberWorkspace(agent.id, home, sessionFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);
  await sessionResetAgent(agent.id, runtime); // 先重置一次 ⇒ 建立私有归档副本与索引（票 06）

  const archiveDir = path.join(db.paths.sessionArchivesDir, agent.id);
  assert.equal(fs.existsSync(archiveDir), true, "重置后归档副本存在");
  assert.equal(searchArchivedSessionEntries(fact).length, 1, "重置后归档内容可检索");

  // 旁观者 agent 的私有归档：删除他人时不得被牵连
  const bystander = createAgent({ name: "archive-bystander" });
  const bystanderFile = path.join(bystander.workspace_path, "session.jsonl");
  const bystanderFact = "旁观者暗号 BYSTANDER-6";
  fs.writeFileSync(bystanderFile, sessionFileContent(bystander.workspace_path, bystanderFact));
  db.setMemberWorkspace(bystander.id, bystander.workspace_path, bystanderFile);
  const bystanderRuntime = makeFakeRuntime();
  await bystanderRuntime.startSession(bystander);
  await sessionResetAgent(bystander.id, bystanderRuntime);

  // 协作历史：频道消息（不可变触发器保证不可 UPDATE/DELETE）
  const channel = createChannel({ name: "purge-channel" });
  joinChannel(channel.id, agent.id, "owner");
  sendMessage({ targetId: channel.id, authorId: agent.id, content: "记住我" });

  await deleteAgentIdentity(agent.id, runtime);

  assert.equal(fs.existsSync(archiveDir), false, "私有归档副本目录被清除");
  assert.equal(searchArchivedSessionEntries(fact).length, 0, "被删 agent 的归档对检索面不可见");
  assert.equal(fs.existsSync(path.join(home, "MEMORY.md")), false, "私有持久记忆被清除");
  assert.ok(db.listMessages(channel.id).some((m) => m.author_id === agent.id), "协作消息仍在");
  assert.equal(db.getMember(agent.id).deleted, 1, "身份 soft-delete");
  assert.equal(
    searchArchivedSessionEntries(bystanderFact).length,
    1,
    "其他 agent 的私有归档不受影响（不扩大删除范围）",
  );
});

test("deleteAgentIdentity：绑定共享项目目录时只清自己的会话与 MEMORY.md，不动他人 session", async () => {
  const ws = freshWorkspace();
  // 先建家目录（预置 MEMORY.md），再改绑共享项目目录——模拟「有私有持久记忆、又绑了项目」的 agent
  const agent = createAgent({ name: "shared-doomed" });
  const db = globalThis.__workspliceDb;
  const home = agentHomePath(getAgent(agent.id));
  assert.equal(fs.existsSync(path.join(home, "MEMORY.md")), true, "家目录预置 MEMORY.md");
  const runtime = makeFakeRuntime();
  await changeAgentWorkspace(agent.id, ws, runtime);
  const boundFile = path.join(ws, "shared-doomed.jsonl");
  const otherFile = path.join(ws, "other-agent.jsonl");
  fs.writeFileSync(boundFile, sessionFileContent(ws, "被删 agent 会话 SHARED-DOOM-7"));
  fs.writeFileSync(otherFile, sessionFileContent(ws, "他人会话 OTHERS-8"));
  db.setMemberWorkspace(agent.id, ws, boundFile);
  const other = createAgent({ name: "shared-survivor", workspacePath: ws });
  db.setMemberWorkspace(other.id, ws, otherFile); // 他人的固化登记（ADR-0003 所有权凭证）
  await runtime.startSession(getAgent(agent.id));

  await deleteAgentIdentity(agent.id, runtime);

  assert.equal(fs.existsSync(boundFile), false, "被删 agent 自己的会话文件被清理");
  assert.equal(fs.existsSync(otherFile), true, "共享目录里他人登记的 session 未被删除");
  assert.equal(fs.existsSync(ws), true, "共享项目目录本身保留");
  assert.equal(db.getMember(other.id).pi_session_file, otherFile, "他人登记不受影响");
  // 私有持久记忆清空；家目录本体不在本票删除范围内（不扩大删除范围）
  assert.equal(fs.existsSync(path.join(home, "MEMORY.md")), false, "私有持久记忆被清除");
  assert.equal(fs.existsSync(home), true, "绑定项目目录时家目录本体保留（不扩大删除范围）");
});

test("重置路径不删归档副本（再次 Session Reset / Full Reset 后仍可检索），删除才清除", async () => {
  const agent = createAgent({ name: "reset-keeps-archive" });
  const db = globalThis.__workspliceDb;
  const home = agent.workspace_path;
  const sessionFile = path.join(home, "session.jsonl");
  const fact = "重置保留暗号 KEEP-ARCHIVE-4";
  fs.writeFileSync(sessionFile, sessionFileContent(home, fact));
  db.setMemberWorkspace(agent.id, home, sessionFile);
  const runtime = makeFakeRuntime();
  await runtime.startSession(agent);

  await sessionResetAgent(agent.id, runtime); // 第一次重置 ⇒ 归档
  const archiveDir = path.join(db.paths.sessionArchivesDir, agent.id);
  const firstCopies = fs.readdirSync(archiveDir).sort();

  // 同内容再次落盘并绑定 → Full Reset：归档只收敛/复用，绝不清除（票 06 不变量）
  fs.writeFileSync(sessionFile, sessionFileContent(home, fact));
  db.setMemberWorkspace(agent.id, home, sessionFile);
  runtime.sessionFiles.push({ cwd: home, path: sessionFile });
  await fullResetAgent(agent.id, runtime);

  assert.deepEqual(fs.readdirSync(archiveDir).sort(), firstCopies, "重置路径不删归档副本");
  assert.equal(searchArchivedSessionEntries(fact).length, 1, "重置后归档仍可检索（B6）");
  assert.equal(fs.existsSync(path.join(home, "MEMORY.md")), true, "Full Reset 保留 MEMORY.md");

  await deleteAgentIdentity(agent.id, runtime);

  assert.equal(fs.existsSync(archiveDir), false, "只有显式永久删除才清除归档");
  assert.equal(searchArchivedSessionEntries(fact).length, 0);
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
