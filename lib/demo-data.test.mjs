// 演示模式的数据准备（bin/demo-data.js；与 lib/worksplice-options.test.mjs 同惯例：bin 的测试放 lib/）：复制预置演示库 + 把原机器路径重写到本机。
//
// 这条缝以前不存在，所以它没有回归网；`--demo` 一旦坏了，坏在「陌生人第一次运行」那条路上，
// 而那条路我们自己不走——所以用真实的 SQLite 夹具把它钉住，而不是断言源码文本。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { prepareDemoDataDir, resolveDemoDataDir, rewriteAgentPaths } = require("../bin/demo-data.js");

const BUILD_MACHINE_DIR = "/build-machine/.worksplice";

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-demo-"));
  const pkgDir = path.join(root, "pkg");
  fs.mkdirSync(path.join(pkgDir, "demo"), { recursive: true });
  const db = new Database(path.join(pkgDir, "demo", "raft.db"));
  db.exec(`CREATE TABLE members (
    id TEXT PRIMARY KEY,
    type TEXT,
    name TEXT,
    description TEXT,
    role TEXT,
    workspace_path TEXT,
    pi_session_file TEXT,
    status TEXT,
    deleted INTEGER,
    model_provider TEXT,
    model_id TEXT,
    thinking_level TEXT,
    created_at TEXT
  )`);
  const insert = db.prepare(
    "INSERT INTO members (id, type, name, workspace_path, pi_session_file, status, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(
    "agent-1",
    "agent",
    "Iris",
    `${BUILD_MACHINE_DIR}/agents/iris-12345678`,
    "/build-machine/.pi/agent/sessions/x/one.jsonl",
    "offline",
    0,
  );
  insert.run("owner", "human", "Owner", null, null, "online", 0);
  db.close();
  return { root, pkgDir };
}

test("resolveDemoDataDir 认 WORKSPLICE_DEMO_DIR，否则回落到 ~/.worksplice-demo", () => {
  assert.equal(resolveDemoDataDir({ WORKSPLICE_DEMO_DIR: "/tmp/custom-demo" }), "/tmp/custom-demo");
  assert.equal(
    resolveDemoDataDir({}),
    path.join(os.homedir(), ".worksplice-demo"),
    "默认目录必须是家目录下的 .worksplice-demo，不能是真实的 ~/.worksplice",
  );
});

test("prepareDemoDataDir 复制演示库并把原机器路径重写到本机", () => {
  const { root, pkgDir } = makeFixture();
  const dataDir = path.join(root, "demo-data");

  const prepared = prepareDemoDataDir({ pkgDir, dataDir });
  assert.equal(prepared.created, true);
  assert.equal(prepared.dbFile, path.join(dataDir, "raft.db"));
  assert.ok(fs.existsSync(prepared.dbFile), "演示库应被复制到目标目录");

  const db = new Database(prepared.dbFile, { readonly: true });
  const agent = db.prepare("SELECT workspace_path, pi_session_file FROM members WHERE id = 'agent-1'").get();
  const owner = db.prepare("SELECT workspace_path FROM members WHERE id = 'owner'").get();
  db.close();

  assert.equal(
    agent.workspace_path,
    path.join(dataDir, "agents", "iris-12345678"),
    "agent 家目录应重写到本机演示目录下",
  );
  assert.equal(agent.pi_session_file, null, "打包机上的会话文件引用必须清空");
  assert.equal(owner.workspace_path, null, "人类成员没有 workspace，不该被改写");
  assert.ok(
    fs.existsSync(path.join(dataDir, "agents", "iris-12345678")),
    "重写后的家目录要真的建出来，免得界面显示不存在的路径",
  );
});

test("prepareDemoDataDir 幂等：已有演示库时不覆盖（用户在演示里发过消息也不该被抹掉）", () => {
  const { root, pkgDir } = makeFixture();
  const dataDir = path.join(root, "demo-data");
  prepareDemoDataDir({ pkgDir, dataDir });

  const db = new Database(path.join(dataDir, "raft.db"));
  db.prepare("INSERT INTO members (id, type, name, status, deleted) VALUES ('mine', 'agent', 'Mine', 'offline', 0)").run();
  db.close();

  const again = prepareDemoDataDir({ pkgDir, dataDir });
  assert.equal(again.created, false);

  const check = new Database(path.join(dataDir, "raft.db"), { readonly: true });
  const mine = check.prepare("SELECT name FROM members WHERE id = 'mine'").get();
  check.close();
  assert.equal(mine.name, "Mine", "第二次调用不能覆盖用户已有的演示状态");
});

test("prepareDemoDataDir 在缺少预置演示库时明确报错（而不是悄悄起一个空库）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-demo-missing-"));
  const pkgDir = path.join(root, "pkg");
  fs.mkdirSync(pkgDir, { recursive: true });
  assert.throws(
    () => prepareDemoDataDir({ pkgDir, dataDir: path.join(root, "demo-data") }),
    /Demo database not found/,
  );
});

test("rewriteAgentPaths 只碰 workspace_path 里带 agents 的行", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-demo-rewrite-"));
  const dbFile = path.join(root, "raft.db");
  const db = new Database(dbFile);
  db.exec("CREATE TABLE members (id TEXT PRIMARY KEY, workspace_path TEXT, pi_session_file TEXT)");
  db.prepare("INSERT INTO members VALUES ('a', ?, ?)").run(
    `${BUILD_MACHINE_DIR}/agents/iris-12345678`,
    "/build-machine/session.jsonl",
  );
  db.prepare("INSERT INTO members VALUES ('b', ?, ?)").run("/Users/someone/their-own-project", null);
  db.close();

  const dirs = rewriteAgentPaths(dbFile, "/tmp/local-demo");
  assert.deepEqual(dirs, [path.join("/tmp/local-demo", "agents", "iris-12345678")]);

  const check = new Database(dbFile, { readonly: true });
  const b = check.prepare("SELECT workspace_path FROM members WHERE id = 'b'").get();
  check.close();
  assert.equal(b.workspace_path, "/Users/someone/their-own-project", "非 agents 路径不得被改写");
});
