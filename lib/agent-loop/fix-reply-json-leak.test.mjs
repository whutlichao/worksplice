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
const { isLeakedReplyCandidate, RAW_CONTROL_MIN_CODE, RAW_CONTROL_MAX_CODE } = await import(
  "./json-prologue.ts"
);
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

/**
 * 第二形态（reply-json-raw-leak）：协议 JSON 形状正确，但 content 字符串值里是真实换行。
 * 逐字形态取自 live 一条消息的实测形状，正文为本文件自造的等价文本（不含 live 正文）。
 * 同文件里的 `RAW_CONTROL_LEAKED` 保留嵌套围栏与多段裸换行；`RAW_CONTROL_SHORT` 是最短形态。
 */
const RAW_CONTROL_LEAKED =
  '{"action":"reply","content":"@bob 收到，先看主触发点。\n\n```\nOK\n```","onConflict":"revise"}';
const RAW_CONTROL_SHORT = '{"action":"ignore","content":"a\tb"}';
const RAW_CONTROL_EXPECTED = "@bob 收到，先看主触发点。\n\n```\nOK\n```";

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
  // 第二形态（裸控制字符）：协议 JSON 形状正确、content 里是真实换行
  const rawControl = db.insertMessageAt({
    targetId: channel.id,
    seq: 5,
    authorId: agent.id,
    content: RAW_CONTROL_LEAKED,
  });
  const rawControlShort = db.insertMessageAt({
    targetId: channel.id,
    seq: 6,
    authorId: agent.id,
    content: RAW_CONTROL_SHORT,
  });
  // 形态像对象但 action 不合法（且含裸换行）：不属任何修复档，逐字不能被动
  const rawControlWrongShape = db.insertMessageAt({
    targetId: channel.id,
    seq: 7,
    authorId: agent.id,
    content: '{"动":"睡前核对\n第二步"}',
  });
  // 形态命中但形状不合法（中文键，parse 成功但不是协议）：必须被跳过而不是硬改
  const skippable = withSkippable
    ? db.insertMessageAt({
        targetId: channel.id,
        seq: 8,
        authorId: agent.id,
        content: '","动作":"回复","正文":"这不是协议"',
      })
    : null;
  db.close();
  return {
    dataDir,
    channel,
    agent,
    leaked,
    leakedShort,
    healthy,
    rawControl,
    rawControlShort,
    rawControlWrongShape,
    skippable,
  };
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

test("dry-run 零写入：两档脏形态逐字不动、不建备份，报告里逐条列出计划", () => {
  const { dataDir, leaked, leakedShort, rawControl, rawControlShort, rawControlWrongShape, healthy } =
    makeLeakFixture();
  const before = rawContents(dataDir);

  const result = run(["--data-dir", dataDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run: 4 changes/);
  assert.match(result.stdout, /未写入/);

  assert.deepEqual(rawContents(dataDir), before, "dry-run 一个字节都不许动");
  assert.deepEqual(backupsIn(dataDir), [], "dry-run 不得建备份");

  const json = run(["--data-dir", dataDir, "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.mode, "dry-run");
  assert.equal(payload.changes, 4);
  assert.deepEqual(
    payload.repaired.map(({ id }) => id),
    [leaked.id, leakedShort.id, rawControl.id, rawControlShort.id],
  );
  // 逐条带出命中的是哪一档（报告里看得出「新档确实在干活」，不是把两档混成一个数）
  assert.deepEqual(
    payload.repaired.map(({ form }) => form),
    ["prologue", "prologue", "raw-control", "raw-control"],
  );
  // 候选捞得宽（含裸控制字符就捞）：action 不合协议的 `{"动":…}` 被捞出来又逐个校验刷掉，
  // 带 id + 原因进报告，绝不静默也绝不硬改。
  assert.deepEqual(
    payload.skipped.map(({ id, reason }) => ({ id, reason })),
    [{ id: rawControlWrongShape.id, reason: "形态命中但候选 JSON.parse 失败或形状不合协议" }],
  );
  assert.deepEqual(payload.backups, []);
  assert.ok(rawContents(dataDir).find((r) => r.id === healthy.id));
});

test("--apply 还原两档脏消息：回填值 = 协议 content 字段，字面 \\n 变真换行、裸换行原样保留", () => {
  const { dataDir, leaked, leakedShort, rawControl, rawControlShort, rawControlWrongShape, healthy } =
    makeLeakFixture();

  const result = run(["--data-dir", dataDir, "--apply"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /apply: 4 changes/);

  const rows = rawContents(dataDir);
  const byId = new Map(rows.map((row) => [row.id, row.content]));
  assert.equal(
    byId.get(leaked.id),
    "睡前最后一次核对，确认主触发点健康：\n\n```\n2026-10-07 10:41 CST\n…",
    "字面 \\n 必须还原为真实换行（嵌套围栏也原样保留）",
  );
  assert.equal(byId.get(leakedShort.id), "ok");
  assert.equal(
    byId.get(rawControl.id),
    RAW_CONTROL_EXPECTED,
    "裸换行形态：去掉 JSON 外壳后正文里的换行就是原样那一个",
  );
  assert.equal(byId.get(rawControlShort.id), "a\tb", "裸制表同样还原，尾部 \\f 不在样本里");
  assert.equal(
    byId.get(rawControlWrongShape.id),
    '{"动":"睡前核对\n第二步"}',
    "action 不合协议：绝不按「看起来像」硬改",
  );
  assert.equal(byId.get(healthy.id), HEALTHY, "正常消息逐字不动");

  // 期望值来自防未来修复那条链路（独立事实来源）：parseAgentAction 现在就把这四条
  // 还原成同一个 content。清洗脚本与它同源，产物必须一致。
  assert.equal(byId.get(leaked.id), parseAgentAction(LEAKED_WITH_QUOTE).content);
  assert.equal(byId.get(leakedShort.id), parseAgentAction(LEAKED_SHORT).content);
  assert.equal(byId.get(rawControl.id), parseAgentAction(RAW_CONTROL_LEAKED).content);
  assert.equal(byId.get(rawControlShort.id), parseAgentAction(RAW_CONTROL_SHORT).content);

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
  const { dataDir, rawControlWrongShape } = makeLeakFixture();
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
  const dryPayload = JSON.parse(dry.stdout);
  assert.equal(dryPayload.changes, 0);
  assert.deepEqual(dryPayload.repaired, []);
  // 报告保真：已回填的行会被 GLOB 超集再抽一遍，但**不得**被当成「修不了」的候选报出来——
  // 回填后的正文含真实换行，会被 GLOB 命中；而真相是它已修完（不是坏候选）。
  // 仍在 skipped 里的只能是真的修不了那种（本 fixture 里就是 action 不合协议的那一条）。
  assert.deepEqual(
    dryPayload.skipped.map(({ id, reason }) => ({ id, reason })),
    [{ id: rawControlWrongShape.id, reason: "形态命中但候选 JSON.parse 失败或形状不合协议" }],
    "已修好的行不得进 skipped",
  );
});

test("形状不合协议的候选被跳过并进报告，绝不按「看起来像」硬改", () => {
  const { dataDir, skippable, healthy } = makeLeakFixture({ withSkippable: true });
  const before = rawContents(dataDir).find((row) => row.id === skippable.id).content;

  const result = run(["--data-dir", dataDir, "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.changes, 4, "只有合法形态进计划（两档各两条）");
  assert.equal(payload.skipped.length, 2, "两条形态各自的不合法候选都进报告");
  assert.ok(payload.skipped.some((row) => row.id === skippable.id));
  assert.ok(
    payload.skipped.every((row) => /JSON\.parse 失败或形状不合协议/.test(row.reason)),
  );

  const after = rawContents(dataDir).find((row) => row.id === skippable.id).content;
  assert.equal(after, before, "跳过的候选必须逐字不动");
  assert.ok(rawContents(dataDir).some((row) => row.id === healthy.id));
});

test("裸控制字符形态：形状合法但 content 不是字符串的候选同样被跳过", () => {
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
  // 裸控制字符在字符串里、但 content 不是字符串：形状合协议而无可回填（与第一档同一判据）
  const noContent = db.insertMessageAt({
    targetId: channel.id,
    seq: 1,
    authorId: agent.id,
    content: '{"action":"ignore","content":42,"note":"a\nb"}',
  });
  db.close();

  const payload = JSON.parse(run(["--data-dir", dataDir, "--apply", "--json"]).stdout);
  assert.equal(payload.changes, 0);
  assert.deepEqual(
    payload.skipped.map(({ id, reason }) => ({ id, reason })),
    [{ id: noContent.id, reason: "形状合协议但 content 不是字符串，无从回填" }],
  );
  assert.equal(rawContents(dataDir)[0].content, '{"action":"ignore","content":42,"note":"a\nb"}');
});

test("裸控制字符形态：内容里未转义的内部双引号仍失败——进 skipped，逐字不动", () => {
  // coordinator 在 live 快照上交付的证据：9 条本形态候选里 1 条（487a5e7b）不是控制字符问题，
  // 而是 content 串值里未转义的内部双引号（Markdown 片段里的 `rel="..."`）。转义裸控制字符后
  // JSON 仍在 `rel=` 之后提前合上，parse 报 Expected ',' or '}' after property value。
  // 正确行为是**不猜**：进 skipped 并带原因，字节一字不动（不做启发式引号配平——那属猜测性修复）。
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
  const unescapedInnerQuote =
    '{"action":"reply","content":"我改了这一行：\n`<link rel="stylesheet" href="tokens.css">`\n请确认。","onConflict":"revise"}';
  const row = db.insertMessageAt({
    targetId: channel.id,
    seq: 1,
    authorId: agent.id,
    content: unescapedInnerQuote,
  });
  db.close();

  const result = run(["--data-dir", dataDir, "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.changes, 0, "猜不出来的就不改：不进 repaired");
  assert.deepEqual(
    payload.skipped.map(({ id, reason }) => ({ id, reason })),
    [{ id: row.id, reason: "形态命中但候选 JSON.parse 失败或形状不合协议" }],
  );
  assert.equal(
    rawContents(dataDir)[0].content,
    unescapedInnerQuote,
    "跳过的候选逐字不动（不丢字、不截断）",
  );
  // 与防未来链路同结论：parseAgentAction 也走兜底，整段当正文
  assert.equal(parseAgentAction(unescapedInnerQuote).content, unescapedInnerQuote);
});

test("裸控制字符形态：content 为空串照常修（与前档同一口径，不特判）", () => {
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
  const emptyContent = '{"action":"ignore","content":"","note":"a\nb"}';
  db.insertMessageAt({ targetId: channel.id, seq: 1, authorId: agent.id, content: emptyContent });
  db.close();

  const payload = JSON.parse(run(["--data-dir", dataDir, "--apply", "--json"]).stdout);
  assert.equal(payload.changes, 1);
  assert.deepEqual(payload.repaired.map(({ form }) => form), ["raw-control"]);
  assert.deepEqual(payload.skipped, []);
  assert.equal(rawContents(dataDir)[0].content, "");
  assert.equal(parseAgentAction(emptyContent).content, "");
});

test("空串 content（live 实测的 ignore 形态）修复为空串，不被当成「非字符串」跳过", () => {
  // 实测存量里有一条这样的（修复后 content 为空串）：空串**是**字符串，按统一判据照常修，
  // 不得因为「看起来没内容」就特判跳过。判据里没有任何针对空串的分支。
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
  const emptyContent = '","action":"ignore","content":"","onConflict":"silent"}';
  const row = db.insertMessageAt({
    targetId: channel.id,
    seq: 1,
    authorId: agent.id,
    content: emptyContent,
  });
  db.close();

  const result = run(["--data-dir", dataDir, "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.changes, 1);
  assert.deepEqual(payload.skipped, [], "空串不是「无从回填」，不得进 skipped");
  assert.equal(rawContents(dataDir)[0].content, "");

  // 与防未来链路同口径：parseAgentAction 现在就把这条解析成 content 为空的 ignore
  assert.equal(parseAgentAction(emptyContent).content, "");
  assert.equal(rawContents(dataDir)[0].id, row.id);
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
  assert.match(explicit.stdout, /dry-run: 4 changes/);

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

test("SQL 候选捞取不漏斗：JS 候选面全部入计划，多捞的候选只进 skipped", () => {
  // SQL 那两个 LIKE 前缀 + 一个 GLOB 字符类，是候选面判据的第二份字面表示（不先在 SQL 说一次
  // 就没法把候选从全表里捞出来）。SQL 侧刻意是**超集**：只要含裸控制字符就捞，而 JS 侧
  // （`parseLeakedReply`）才是精确判官——对象形状 + 转义后能 parse + action ∈ {reply, ignore}。
  //
  // 这条用例钉住两边的关系，两个方向都会红：
  //   - 漏斗（SQL 少捞）→ 某个 JS 候选面里的行不出现在计划里（repaired ∪ skipped）→ 红；
  //   - 宽到失控（SQL 多捞且 JS 也跟着认）→ 多捞的行进了 repaired 而不是 skipped → 红。
  // 两端都是全表扫描（LIKE / GLOB 都没法走索引），所以超集不额外花 I/O，多捞的代价只是
  // 一次 `parseLeakedReply` 的早退（非对象形状在 `looksLikeProtocolObject` 就返回）。
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
    '","action":"reply","content":"ok"}', // 命中（第一档形态 1）
    ',"action":"reply","content":"ok"}', // 命中（第一档形态 2）
    '","not-even-json', // 命中（第一档形态 1，校验不过）
    ',"also-not-json', // 命中（第一档形态 2，校验不过）
    '{"action":"reply","content":"a\nb"}', // 命中（第二档，裸 LF）
    '{"action":"ignore","content":"a\tb"}', // 命中（第二档，裸 TAB）
    '{"动":"a\nb"}', // 候选面命中但 action 不合协议
    '{"action":"reply","content":"a\nb"', // 候选面命中但不以 `}` 结尾（转义后仍 parse 不过）
    '"just-a-quote', // 不命中候选面
    ',a-comma-first', // 不命中候选面
    '  ,"leading-space', // 不命中候选面（形态判据只认开头）
    '{"action":"reply","content":"字面\\n不命中"}', // 不命中（字面转义不是裸控制字符）
    '正常中文回复', // 不命中候选面
    '第一行\n第二行', // **超集多捞**的样本：有裸换行但不像对象，JS 侧拒掉
  ];
  const inserted = contents.map((content, index) =>
    db.insertMessageAt({ targetId: channel.id, seq: index + 1, authorId: agent.id, content }),
  );
  db.close();

  const result = run(["--data-dir", dataDir, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const plannedIds = new Set([
    ...payload.repaired.map(({ id }) => id),
    ...payload.skipped.map(({ id }) => id),
  ]);
  const jsCandidates = inserted.filter((row) => isLeakedReplyCandidate(row.content));
  // 方向一：不漏（JS 候选面的每一条都进了计划）
  assert.deepEqual(
    jsCandidates.filter((row) => !plannedIds.has(row.id)).map((row) => row.content),
    [],
  );
  assert.equal(jsCandidates.length, 7, "候选面不被漏搜，也不被多算");
  // 方向二：多捞的不进任何计划位（既不能进 repaired，也不该被当成坏候选进 skipped）
  assert.equal(payload.changes, 4, "只有协议形状合法的四条被修");
  const overFetched = inserted.filter(
    (row) => !isLeakedReplyCandidate(row.content) && plannedIds.has(row.id),
  );
  assert.deepEqual(overFetched.map((row) => row.content), [], "超集多捞的静默放过，不进任何计划位");
  assert.equal(plannedIds.size, jsCandidates.length, "计划里恰好只有 JS 候选面的那几条");
  assert.deepEqual(
    payload.skipped.map(({ reason }) => reason),
    new Array(payload.skipped.length).fill("形态命中但候选 JSON.parse 失败或形状不合协议"),
  );
});

test("候选面区间单源：U+0001–U+001F 与 SQL GLOB 一致，NUL 两侧都不算", () => {
  // 「哪些字符算裸控制字符」的唯一权威表示在 `json-prologue.ts`；SQL 侧 GLOB 是它的字面量副本。
  // 这条用例把两面钉在一起，特别是一个容易漂的端点：起点必须是 0x01（不是 0x00）——
  // 因为 SQLite 的 GLOB `[\u0001-\u001f]` 覆盖不了 NUL（字符串处理在第一个 NUL 就截断），
  // JS 侧若仍认 0x00 就会出现「loop 能修、脚本永远捞不到」的单向不一致。
  assert.equal(RAW_CONTROL_MIN_CODE, 1);
  assert.equal(RAW_CONTROL_MAX_CODE, 31);

  // 区间两端各自作为裸控制字符出现在字符串值里，脚本必须能捞到
  const lower = `{"action":"reply","content":"a${String.fromCharCode(1)}b"}`;
  const upper = `{"action":"ignore","content":"a${String.fromCharCode(31)}b"}`;
  // U+0000 不在区间里：JS 侧也不认（loop 与脚本一致地不管它）
  const nul = `{"action":"reply","content":"a${String.fromCharCode(0)}b"}`;
  assert.equal(isLeakedReplyCandidate(lower), true);
  assert.equal(isLeakedReplyCandidate(upper), true);
  assert.equal(isLeakedReplyCandidate(nul), false, "U+0000 两侧都不认，不得单向不一致");

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
  const rows = [lower, upper].map((content, index) =>
    db.insertMessageAt({ targetId: channel.id, seq: index + 1, authorId: agent.id, content }),
  );
  db.close();

  const payload = JSON.parse(run(["--data-dir", dataDir, "--json"]).stdout);
  assert.deepEqual(
    payload.repaired.map(({ id, form }) => ({ id, form })),
    rows.map((row) => ({ id: row.id, form: "raw-control" })),
    "区间两端都必须被 SQL GLOB 捞到并由 JS 侧接手",
  );
});

// contentsOf 是「走产品读取路径」的对照读法：修复前后都能读到同一批消息。
test("修复后的消息走产品读取路径也是还原后的正文", () => {
  const { dataDir, channel, rawControlWrongShape } = makeLeakFixture();
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
      RAW_CONTROL_EXPECTED,
      "a\tb",
      '{"动":"睡前核对\n第二步"}',
    ],
  );
  // 非协议形状那条不在计划里（action 不合法），逐字不动——上面那条断言就是它的现状
  assert.ok(rows.some((row) => row.id === rawControlWrongShape.id));
});