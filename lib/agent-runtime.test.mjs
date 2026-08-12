import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./data/db.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-agent-runtime-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, deleteAgent, getAgent, setAgentSessionFile, agentHomePath } =
  await import("./raft/members.ts");
const { chooseSessionFileForStart, isOwnHomeDir, referencedSessionFiles, withCwdStartLock } =
  await import("./agent-runtime.ts");

const SHARED = path.join(root, "shared-project");

function makeAgent(name) {
  return getAgent(createAgent({ name }).id);
}

function bindWorkspace(agent, workspacePath) {
  globalThis.__workspliceDb.setMemberWorkspace(agent.id, workspacePath, null);
  return getAgent(agent.id);
}

// ---------------------------------------------------------------------------
// chooseSessionFileForStart：ticket 03 所有权规则
// ---------------------------------------------------------------------------

test("a validly bound session file is reused", () => {
  const agent = makeAgent("reuser");
  const file = path.join(agent.workspace_path, "own.jsonl");
  setAgentSessionFile(agent.id, file);
  const bound = getAgent(agent.id);
  const choice = chooseSessionFileForStart({
    member: bound,
    cwd: bound.workspace_path,
    boundFileExists: true,
    boundFileCwd: bound.workspace_path,
    referencedByOthers: new Set(),
    isOwnHome: true,
    latestUnreferenced: null,
  });
  assert.deepEqual(choice, { sessionFile: file, clearedBinding: false });
});

test("a shared dir never adopts an unowned file (A deleted -> B must not inherit)", () => {
  // 复现：A 的会话文件残留在共享目录且无固化登记（删除/人类会话/他人旧文件），
  // B 绑同一目录启动——不得解析 A 的文件，一律新建空会话。
  const agent = bindWorkspace(makeAgent("orphan-avoider"), SHARED);
  const orphan = path.join(SHARED, "deleted-agent-A.jsonl");
  const choice = chooseSessionFileForStart({
    member: agent,
    cwd: SHARED,
    boundFileExists: false,
    boundFileCwd: null,
    referencedByOthers: new Set(),
    isOwnHome: false,
    latestUnreferenced: orphan, // 目录里存在无主文件也视而不见
  });
  assert.deepEqual(choice, { sessionFile: null, clearedBinding: false });
});

test("a home dir still adopts its own latest file when unbound", () => {
  const agent = makeAgent("home-adopter");
  const ownOld = path.join(agent.workspace_path, "old.jsonl");
  const choice = chooseSessionFileForStart({
    member: agent,
    cwd: agent.workspace_path,
    boundFileExists: false,
    boundFileCwd: null,
    referencedByOthers: new Set(),
    isOwnHome: true,
    latestUnreferenced: ownOld,
  });
  assert.deepEqual(choice, { sessionFile: ownOld, clearedBinding: false });
});

test("a home dir with a lost binding still adopts its own latest file", () => {
  const agent = makeAgent("home-lost");
  setAgentSessionFile(agent.id, path.join(agent.workspace_path, "gone.jsonl"));
  const bound = getAgent(agent.id);
  const ownOld = path.join(agent.workspace_path, "old.jsonl");
  const choice = chooseSessionFileForStart({
    member: bound,
    cwd: bound.workspace_path,
    boundFileExists: false,
    boundFileCwd: null,
    referencedByOthers: new Set(),
    isOwnHome: true,
    latestUnreferenced: ownOld,
  });
  assert.deepEqual(choice, { sessionFile: ownOld, clearedBinding: false });
});

test("a misbound file from another cwd is self-healed (binding cleared, fresh session)", () => {
  const agent = makeAgent("cross-cwd");
  setAgentSessionFile(agent.id, path.join(SHARED, "from-elsewhere.jsonl"));
  const bound = getAgent(agent.id);
  const choice = chooseSessionFileForStart({
    member: bound,
    cwd: bound.workspace_path, // workspace 是家目录，绑定文件却在共享目录
    boundFileExists: true,
    boundFileCwd: SHARED,
    referencedByOthers: new Set(),
    isOwnHome: true,
    latestUnreferenced: null,
  });
  assert.deepEqual(choice, { sessionFile: null, clearedBinding: true });
});

test("a file referenced by another member is self-healed (two agents, same file)", () => {
  // 复现：两 agent 同文件（并发双启动/旧脏数据残留）——B 的绑定被 A 固化引用时
  // 不得复用，清绑 + 新建。
  const agent = bindWorkspace(makeAgent("double-bind"), SHARED);
  const contested = path.join(SHARED, "contested.jsonl");
  setAgentSessionFile(agent.id, contested);
  const bound = getAgent(agent.id);
  const choice = chooseSessionFileForStart({
    member: bound,
    cwd: SHARED,
    boundFileExists: true,
    boundFileCwd: SHARED,
    referencedByOthers: new Set([contested]), // 其他成员已固化该文件
    isOwnHome: false,
    latestUnreferenced: null,
  });
  assert.deepEqual(choice, { sessionFile: null, clearedBinding: true });
});

test("a bound file missing from the session list is self-healed", () => {
  // existsSync 为真但 listAll 解析不出（损坏/非会话文件）——不得交给 SDK 打开。
  const agent = makeAgent("unlisted");
  setAgentSessionFile(agent.id, path.join(SHARED, "ghost.jsonl"));
  const bound = getAgent(agent.id);
  const choice = chooseSessionFileForStart({
    member: bound,
    cwd: bound.workspace_path,
    boundFileExists: true,
    boundFileCwd: null,
    referencedByOthers: new Set(),
    isOwnHome: true,
    latestUnreferenced: null,
  });
  assert.deepEqual(choice, { sessionFile: null, clearedBinding: true });
});

test("a lost binding file in a shared dir starts fresh without clearing (fixate overwrites later)", () => {
  const agent = bindWorkspace(makeAgent("lost-file"), SHARED);
  setAgentSessionFile(agent.id, path.join(SHARED, "gone.jsonl"));
  const bound = getAgent(agent.id);
  const choice = chooseSessionFileForStart({
    member: bound,
    cwd: SHARED,
    boundFileExists: false,
    boundFileCwd: null,
    referencedByOthers: new Set(),
    isOwnHome: false,
    latestUnreferenced: null,
  });
  assert.deepEqual(choice, { sessionFile: null, clearedBinding: false });
});

test("ticket10: a soft-deleted member's registration still gates a sharing member's reuse (A binds F, A deleted, B binds F)", () => {
  // 复现（08 的 startSession 侧残留路径）：A 固化会话文件 F（登记 = ADR-0003 所有权凭证），
  // A 软删（行保留、pi_session_file 不清）；B 的绑定残留指向 F（03 修复前粘性继承脏数据）。
  // 引用集 = 全量成员（含软删）排除本成员自己的登记 → A 的登记计入门禁 →
  // B 的归属校验拒绝复用（清绑 + 新建空会话），不继承 A 上下文。
  const dir = fs.mkdtempSync(path.join(root, "ticket10-"));
  const a = bindWorkspace(makeAgent("ticket10-a"), dir);
  const b = bindWorkspace(makeAgent("ticket10-b"), dir);
  const fileF = path.join(dir, "a-session.jsonl");
  setAgentSessionFile(a.id, fileF); // A 固化 F
  assert.equal(
    referencedSessionFiles(b.id).has(fileF),
    true,
    "A 存活时其登记同样计入门禁（排除的是 B 自己的登记，不是路径）",
  );
  deleteAgent(a.id); // 软删：行保留、pi_session_file 不清
  setAgentSessionFile(b.id, fileF); // B 的残留绑定指向同一文件

  // startSession 的归属裁决：引用集含 A 的软删登记 → 拒绝复用 F
  const referencedByOthers = referencedSessionFiles(b.id);
  assert.equal(referencedByOthers.has(fileF), true, "A 的软删登记必须仍计入门禁");
  const choice = chooseSessionFileForStart({
    member: getAgent(b.id),
    cwd: dir,
    boundFileExists: true,
    boundFileCwd: dir,
    referencedByOthers,
    isOwnHome: false,
    latestUnreferenced: null,
  });
  assert.deepEqual(choice, { sessionFile: null, clearedBinding: true });
});

// ---------------------------------------------------------------------------
// isOwnHomeDir：家目录判定
// ---------------------------------------------------------------------------

test("the default workspace is the agent's own home", () => {
  const agent = makeAgent("home-owner");
  assert.equal(isOwnHomeDir(agent, agent.workspace_path), true);
});

test("a bound project directory is not the home, but the derived home still is", () => {
  const agent = bindWorkspace(makeAgent("project-bound"), SHARED);
  assert.equal(isOwnHomeDir(agent, SHARED), false);
  assert.equal(isOwnHomeDir(agent, agentHomePath(agent)), true);
});

// ---------------------------------------------------------------------------
// withCwdStartLock：per-cwd 启动互斥（02-决策二）
// ---------------------------------------------------------------------------

test("withCwdStartLock serializes concurrent starts on the same cwd", async () => {
  const events = [];
  const first = withCwdStartLock(SHARED, async () => {
    events.push("first-start");
    await new Promise((resolve) => setTimeout(resolve, 20));
    events.push("first-end");
  });
  const second = withCwdStartLock(SHARED, async () => {
    events.push("second-start");
    events.push("second-end");
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
});

test("withCwdStartLock does not block different cwds", async () => {
  const other = path.join(root, "other-project");
  const events = [];
  await Promise.all([
    withCwdStartLock(SHARED, async () => events.push("shared")),
    withCwdStartLock(other, async () => events.push("other")),
  ]);
  assert.deepEqual(events.sort(), ["other", "shared"]);
});

test("withCwdStartLock chains despite a failed holder", async () => {
  const first = withCwdStartLock(SHARED, async () => {
    throw new Error("boom");
  });
  const second = withCwdStartLock(SHARED, async () => "ok");
  await assert.rejects(first, /boom/);
  assert.equal(await second, "ok");
});
