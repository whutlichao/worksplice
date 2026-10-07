import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 一次性存量清洗脚本（scripts/fix-reply-json-leak.mjs）的行为测试。
 *
 * 测试在 CLI 接缝上做（子进程 + 临时数据目录）：脚本的公共面就是命令行——
 * 参数 → 退出码 / stdout / 落库效果。断言只碰「存量样子」与「修后样子」，
 * 不碰脚本内部结构。
 *
 * 存量样子取自 bob 在 2026-10-07T02:23:33Z 起的真实输出形态：结构化回复的开头
 * `{"` 被输出成 `","` / `,"`，围栏剥掉后没有 `{`，整段碎片被当成正文落库。
 * 其中一条带字面 `\n`（本该是换行），用来盯住「回填值 = content 字段、转义在此还原」。
 *
 * 位置说明：沿用仓库惯例（lib/domain/collab/migrate-i18n-content.test.mjs 为
 * scripts/migrate-i18n-content.mjs 测 CLI），故本文件落 lib/agent-loop/ 下而不是
 * scripts/ 下——docs/engineering-standards.md §2.2：新增测试文件被既有 `**` glob 自动纳入。
 *
 * 绝不触碰 ~/.worksplice：每个用例自建 mkdtemp 数据目录；「不碰默认数据目录」那条用例
 * 额外把 HOME 打到岸头目录，脚本或它的 import 若去开默认目录就会在那里留下文件。
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(repoRoot, "scripts", "fix-reply-json-leak.mjs");

const { openDataDb } = await import("../data/sqlite.ts");
const { parseAgentAction } = await import("./loop.ts");
const { LEAK_PROLOGUE_PATTERN } = await import("./json-prologue.ts");
const { MESSAGES_NO_UPDATE_SQL } = await import("../../scripts/fix-reply-json-leak.mjs");

/**
 * bob 的两条脏形态（逐字取自实测输出）：引号多 / 少一个两种。
 * 第一条保留真实输出的关键特征：嵌套的 ``` 围栏 + 多处字面 \n（本该是换行）。
 */
const LEAKED_WITH_QUOTE =
  '","action":"reply","content":"睡前最后一次核对，确认主触发点健康：\\n\\n```\\n2026-10-07 10:41 CST\\n…","onConflict":"resend"}';
const LEAKED_SHORT = ',"action":"reply","content":"ok"}';
/** 一条正常消息：形态不命中，逐字不能被动。 */
const HEALTHY = "我先看一下触发点，然后给你结论。";

const tmpDirs = new Set();

test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix = "worksplice-json-leak-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.add(dir);
  return dir;
}

/**
 * 造一份「存量样子」的数据目录：一个频道 + 一个 agent，两条脏形态消息 + 一条正常消息。
 * INSERT 不受消息不可变触发器限制（触发器只护 UPDATE/DELETE），走数据层既有写入路径。
 */
function makeLeakFixture({ withSkippable = false } = {}) {
  const dataDir = tmpDir();
  const db = openDataDb(dataDir);
  const channel = db.insertChannel({ name: "leak-room", type: "public", description: "" });
  const agent = db.insertMember({
    type: "agent",
    name: "bob",
    description: "helper",
    workspacePath: null,
    modelProvider: "test-provider",
    modelId: "test-model",
    thinkingLevel: "low",
  });
  db.appendMessage({
    targetId: channel.id,
    seq: 1,
    authorId: agent.id,
    content: "触发点还活着吗？",
  });
  const leaked = db.insertMessageAt({
    targetId: channel.id,
    seq: 2,
    authorId: agent.id,
    content: LEAKED_WITH_QUOTE,
  });
  const leakedShort = db.insertMessageAt({
    targetId: channel.id,
    seq: 3,
    authorId: agent.id,
    content: LEAKED_SHORT,
  });
  const healthy = db.insertMessageAt({
    targetId: channel.id,
    seq: 4,
    authorId: agent.id,
    content: HEALTHY,
  });
  // 形态命中但形状不合法（中文键，parse 成功但不是协议）：必须被跳过而不是硬改
  const skippable = withSkippable
    ? db.insertMessageAt({
        targetId: channel.id,
        seq: 5,
        authorId: agent.id,
        content: '","动作":"回复","正文":"这不是协议"',
      })
    : null;
  db.close();
  return { dataDir, channel, agent, leaked, leakedShort, healthy, skippable };
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** 直接读 messages 表（不经任何产品读取路径，只看最终字节）。 */
function rawContents(dataDir) {
  const db = openDataDb(dataDir);
  const rows = db.db.prepare("SELECT id, content FROM messages ORDER BY seq").all();
  db.close();
  return rows;
}

function backupsIn(dataDir) {
  return fs
    .readdirSync(dataDir)
    .filter((name) => name.startsWith("worksplice.db.bak-"))
    .sort();
}

test("dry-run 零写入：两条脏形态逐字不动、不建备份，报告里逐条列出计划", () => {
  const { dataDir, leaked, leakedShort, healthy } = makeLeakFixture();
  const before = rawContents(dataDir);

  const result = run(["--data-dir", dataDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run: 2 changes/);
  assert.match(result.stdout, /未写入/);

  assert.deepEqual(rawContents(dataDir), before, "dry-run 一个字节都不许动");
  assert.deepEqual(backupsIn(dataDir), [], "dry-run 不得建备份");

  const json = run(["--data-dir", dataDir, "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.mode, "dry-run");
  assert.equal(payload.changes, 2);
  assert.deepEqual(
    payload.repaired.map(({ id }) => id),
    [leaked.id, leakedShort.id],
  );
  assert.deepEqual(payload.skipped, []);
  assert.deepEqual(payload.backups, []);
  assert.ok(rawContents(dataDir).find((r) => r.id === healthy.id));
});

test("--apply 还原两条脏消息：回填值 = 协议 content 字段，字面 \\n 变回真换行", () => {
  const { dataDir, leaked, leakedShort, healthy } = makeLeakFixture();

  const result = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /apply: 2 changes/);

  const rows = rawContents(dataDir);
  const byId = new Map(rows.map((row) => [row.id, row.content]));
  assert.equal(
    byId.get(leaked.id),
    "睡前最后一次核对，确认主触发点健康：\n\n```\n2026-10-07 10:41 CST\n…",
    "字面 \\n 必须还原为真实换行（嵌套围栏也原样保留）",
  );
  assert.equal(byId.get(leakedShort.id), "ok");
  assert.equal(byId.get(healthy.id), HEALTHY, "正常消息逐字不动");

  // 期望值来自防未来修复那条链路（独立事实来源）：parseAgentAction 现在就把这两条
  // 还原成同一个 content。清洗脚本与它同源，产物必须一致。
  assert.equal(byId.get(leaked.id), parseAgentAction(LEAKED_WITH_QUOTE).content);
  assert.equal(byId.get(leakedShort.id), parseAgentAction(LEAKED_SHORT).content);

  assert.equal(backupsIn(dataDir).length, 1, "改前必须有一份整库备份");
});

test("重建的触发器 SQL 与 lib/data/schema.ts 那一条逐字一致（直接对源文件，不是自己对自己比）", () => {
  const schemaSource = fs.readFileSync(path.join(repoRoot, "lib", "data", "schema.ts"), "utf8");
  assert.ok(
    schemaSource.includes(MESSAGES_NO_UPDATE_SQL),
    `触发器 SQL 与 lib/data/schema.ts 不再逐字一致（脚本改了它就直接被修坏）：\n${MESSAGES_NO_UPDATE_SQL}`,
  );
});

test("--apply 后不可变触发器仍在位：UPDATE 仍被 ABORT", () => {
  const { dataDir, healthy } = makeLeakFixture();
  assert.equal(run(["--data-dir", dataDir, "--apply"]).status, 0);

  const db = openDataDb(dataDir);
  const row = db.db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'messages_no_update'")
    .get();
  assert.ok(row, "messages_no_update 必须被重建回来");

  let aborted = false;
  try {
    db.db.prepare("UPDATE messages SET content = ? WHERE id = ?").run("tampered", healthy.id);
  } catch (error) {
    aborted = /messages are immutable/.test(error.message);
  }
  assert.equal(aborted, true, "触发器丢了就等于把消息可变性这个不变量拆了");
  db.close();
});

test("幂等：第二遍 --apply 报 0 changes、字节不变、不新增备份", () => {
  const { dataDir } = makeLeakFixture();
  assert.equal(run(["--data-dir", dataDir, "--apply"]).status, 0);
  const afterFirst = rawContents(dataDir);
  const backupsAfterFirst = backupsIn(dataDir);

  const second = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /0 changes/);

  const payload = JSON.parse(run(["--data-dir", dataDir, "--apply", "--json"]).stdout);
  assert.equal(payload.mode, "apply");
  assert.equal(payload.changes, 0);
  assert.deepEqual(payload.repaired, []);
  assert.deepEqual(rawContents(dataDir), afterFirst);
  assert.deepEqual(backupsIn(dataDir), backupsAfterFirst, "没改动就不该有第二份备份");

  // 干跑同样零变化
  const dry = run(["--data-dir", dataDir, "--json"]);
  assert.equal(JSON.parse(dry.stdout).changes, 0);
});

test("形状不合协议的候选被跳过并进报告，绝不按「看起来像」硬改", () => {
  const { dataDir, skippable, healthy } = makeLeakFixture({ withSkippable: true });
  const before = rawContents(dataDir).find((row) => row.id === skippable.id).content;

  const result = run(["--data-dir", dataDir, "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.changes, 2, "只有两条合法形态进计划");
  assert.equal(payload.skipped.length, 1);
  assert.equal(payload.skipped[0].id, skippable.id);
  assert.match(payload.skipped[0].reason, /JSON\.parse 失败或形状不合协议/);

  const after = rawContents(dataDir).find((row) => row.id === skippable.id).content;
  assert.equal(after, before, "跳过的候选必须逐字不动");
  assert.ok(rawContents(dataDir).some((row) => row.id === healthy.id));
});

test("content 不是字符串的候选被跳过（无从回填），并列出原因", () => {
  const dataDir = tmpDir();
  const db = openDataDb(dataDir);
  const channel = db.insertChannel({ name: "leak-room", type: "public", description: "" });
  const agent = db.insertMember({
    type: "agent",
    name: "bob",
    description: "helper",
    workspacePath: null,
    modelProvider: "test-provider",
    modelId: "test-model",
    thinkingLevel: "low",
  });
  const noContent = db.insertMessageAt({
    targetId: channel.id,
    seq: 1,
    authorId: agent.id,
    content: '","action":"reply","content":42}',
  });
  db.close();

  const result = run(["--data-dir", dataDir, "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.changes, 0);
  assert.deepEqual(
    payload.skipped.map(({ id, reason }) => ({ id, reason })),
    [{ id: noContent.id, reason: "形状合协议但 content 不是字符串，无从回填" }],
  );
  assert.equal(rawContents(dataDir)[0].content, '","action":"reply","content":42}');
});

test("FTS 跟着回填走：改完的消息能搜到还原后的正文（不手工改 messages_fts）", () => {
  const { dataDir, leaked } = makeLeakFixture();
  assert.equal(run(["--data-dir", dataDir, "--apply"]).status, 0);

  const db = openDataDb(dataDir);
  const hits = db.searchMessages("睡前最后一次核对");
  assert.ok(
    hits.some((hit) => hit.id === leaked.id),
    `FTS 没跟上：${JSON.stringify(hits)}`,
  );
  db.close();
});

test("显式 --dry-run 与默认形态一致，且绝不碰默认数据目录", () => {
  const { dataDir, healthy } = makeLeakFixture();
  const before = rawContents(dataDir);
  // HOME 指向岸头目录：脚本或其 import 若去开默认目录，就会在那里留下 ~/.worksplice
  const fakeHome = tmpDir("worksplice-json-leak-fakehome-");
  const env = { HOME: fakeHome, WORKSPLICE_DATA_DIR: "" };

  const explicit = run(["--data-dir", dataDir, "--dry-run"], env);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(explicit.stdout, /dry-run: 2 changes/);

  assert.equal(run(["--help"], env).status, 0);
  assert.match(run(["--help"], env).stdout, /用法/);

  const applied = run(["--data-dir", dataDir, "--apply"], env);
  assert.equal(applied.status, 0, applied.stderr);
  assert.notEqual(rawContents(dataDir), before, "apply 应改到目标库");
  assert.equal(
    fs.existsSync(path.join(fakeHome, ".worksplice")),
    false,
    "给了 --data-dir 就不得再开默认数据目录（HOME 被打岸也一样）",
  );
  assert.ok(rawContents(dataDir).some((row) => row.id === healthy.id));
});

test("错误路径：数据目录不存在 / 空目录 / 参数未知 → 退出码 2 且不留下任何文件", () => {
  const missing = path.join(tmpDir(), "does-not-exist");
  const missingResult = run(["--data-dir", missing]);
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
});

test("备份是可用的一致性快照：里面仍是修复前的坏形态", () => {
  const { dataDir } = makeLeakFixture();
  assert.equal(run(["--data-dir", dataDir, "--apply"]).status, 0);

  const backup = backupsIn(dataDir)[0];
  const snapshot = openDataDb(tmpDir());
  // 备份文件单独开：VACUUM INTO 的产物不依赖原库
  const Database = snapshot.db.constructor;
  const restored = new Database(path.join(dataDir, backup), { readonly: true });
  const rows = restored.prepare("SELECT content FROM messages ORDER BY seq").all();
  restored.close();
  snapshot.close();
  assert.ok(
    rows.some((row) => row.content === LEAKED_WITH_QUOTE),
    "备份里应该是修复前的字节（可回退的凭据）",
  );
});

test("dry-run 后坏数据仍在（零写入），且报告只列计划", () => {
  const { dataDir } = makeLeakFixture();
  assert.equal(run(["--data-dir", dataDir]).status, 0);
  assert.ok(
    rawContents(dataDir).some((row) => row.content === LEAKED_WITH_QUOTE),
    "dry-run 之后坏数据仍在",
  );
});

test("SQL 候选捞取与 JS 形态判据等价：候选集 == LEAK_PROLOGUE_PATTERN 的匹配集", () => {
  // 脚本里那两个 LIKE 前缀是形态判据的第二份字面表示（SQL 不先说一次就没法把候选从全表里捞出来）。
  // 这条用例把两份表示钉在一起：SQL 多捞（白跑一趟）或少捞（漏修）都红。
  const dataDir = tmpDir();
  const db = openDataDb(dataDir);
  const channel = db.insertChannel({ name: "leak-room", type: "public", description: "" });
  const agent = db.insertMember({
    type: "agent",
    name: "bob",
    description: "helper",
    workspacePath: null,
    modelProvider: "test-provider",
    modelId: "test-model",
    thinkingLevel: "low",
  });
  const contents = [
    '","action":"reply","content":"ok"}', // 命中（形态 1）
    ',"action":"reply","content":"ok"}', // 命中（形态 2）
    '","not-even-json', // 命中（形态 1，校验不过）
    ',"also-not-json', // 命中（形态 2，校验不过）
    '"just-a-quote', // 不命中
    ',a-comma-first', // 不命中
    '  ,"leading-space', // 不命中（形态判据只认开头）
    '正常中文回复', // 不命中
  ];
  const inserted = contents.map((content, index) =>
    db.insertMessageAt({ targetId: channel.id, seq: index + 1, authorId: agent.id, content }),
  );
  db.close();

  const result = run(["--data-dir", dataDir, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const planned = payload.repaired.map(({ id }) => id);
  const skipped = payload.skipped.map(({ id }) => id);
  const expected = inserted
    .filter((row) => LEAK_PROLOGUE_PATTERN.test(row.content))
    .map((row) => row.id);
  assert.equal(expected.length, 4);
  assert.deepEqual([...planned, ...skipped].sort(), [...expected].sort());
  // 命中形态的一律进计划（合法进 repaired、不合法进 skipped），不命中的一律不进任何一边
  assert.equal(planned.length, 2);
  assert.equal(skipped.length, 2);
});

// contentsOf 是「走产品读取路径」的对照读法：修复前后都能读到同一批消息。
test("修复后的消息走产品读取路径也是还原后的正文", () => {
  const { dataDir, channel } = makeLeakFixture();
  assert.equal(run(["--data-dir", dataDir, "--apply"]).status, 0);
  const db = openDataDb(dataDir);
  const rows = db.listMessages(channel.id);
  db.close();
  assert.deepEqual(
    rows.map((row) => row.content),
    [
      "触发点还活着吗？",
      "睡前最后一次核对，确认主触发点健康：\n\n```\n2026-10-07 10:41 CST\n…",
      "ok",
      HEALTHY,
    ],
  );
});