import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 存量内容英文化显式迁移脚本（scripts/migrate-i18n-content.mjs）的行为测试。
 *
 * 测试在 CLI 接缝上做（子进程 + 临时数据目录）：脚本的公共面就是命令行——
 * 参数 → 退出码 / stdout / 落盘效果（频道名与 MEMORY.md 字节）。断言只碰
 * 「存量样子」与「迁移后样子」，不碰脚本内部结构。
 *
 * 存量样子取自 PR #81（docs/i18n.md forward-only）之前的产线事实：
 * 旧频道名「秘书办公室」、旧 MEMORY 大纲节名（见下方 LEGACY_TEMPLATE 字面量）。
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(repoRoot, "scripts", "migrate-i18n-content.mjs");

const LEGACY_OFFICE_NAME = "秘书办公室";
const CURRENT_OFFICE_NAME = "secretary-office";

/** 旧中文描述（PR #81 之前的产线事实，逐字取自 Owner live 数据）。 */
const LEGACY_OFFICE_DESCRIPTION = "秘书的 1:1 沟通场所";
const LEGACY_SECRETARY_DESCRIPTION =
  "worksplice 的秘书：自动加入全部频道，熟悉系统手册，可代办频道/成员创建与查询，越权操作引导 Owner UI";

/** 自定义描述（用户在 UI 里自己写的）：迁移不得触碰。 */
const CUSTOM_CHANNEL_DESCRIPTION = "我的自定义频道描述（别动）";
const CUSTOM_MEMBER_DESCRIPTION = "值守工程师的自定义描述（别动）";

/** 旧大纲（PR #81 之前的 buildMemoryTemplate 产物，逐字取自当时实现）。 */
function legacyMemory(name, role) {
  return `# ${name}\n\n## 角色描述\n\n${role}\n\n## 当前工作\n\n## 工作流程\n\n## Skill 使用\n\n## 工具使用\n\n## 其他\n`;
}

const { openDataDb } = await import("../../data/sqlite.ts");
const { buildMemoryTemplate } = await import("../../data/dirs.ts");
const { BUILTIN_CHANNEL_ID } = await import("../../data/schema.ts");
const { LEGACY_MEMORY_SECTIONS } = await import("../../../scripts/migrate-i18n-content.mjs");
const { OFFICE_CHANNEL_NAME, LEGACY_OFFICE_CHANNEL_NAMES, OFFICE_CHANNEL_DESCRIPTION, SUSAN_DESCRIPTION } =
  await import("./secretary-init.ts");

const tmpDirs = new Set();

test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix = "worksplice-i18n-migrate-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.add(dir);
  return dir;
}

/** 造一份「存量样子」的数据目录：旧频道名 + 旧节名 MEMORY.md（家目录按数据层事实命名）。 */
function makeLegacyFixture({ withAgent = true, agentDeleted = false } = {}) {
  const dataDir = tmpDir();
  const db = openDataDb(dataDir);
  const channel = db.insertChannel({
    name: LEGACY_OFFICE_NAME,
    type: "private",
    description: "legacy office",
  });
  let home = null;
  let memoryPath = null;
  if (withAgent) {
    const member = db.insertMember({
      type: "agent",
      name: "susan",
      description: "secretary",
      workspacePath: null,
      modelProvider: "test-provider",
      modelId: "test-model",
      thinkingLevel: "low",
    });
    if (agentDeleted) db.setMemberDeleted(member.id, 1);
    home = path.join(dataDir, "agents", `susan-${member.id.slice(0, 8)}`);
    fs.mkdirSync(home, { recursive: true });
    memoryPath = path.join(home, "MEMORY.md");
    fs.writeFileSync(memoryPath, legacyMemory("susan", "secretary"), "utf8");
  }
  db.close();
  return { dataDir, channel, home, memoryPath };
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function backupsIn(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith("MEMORY.md.bak-"))
    .sort();
}

function channelNames(dataDir) {
  const db = openDataDb(dataDir);
  const rows = db
    .listChannels()
    .filter((row) => row.id !== BUILTIN_CHANNEL_ID)
    .map((row) => ({ id: row.id, name: row.name }));
  db.close();
  return rows;
}

function channelRows(dataDir) {
  const db = openDataDb(dataDir);
  const rows = db
    .listChannels()
    .filter((row) => row.id !== BUILTIN_CHANNEL_ID)
    .map((row) => ({ id: row.id, name: row.name, description: row.description }));
  db.close();
  return rows;
}

function agentRows(dataDir) {
  const db = openDataDb(dataDir);
  const rows = db
    .listMembers()
    .filter((row) => row.type === "agent")
    .map((row) => ({ id: row.id, name: row.name, description: row.description }));
  db.close();
  return rows;
}

function descriptionOf(rows, id) {
  return rows.find((row) => row.id === id)?.description;
}

/**
 * 造一份「存量描述」的数据目录：办公室频道与秘书都是旧中文描述，
 * 另有一个自定义描述的频道（「我的办公室」）与一个自定义描述的 agent。
 */
function makeDescriptionFixture({ officeName = LEGACY_OFFICE_NAME, withMemory = false } = {}) {
  const dataDir = tmpDir();
  const db = openDataDb(dataDir);
  const office = db.insertChannel({
    name: officeName,
    type: "private",
    description: LEGACY_OFFICE_DESCRIPTION,
  });
  const custom = db.insertChannel({
    name: "我的办公室",
    type: "public",
    description: CUSTOM_CHANNEL_DESCRIPTION,
  });
  const susan = db.insertMember({
    type: "agent",
    name: "Susan",
    description: LEGACY_SECRETARY_DESCRIPTION,
  });
  const other = db.insertMember({
    type: "agent",
    name: "Marlow",
    description: CUSTOM_MEMBER_DESCRIPTION,
  });
  let memoryPath = null;
  if (withMemory) {
    const home = path.join(dataDir, "agents", `susan-${susan.id.slice(0, 8)}`);
    fs.mkdirSync(home, { recursive: true });
    memoryPath = path.join(home, "MEMORY.md");
    fs.writeFileSync(memoryPath, legacyMemory("susan", "secretary"), "utf8");
  }
  db.close();
  return { dataDir, office, custom, susan, other, memoryPath };
}

/** 正文 = 非节名行；迁移只许动节名行。 */
function bodyLines(text) {
  return text.split("\n").filter((line) => !line.startsWith("## "));
}

test("dry-run 计划不改任何字节：频道名与 MEMORY.md 都不动", () => {
  const { dataDir, channel, memoryPath } = makeLegacyFixture();
  const before = sha256(memoryPath);
  const mtimeBefore = fs.statSync(memoryPath).mtimeMs;

  const result = run(["--data-dir", dataDir]);
  assert.equal(result.status, 0, result.stderr);

  assert.deepEqual(
    channelNames(dataDir),
    [{ id: channel.id, name: LEGACY_OFFICE_NAME }],
    "dry-run 不得改频道名",
  );
  assert.equal(sha256(memoryPath), before, "dry-run 不得改 MEMORY.md 字节");
  assert.equal(fs.statSync(memoryPath).mtimeMs, mtimeBefore, "dry-run 不得触碰文件");
  assert.deepEqual(backupsIn(path.dirname(memoryPath)), [], "dry-run 不得建备份");
});

test("显式 --dry-run 与默认形态一致，且绝不碰默认数据目录", () => {
  const { dataDir, memoryPath } = makeLegacyFixture();
  const before = sha256(memoryPath);
  // HOME 指向岸头目录：脚本或其 import 若去开默认目录，就会在那里留下 ~/.worksplice
  const fakeHome = tmpDir("worksplice-i18n-fakehome-");
  const env = { HOME: fakeHome, WORKSPLICE_DATA_DIR: "" };

  const explicit = run(["--data-dir", dataDir, "--dry-run"], env);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(explicit.stdout, /dry-run: 2 changes/);
  assert.match(explicit.stdout, /未写入/);

  assert.equal(run(["--help"], env).status, 0);
  assert.match(run(["--help"], env).stdout, /用法/);

  const applied = run(["--data-dir", dataDir, "--apply"], env);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(sha256(memoryPath) === before, false, "apply 应改到目标目录的文件");
  assert.equal(
    fs.existsSync(path.join(fakeHome, ".worksplice")),
    false,
    "给了 --data-dir 就不得再开默认数据目录（HOME 被打岸也一样）",
  );
});

test("--apply 迁移存量：频道改名，MEMORY.md 只换节名行、正文逐字节不变", () => {
  const { dataDir, channel, memoryPath } = makeLegacyFixture();
  const before = fs.readFileSync(memoryPath, "utf8");

  const result = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(result.status, 0, result.stderr);

  assert.deepEqual(channelNames(dataDir), [{ id: channel.id, name: CURRENT_OFFICE_NAME }]);
  assert.equal(CURRENT_OFFICE_NAME, OFFICE_CHANNEL_NAME);
  assert.equal(LEGACY_OFFICE_CHANNEL_NAMES.includes(CURRENT_OFFICE_NAME), false);

  const after = fs.readFileSync(memoryPath, "utf8");
  // 期望值来自当前模板（独立事实来源）：迁移后应与新模板逐字节一致
  assert.equal(after, buildMemoryTemplate("susan", "secretary"));
  assert.equal(
    JSON.stringify(bodyLines(after)),
    JSON.stringify(bodyLines(before)),
    "正文行必须逐字节保持不变",
  );

  // 映射的英文侧必须仍是当前大纲的节名与顺序（模板改了而映射没跟 → 这里先红）
  const templateHeadings = buildMemoryTemplate("x", "y")
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3));
  const mappedHeadings = Object.values(LEGACY_MEMORY_SECTIONS);
  assert.deepEqual(
    mappedHeadings.filter((heading) => templateHeadings.includes(heading)),
    templateHeadings,
    "迁移目标节名必须与 buildMemoryTemplate 的大纲一致、同序（改了模板就同步改映射）",
  );
});

test("--apply 幂等：第二遍 0 changes，且不新增备份", () => {
  const { dataDir, memoryPath } = makeLegacyFixture();
  assert.equal(run(["--data-dir", dataDir, "--apply"]).status, 0);
  const afterFirst = sha256(memoryPath);
  const backupsAfterFirst = backupsIn(path.dirname(memoryPath));
  assert.equal(backupsAfterFirst.length, 1);

  const second = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /0 changes/);
  assert.equal(sha256(memoryPath), afterFirst);
  assert.deepEqual(backupsIn(path.dirname(memoryPath)), backupsAfterFirst);

  const third = run(["--data-dir", dataDir, "--apply", "--json"]);
  assert.equal(third.status, 0, third.stderr);
  const payload = JSON.parse(third.stdout);
  assert.equal(payload.mode, "apply");
  assert.equal(payload.changes, 0);
  assert.deepEqual(payload.channels.renamed, []);
  assert.deepEqual(payload.memoryFiles.updated, []);
  assert.deepEqual(backupsIn(path.dirname(memoryPath)), backupsAfterFirst);
});

test("冲突安全：目标频道名已存在 → 不改名、打印 skip (target exists)、退出码 0", () => {
  const { dataDir, channel } = makeLegacyFixture();
  const db = openDataDb(dataDir);
  const existing = db.insertChannel({
    name: CURRENT_OFFICE_NAME,
    type: "private",
    description: "already migrated",
  });
  db.close();

  const result = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skip \(target exists\)/);

  assert.deepEqual(
    channelNames(dataDir),
    [
      { id: channel.id, name: LEGACY_OFFICE_NAME },
      { id: existing.id, name: CURRENT_OFFICE_NAME },
    ],
    "目标名被占用时保持现状，不制造重名",
  );
});

test("备份策略：首次改动建 .bak-*，已存在备份则不建第二个、不覆盖既有备份", () => {
  const first = makeLegacyFixture();
  const original = fs.readFileSync(first.memoryPath, "utf8");
  assert.equal(run(["--data-dir", first.dataDir, "--apply"]).status, 0);

  const backups = backupsIn(first.home);
  assert.equal(backups.length, 1, "首次改动创建一个 .bak-*");
  assert.equal(
    fs.readFileSync(path.join(first.home, backups[0]), "utf8"),
    original,
    "备份内容 = 迁移前的原始字节",
  );

  // 第二个 fixture：预置一份旧备份（哨兵内容），再迁移
  const second = makeLegacyFixture();
  const sentinel = path.join(second.home, "MEMORY.md.bak-20200101-000000");
  fs.writeFileSync(sentinel, "SENTINEL", "utf8");

  assert.equal(run(["--data-dir", second.dataDir, "--apply"]).status, 0);
  assert.deepEqual(backupsIn(second.home), ["MEMORY.md.bak-20200101-000000"]);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "SENTINEL", "既有备份不得被覆盖");
  assert.doesNotMatch(
    fs.readFileSync(second.memoryPath, "utf8"),
    /角色描述|当前工作/,
    "备份不是拒绝迁移的理由：节名仍然照改",
  );
});

test("已英文的文件被跳过：不重写、不改 mtime", () => {
  const dataDir = tmpDir();
  const home = path.join(dataDir, "agents", "bob-11112222");
  fs.mkdirSync(home, { recursive: true });
  const memoryPath = path.join(home, "MEMORY.md");
  const english = buildMemoryTemplate("bob", "helper");
  fs.writeFileSync(memoryPath, english, "utf8");
  const db = openDataDb(dataDir);
  db.close();
  const mtimeBefore = fs.statSync(memoryPath).mtimeMs;

  const result = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(memoryPath, "utf8"), english);
  assert.equal(fs.statSync(memoryPath).mtimeMs, mtimeBefore, "英文文件不该被写");
  assert.deepEqual(backupsIn(home), [], "没改动就不该有备份");
  assert.match(result.stdout, /0 changes/);
});

test("软删 agent 的家目录同样被迁移", () => {
  const { dataDir, memoryPath } = makeLegacyFixture({ agentDeleted: true });
  const result = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(fs.readFileSync(memoryPath, "utf8"), /角色描述|工具使用/);
  assert.match(fs.readFileSync(memoryPath, "utf8"), /^## (Role|Current work|Workflow|Skills|Tools|Other)$/m);
  assert.equal(backupsIn(path.dirname(memoryPath)).length, 1);
});

test("旧中文描述（频道 + 秘书）迁移成英文值，自定义描述一个字不动", () => {
  const { dataDir, office, custom, susan, other } = makeDescriptionFixture();

  const result = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(result.status, 0, result.stderr);

  const channels = channelRows(dataDir);
  assert.equal(descriptionOf(channels, office.id), OFFICE_CHANNEL_DESCRIPTION);
  assert.equal(descriptionOf(channels, custom.id), CUSTOM_CHANNEL_DESCRIPTION);

  const agents = agentRows(dataDir);
  assert.equal(descriptionOf(agents, susan.id), SUSAN_DESCRIPTION);
  assert.equal(descriptionOf(agents, other.id), CUSTOM_MEMBER_DESCRIPTION);

  assert.ok(result.stdout.includes("频道描述：「"), result.stdout);
  assert.ok(result.stdout.includes("成员描述：「Susan」"), result.stdout);
  assert.match(result.stdout, /skip \(custom description\)/);
});

test("dry-run 描述零写入：计划逐条打印旧值→新值，DB 里一个字不动", () => {
  // 上一票已改过名的存量状态：频道名已英文、描述仍是中文
  const { dataDir, office, custom, susan, other } = makeDescriptionFixture({
    officeName: CURRENT_OFFICE_NAME,
  });

  const result = run(["--data-dir", dataDir]);
  assert.equal(result.status, 0, result.stderr);

  assert.ok(result.stdout.includes(LEGACY_OFFICE_DESCRIPTION), result.stdout);
  assert.ok(result.stdout.includes(OFFICE_CHANNEL_DESCRIPTION), result.stdout);
  assert.ok(result.stdout.includes(LEGACY_SECRETARY_DESCRIPTION), result.stdout);
  assert.ok(result.stdout.includes(SUSAN_DESCRIPTION), result.stdout);
  assert.match(result.stdout, /dry-run: 2 changes/);
  assert.match(result.stdout, /skip \(custom description\)/);

  assert.equal(descriptionOf(channelRows(dataDir), office.id), LEGACY_OFFICE_DESCRIPTION);
  assert.equal(descriptionOf(channelRows(dataDir), custom.id), CUSTOM_CHANNEL_DESCRIPTION);
  assert.equal(descriptionOf(agentRows(dataDir), susan.id), LEGACY_SECRETARY_DESCRIPTION);
  assert.equal(descriptionOf(agentRows(dataDir), other.id), CUSTOM_MEMBER_DESCRIPTION);
});

test("描述迁移幂等：第二遍 0 changes", () => {
  const { dataDir, office, susan } = makeDescriptionFixture();
  assert.equal(run(["--data-dir", dataDir, "--apply"]).status, 0);

  const second = run(["--data-dir", dataDir, "--apply", "--json"]);
  assert.equal(second.status, 0, second.stderr);
  const payload = JSON.parse(second.stdout);
  assert.equal(payload.changes, 0);
  assert.deepEqual(payload.channels.described, []);
  assert.deepEqual(payload.members.described, []);

  assert.equal(descriptionOf(channelRows(dataDir), office.id), OFFICE_CHANNEL_DESCRIPTION);
  assert.equal(descriptionOf(agentRows(dataDir), susan.id), SUSAN_DESCRIPTION);
});

test("一轮 --apply 里四类改动共存：频道改名 + 频道描述 + 秘书描述 + MEMORY 节名", () => {
  const { dataDir, office, susan, memoryPath } = makeDescriptionFixture({ withMemory: true });
  const originalMemory = fs.readFileSync(memoryPath, "utf8");

  const result = run(["--data-dir", dataDir, "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.changes, 4);
  assert.deepEqual(payload.counts, {
    channelsRenamed: 1,
    channelDescriptions: 1,
    memberDescriptions: 1,
    memoryFiles: 1,
    backups: 1,
  });
  assert.equal(payload.channels.renamed[0].to, CURRENT_OFFICE_NAME);
  assert.deepEqual(payload.channels.described[0].from, LEGACY_OFFICE_DESCRIPTION);
  assert.deepEqual(payload.channels.described[0].to, OFFICE_CHANNEL_DESCRIPTION);
  assert.equal(payload.members.described[0].name, "Susan");
  assert.equal(payload.members.described[0].from, LEGACY_SECRETARY_DESCRIPTION);
  assert.equal(payload.members.described[0].to, SUSAN_DESCRIPTION);

  // 落盘事实：四类改动都在同一个目录里生效，且 MEMORY 正文逐字节不变
  const channels = channelRows(dataDir);
  const migratedOffice = channels.find((row) => row.id === office.id);
  assert.equal(migratedOffice.name, CURRENT_OFFICE_NAME);
  assert.equal(migratedOffice.description, OFFICE_CHANNEL_DESCRIPTION);
  assert.equal(descriptionOf(agentRows(dataDir), susan.id), SUSAN_DESCRIPTION);
  const migratedMemory = fs.readFileSync(memoryPath, "utf8");
  assert.equal(migratedMemory, buildMemoryTemplate("susan", "secretary"));
  assert.deepEqual(bodyLines(migratedMemory), bodyLines(originalMemory));
});

test("--json 里描述改动可数：counts + 逐条 from/to + 自定义描述进 skipped", () => {
  const { dataDir, office, custom, susan, other } = makeDescriptionFixture({
    officeName: CURRENT_OFFICE_NAME,
  });

  const result = run(["--data-dir", dataDir, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.mode, "dry-run");
  assert.equal(payload.changes, 2);
  assert.equal(payload.counts.channelsRenamed, 0);
  assert.equal(payload.counts.channelDescriptions, 1);
  assert.equal(payload.counts.memberDescriptions, 1);
  assert.deepEqual(payload.channels.described, [
    {
      id: office.id,
      name: CURRENT_OFFICE_NAME,
      from: LEGACY_OFFICE_DESCRIPTION,
      to: OFFICE_CHANNEL_DESCRIPTION,
    },
  ]);
  assert.deepEqual(payload.members.described, [
    {
      id: susan.id,
      name: "Susan",
      from: LEGACY_SECRETARY_DESCRIPTION,
      to: SUSAN_DESCRIPTION,
    },
  ]);
  assert.deepEqual(
    payload.channels.skipped.map(({ id, name, reason }) => ({ id, name, reason })),
    [{ id: custom.id, name: "我的办公室", reason: "custom description" }],
  );
  assert.deepEqual(
    payload.members.skipped.map(({ id, name, reason }) => ({ id, name, reason })),
    [{ id: other.id, name: "Marlow", reason: "custom description" }],
  );

  // dry-run 零写入
  assert.equal(descriptionOf(channelRows(dataDir), office.id), LEGACY_OFFICE_DESCRIPTION);
  assert.equal(descriptionOf(agentRows(dataDir), susan.id), LEGACY_SECRETARY_DESCRIPTION);
});

test("--json 是机器可读的计划：字段覆盖计划与跳过原因", () => {
  const { dataDir, channel, memoryPath } = makeLegacyFixture();

  const result = run(["--data-dir", dataDir, "--json"]);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "dry-run");
  assert.equal(payload.dataDir, path.resolve(dataDir));
  assert.equal(payload.changes, 2);
  assert.deepEqual(payload.channels.renamed, [
    { id: channel.id, from: LEGACY_OFFICE_NAME, to: CURRENT_OFFICE_NAME },
  ]);
  assert.equal(payload.memoryFiles.updated.length, 1);
  assert.equal(payload.memoryFiles.updated[0].path, path.resolve(memoryPath));
  assert.deepEqual(
    payload.memoryFiles.updated[0].sections.map((s) => `${s.from}->${s.to}`),
    [
      "角色描述->Role",
      "当前工作->Current work",
      "工作流程->Workflow",
      "Skill 使用->Skills",
      "工具使用->Tools",
      "其他->Other",
    ],
  );
  assert.deepEqual(payload.backups, []);
});

test("坏编码的 MEMORY.md 被拒绝：宁可不迁移，不毁字节", () => {
  const { dataDir, channel, memoryPath } = makeLegacyFixture();
  // 合法旧节名 + 非法 UTF-8 字节：一旦按字符串重写就会毁掉原字节
  const broken = Buffer.concat([
    Buffer.from("# susan\n\n## 角色描述\n\nrole\n\n## 其他\n", "utf8"),
    Buffer.from([0xff, 0xfe]),
  ]);
  fs.writeFileSync(memoryPath, broken);

  const result = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UTF-8/);
  assert.equal(fs.readFileSync(memoryPath).equals(broken), true, "拒绝时必须一个字节都不改");
  assert.deepEqual(backupsIn(path.dirname(memoryPath)), []);
  assert.deepEqual(
    channelNames(dataDir),
    [{ id: channel.id, name: LEGACY_OFFICE_NAME }],
    "计划期就失败：任何写入（含频道改名）都不该发生",
  );
});

test("错误路径：数据目录不存在 / 不可读 / 没有库 / 参数未知 → 非零退出且报错明确", (t) => {
  const missing = path.join(tmpDir(), "does-not-exist");
  const missingResult = run(["--data-dir", missing]);
  assert.notEqual(missingResult.status, 0);
  assert.equal(missingResult.status, 2);
  assert.match(missingResult.stderr, /数据目录/);

  const emptyDir = tmpDir();
  const emptyResult = run(["--data-dir", emptyDir]);
  assert.equal(emptyResult.status, 2);
  assert.match(emptyResult.stderr, /数据目录/);
  assert.deepEqual(fs.readdirSync(emptyDir), [], "拒绝运行不得在目录里留下任何文件");

  const badArgs = run(["--data-dir", emptyDir, "--nope"]);
  assert.equal(badArgs.status, 2);
  assert.match(badArgs.stderr, /--nope/);

  const conflicting = run(["--data-dir", emptyDir, "--dry-run", "--apply"]);
  assert.equal(conflicting.status, 2);
  assert.match(conflicting.stderr, /--dry-run/);

  const unreadable = tmpDir();
  openDataDb(unreadable).close();
  fs.chmodSync(unreadable, 0o000);
  try {
    if (process.getuid?.() === 0) return t.skip("root 无视目录权限");
    const unreadableResult = run(["--data-dir", unreadable]);
    assert.equal(unreadableResult.status, 2);
    assert.match(unreadableResult.stderr, /不可读/);
  } finally {
    fs.chmodSync(unreadable, 0o700);
  }
});
