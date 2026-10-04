// 数据目录复制/搬迁后的家目录写路径回归（B 票）：
// 「家目录」语义 = <当前 dataDir>/agents/<slug>-<id 前 8 位>（ADR-0001）。家目录派生的绑定
// 必须按**当前**数据目录重推，不得照抄存库的绝对路径——否则在副本上跑一遍写入（备份还原、
// 副本演练、多环境）会静默改写原数据目录里的家目录文件。
//
// 两个方向都要断言：
//   - 家目录派生绑定（未显式绑定 / 历史遗留的绝对家目录值）→ 写在当前数据目录；
//   - 显式项目目录绑定（数据目录之外的目录）→ 照旧写在该目录（不回归）。
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { agentHomeDir, MEMORY_FILE_NAME } from "../../data/dirs.ts";

const tmpRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "worksplice-datadir-move-"),
);
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const { initSecretaryFlow, secretaryManualDir, SECRETARY_GUIDE_FILE_NAME } =
  await import("./secretary-init.ts");
const { createAgent, getAgent } = await import("./members.ts");
const { SUSAN_MEMBER_NAME } = await import("./event-messages.ts");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(tmpRoot, prefix));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 目录全量快照：目录记 mtime，文件记 mtime（纳秒）+ 大小 + 内容哈希——任一不同即"被写过"。 */
function snapshot(dir) {
  const out = new Map();
  const walk = (current) => {
    const stat = fs.statSync(current, { bigint: true });
    const key = path.relative(dir, current) || ".";
    out.set(
      key,
      stat.isDirectory()
        ? `dir mtime=${stat.mtimeNs}`
        : `file mtime=${stat.mtimeNs} size=${stat.size} sha256=${sha256(current)}`,
    );
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
    }
  };
  walk(dir);
  return out;
}

/** 两次快照的差异（可读失败信息：列出被写的路径，而不是打印整个 Map）。 */
function snapshotDiff(before, after) {
  const changed = [];
  for (const [key, value] of before) {
    if (!after.has(key)) changed.push(`${key}（被删）`);
    else if (after.get(key) !== value) changed.push(`${key}（被改写）`);
  }
  for (const key of after.keys()) {
    if (!before.has(key)) changed.push(`${key}（新增）`);
  }
  return changed;
}

/** 复制数据目录 A → B（跳过 SQLite 的 -shm：临时共享内存文件随打开重建，复制它没有意义）。 */
function copyDataDir(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => !source.endsWith("-shm"),
  });
  return to;
}

/**
 * 造出「A 上建了秘书 → 复制成 B」的场景：
 * 秘书家目录里的 MEMORY.md 先被改成标记内容（模拟 A 里被就地编辑过的长期记忆），
 * 这样任何"在 B 上跑写入却回流 A"的实现都会改掉 A 的字节，而不只是 mtime。
 */
function setupCopiedDataDir() {
  const dataDirA = tempDir("data-a-");
  const storeA = openDataDb(dataDirA);
  globalThis.__workspliceDb = storeA;
  const susan = initSecretaryFlow();
  const homeA = agentHomeDir(dataDirA, susan.id, susan.name);
  assert.equal(fs.existsSync(homeA), true, "家目录应在家目录派生的位置建出");
  const marker = "# susan\n\nA 目录里被就地编辑过的长期记忆（副本写入不得触碰它）\n";
  fs.writeFileSync(path.join(homeA, MEMORY_FILE_NAME), marker, "utf8");
  storeA.close();

  const beforeA = snapshot(dataDirA);
  const dataDirB = copyDataDir(dataDirA, path.join(tmpRoot, `data-b-${Date.now()}`));
  globalThis.__workspliceDb = openDataDb(dataDirB);
  return { dataDirA, dataDirB, susan, homeA, marker, beforeA };
}

test.after(() => {
  globalThis.__workspliceDb?.close();
});

// ---------------------------------------------------------------------------
// 主回归：副本上的写入不得回流原数据目录
// ---------------------------------------------------------------------------

test("数据目录复制后，家目录写入落在副本，原数据目录一个文件都不被写", () => {
  const { dataDirA, dataDirB, susan, marker, beforeA } = setupCopiedDataDir();

  // 在副本上跑同一写入路径（initSecretaryFlow ② 手册重写 = 家目录写路径）
  const again = initSecretaryFlow();
  assert.equal(again.id, susan.id, "副本里的秘书身份应被复用，不重建");

  const changed = snapshotDiff(beforeA, snapshot(dataDirA));
  assert.deepEqual(
    changed,
    [],
    `原数据目录不得被写，实际被动过：${changed.join(", ")}`,
  );

  const homeB = agentHomeDir(dataDirB, susan.id, susan.name);
  const manualDir = secretaryManualDir();
  assert.equal(
    fs.readFileSync(path.join(homeB, MEMORY_FILE_NAME), "utf8"),
    fs.readFileSync(path.join(manualDir, MEMORY_FILE_NAME), "utf8"),
    "副本的家目录 MEMORY.md 应被写成手册内容",
  );
  assert.equal(
    fs.readFileSync(path.join(homeB, SECRETARY_GUIDE_FILE_NAME), "utf8"),
    fs.readFileSync(path.join(manualDir, SECRETARY_GUIDE_FILE_NAME), "utf8"),
    "副本的家目录 SYSTEM-GUIDE.md 应被写出",
  );
  assert.equal(
    fs.readFileSync(path.join(agentHomeDir(dataDirA, susan.id, susan.name), MEMORY_FILE_NAME), "utf8"),
    marker,
    "原数据目录里的标记内容必须原样保留",
  );
});

test("未显式绑定的 agent：不落库绝对家目录，读取侧按当前数据目录重推", () => {
  const { dataDirB, susan } = setupCopiedDataDir();

  const stored = globalThis.__workspliceDb.db
    .prepare("SELECT workspace_path FROM members WHERE id = ?")
    .get(susan.id).workspace_path;
  assert.equal(stored, null, "家目录派生的绑定不落库绝对路径（NULL = 未显式绑定）");
  assert.equal(
    getAgent(susan.id).workspace_path,
    agentHomeDir(dataDirB, susan.id, susan.name),
    "读取侧按当前数据目录重推家目录",
  );
});

test("存量绝对家目录值（含历史数据目录）：读取侧同样按当前数据目录重推", () => {
  const { dataDirA, dataDirB, susan, beforeA } = setupCopiedDataDir();
  const homeA = agentHomeDir(dataDirA, susan.id, susan.name);
  // 模拟存量行：家目录绝对路径已经落库（老实现创建时的写法）
  globalThis.__workspliceDb.db
    .prepare("UPDATE members SET workspace_path = ? WHERE id = ?")
    .run(homeA, susan.id);
  assert.equal(
    getAgent(susan.id).workspace_path,
    agentHomeDir(dataDirB, susan.id, susan.name),
    "存量绝对家目录值也要按当前数据目录重推，而不是照抄",
  );

  initSecretaryFlow();
  const changed = snapshotDiff(beforeA, snapshot(dataDirA));
  assert.deepEqual(changed, [], `原数据目录不得被写，实际被动过：${changed.join(", ")}`);
  assert.equal(
    fs.existsSync(path.join(agentHomeDir(dataDirB, susan.id, susan.name), SECRETARY_GUIDE_FILE_NAME)),
    true,
    "手册应写进副本的家目录",
  );
});

test("看起来像家目录但不是本 agent 的路径：不重推（不误伤项目目录）", () => {
  const { dataDirB, susan } = setupCopiedDataDir();
  const otherHome = path.join(dataDirB, "agents", `someone-${"0".repeat(8)}`);
  globalThis.__workspliceDb.db
    .prepare("UPDATE members SET workspace_path = ? WHERE id = ?")
    .run(otherHome, susan.id);
  assert.equal(
    getAgent(susan.id).workspace_path,
    otherHome,
    "家目录派生的判据带 agent 自己的 id 前 8 位，他人家目录形态的路径视为显式绑定",
  );
});

test("父目录不是 agents 的路径：不重推（id 后缀巧合不足以判定）", () => {
  const { dataDirB, susan } = setupCopiedDataDir();
  const projectDir = path.join(dataDirB, "projects", `susan-${susan.id.slice(0, 8)}`);
  globalThis.__workspliceDb.db
    .prepare("UPDATE members SET workspace_path = ? WHERE id = ?")
    .run(projectDir, susan.id);
  assert.equal(
    getAgent(susan.id).workspace_path,
    projectDir,
    "只有 <任意数据目录>/agents/<slug>-<id8> 形态才算家目录派生",
  );
});

test("副本上删除身份：只删副本的家目录，原数据目录一个文件都不动", async () => {
  const { dataDirA, dataDirB, susan, homeA, marker, beforeA } = setupCopiedDataDir();
  const homeB = agentHomeDir(dataDirB, susan.id, susan.name);
  assert.equal(fs.existsSync(homeB), true, "副本里复制过来的家目录应该在");

  const { deleteAgentIdentity } = await import("../../agent-lifecycle.ts");
  await deleteAgentIdentity(susan.id, {
    findSession: () => undefined,
    async startSession() {
      throw new Error("not used");
    },
    async destroySession() {},
    async removeSessionFilesForCwd() {},
  });

  assert.equal(fs.existsSync(homeB), false, "副本的家目录随身份删除");
  assert.equal(fs.existsSync(homeA), true, "原数据目录的家目录不得被删");
  const changed = snapshotDiff(beforeA, snapshot(dataDirA));
  assert.deepEqual(changed, [], `原数据目录不得被写，实际被动过：${changed.join(", ")}`);
  assert.equal(
    fs.readFileSync(path.join(homeA, MEMORY_FILE_NAME), "utf8"),
    marker,
    "原数据目录里的标记内容必须原样保留",
  );
});

// ---------------------------------------------------------------------------
// 反例：显式项目目录绑定必须继续被尊重
// ---------------------------------------------------------------------------

test("显式项目目录绑定：手册仍写在绑定的项目目录里", () => {
  const dataDir = tempDir("data-explicit-");
  const projectDir = tempDir("project-");
  globalThis.__workspliceDb = openDataDb(dataDir);
  const susan = createAgent({
    name: SUSAN_MEMBER_NAME,
    workspacePath: projectDir,
  });
  initSecretaryFlow();

  const manualDir = secretaryManualDir();
  assert.equal(
    fs.readFileSync(path.join(projectDir, MEMORY_FILE_NAME), "utf8"),
    fs.readFileSync(path.join(manualDir, MEMORY_FILE_NAME), "utf8"),
    "显式绑定的项目目录仍是要写入的工作区",
  );
  assert.equal(
    fs.readFileSync(path.join(projectDir, SECRETARY_GUIDE_FILE_NAME), "utf8"),
    fs.readFileSync(path.join(manualDir, SECRETARY_GUIDE_FILE_NAME), "utf8"),
  );
  assert.equal(
    getAgent(susan.id).workspace_path,
    projectDir,
    "显式绑定原样返回，不被家目录重推覆盖",
  );
  globalThis.__workspliceDb.close();
});

test("显式项目目录绑定：数据目录复制后仍写在项目目录，家目录形态路径才重推", () => {
  const dataDirA = tempDir("data-explicit-move-");
  const projectDir = tempDir("project-shared-");
  const storeA = openDataDb(dataDirA);
  globalThis.__workspliceDb = storeA;
  const susan = createAgent({
    name: SUSAN_MEMBER_NAME,
    workspacePath: projectDir,
  });
  initSecretaryFlow();
  // A 里秘书家目录的副本（好让它看起来"像"被复制过）
  const homeA = agentHomeDir(dataDirA, susan.id, susan.name);
  fs.mkdirSync(homeA, { recursive: true });
  storeA.close();

  const dataDirB = copyDataDir(dataDirA, path.join(tmpRoot, `data-explicit-b-${Date.now()}`));
  globalThis.__workspliceDb = openDataDb(dataDirB);
  assert.equal(
    getAgent(susan.id).workspace_path,
    projectDir,
    "项目目录绑定跨数据目录复制仍原样尊重",
  );
  initSecretaryFlow();
  assert.equal(
    fs.readFileSync(path.join(projectDir, MEMORY_FILE_NAME), "utf8"),
    fs.readFileSync(path.join(secretaryManualDir(), MEMORY_FILE_NAME), "utf8"),
    "副本上的写入仍落在显式绑定的项目目录",
  );
});
