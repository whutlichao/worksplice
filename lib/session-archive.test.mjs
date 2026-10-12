// 上下文治理票 06：归档副本落盘与索引的服务层/存储层测试（B1/B2/B3/B6 的机制面）。
//
// 缝：合成 JSONL + 临时数据目录 + tmp DB（openDataDb(root)，遵守 default-datadir-guard 禁令）；
// 断言经服务层 `archiveAgentSessionFiles` / `searchArchivedSessionEntries` 观察，
// 不直接读内部表结构（表形状由存储层测试在 data-layer 侧收口）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-archive-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { archiveAgentSessionFiles, searchArchivedSessionEntries } = await import("./session-archive.ts");

/** 归档副本目录（数据目录内、按 agent 私有）：经 Store 的 paths 取落点，不断言实现细节命名。 */
function archiveDirFor(agentId) {
  return path.join(globalThis.__workspliceDb.paths.sessionArchivesDir, agentId);
}

let agentSeq = 0;
function freshAgent() {
  agentSeq += 1;
  return globalThis.__workspliceDb.insertMember({
    type: "agent",
    name: `archivist-${agentSeq}`,
  });
}

/**
 * 合成 session JSONL：头行 + 用户消息（埋关键事实）+ usage 条目（无可检索文本）
 * + assistant 消息 + 可选 compact summary 条目；可追加坏行。
 */
function syntheticSessionFile(dir, { userText, assistantText, summary, extraLines = [] } = {}) {
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "synthetic-1",
      timestamp: "2026-10-12T00:00:00.000Z",
      cwd: dir,
    }),
    JSON.stringify({
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026-10-12T00:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: userText }] },
    }),
    JSON.stringify({
      type: "usage",
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
    }),
    JSON.stringify({
      type: "message",
      id: "e2",
      parentId: "e1",
      timestamp: "2026-10-12T00:00:02.000Z",
      message: { role: "assistant", content: [{ type: "text", text: assistantText }] },
    }),
    ...(summary
      ? [
          JSON.stringify({
            type: "compaction",
            id: "e3",
            parentId: "e2",
            timestamp: "2026-10-12T00:00:03.000Z",
            summary,
            firstKeptEntryId: "e2",
            tokensBefore: 1234,
          }),
        ]
      : []),
    ...extraLines,
  ];
  const filePath = path.join(dir, "session.jsonl");
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  return filePath;
}

function freshSourceDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-archive-src-"));
}

test("B1：归档副本落入数据目录内，与原始会话记录逐字节一致且不改写原文件", () => {
  const agent = freshAgent();
  const source = syntheticSessionFile(freshSourceDir(), {
    userText: "关键事实：蓝鲸项目的代号是 ZEPHYR-9",
    assistantText: "已记录。",
  });
  const before = fs.readFileSync(source);

  archiveAgentSessionFiles(agent.id, [source]);

  const copies = fs.readdirSync(archiveDirFor(agent.id));
  assert.equal(copies.length, 1, "每个源文件落一份归档副本");
  const archived = fs.readFileSync(path.join(archiveDirFor(agent.id), copies[0]));
  assert.equal(Buffer.compare(archived, before), 0, "副本逐字节一致（不解析不改写）");
  assert.equal(
    Buffer.compare(fs.readFileSync(source), before),
    0,
    "归档只复制：原始会话记录不被删除也不被改写",
  );
  assert.ok(
    archiveDirFor(agent.id).startsWith(root),
    "归档产物在数据目录内 ⇒ 被「数据目录整体可复制」口径覆盖",
  );
});

test("B2：同一关键事实归档前不可命中、归档后可命中并定位到具体归档会话", () => {
  const agent = freshAgent();
  const source = syntheticSessionFile(freshSourceDir(), {
    userText: "关键事实：检索暗号是 ORCHID-42",
    assistantText: "收到暗号。",
  });

  assert.deepEqual(searchArchivedSessionEntries("ORCHID-42"), [], "归档＋索引前不可命中");

  archiveAgentSessionFiles(agent.id, [source]);

  const hits = searchArchivedSessionEntries("ORCHID-42");
  assert.equal(hits.length, 1);
  const hit = hits[0];
  assert.equal(hit.agent_id, agent.id);
  assert.equal(hit.source_path, source, "定位回原始 session 文件");
  assert.equal(hit.entry_index, 2, "定位到源文件内的具体条目（1 基行号）");
  assert.equal(hit.entry_type, "message");
  assert.match(hit.snippet, /<mark>ORCHID-42<\/mark>/, "命中片段高亮关键事实");
  assert.ok(
    fs.existsSync(path.join(globalThis.__workspliceDb.paths.sessionArchivesDir, `${hit.archive_id}.jsonl`)),
    "archive_id 可直接解析到落盘的归档副本",
  );
});

test("B3：compact summary 文本随归档原文进同一索引（不单独建面）", () => {
  const agent = freshAgent();
  const source = syntheticSessionFile(freshSourceDir(), {
    userText: "普通对话，无关键事实",
    assistantText: "继续。",
    summary: "摘要：迁移窗口定在 AURORA-7，之后回滚。",
  });

  archiveAgentSessionFiles(agent.id, [source]);

  const hits = searchArchivedSessionEntries("AURORA-7");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].entry_type, "compaction", "summary 作为归档会话中的一条条目进入同一索引");
  assert.equal(hits[0].source_path, source);

  // 同一索引面同时覆盖消息正文与 summary：两词命中来自同一归档会话
  const messageHits = searchArchivedSessionEntries("普通对话");
  assert.equal(messageHits.length, 1);
  assert.equal(messageHits[0].archive_id, hits[0].archive_id);
});

test("短 token（<3 字符）走 LIKE 兜底仍可命中（trigram 需 ≥3 字符）", () => {
  const agent = freshAgent();
  const source = syntheticSessionFile(freshSourceDir(), {
    userText: "口令检索：双字词命中",
    assistantText: "OK",
  });
  archiveAgentSessionFiles(agent.id, [source]);

  // “口令”是双字词（<3 字符）：trigram 索引不到，必须走 LIKE 兜底
  const hits = searchArchivedSessionEntries("口令");
  assert.equal(hits.length, 1);
  assert.match(hits[0].snippet, /<mark>口令<\/mark>/);
});

test("重复归档幂等：同一内容不产生重复副本与重复索引行", () => {
  const agent = freshAgent();
  const source = syntheticSessionFile(freshSourceDir(), {
    userText: "幂等暗号 REPEAT-1",
    assistantText: "ok",
  });

  archiveAgentSessionFiles(agent.id, [source]);
  archiveAgentSessionFiles(agent.id, [source]);

  assert.equal(fs.readdirSync(archiveDirFor(agent.id)).length, 1, "内容去重：不产生重复副本");
  assert.equal(searchArchivedSessionEntries("REPEAT-1").length, 1, "不产生重复索引行");
});

test("bashExecution 条目的 command/output 也进索引（正文之外的原始记录文本）", () => {
  const agent = freshAgent();
  const dir = freshSourceDir();
  const source = path.join(dir, "session.jsonl");
  fs.writeFileSync(
    source,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "synthetic-bash",
        timestamp: "2026-10-12T00:00:00.000Z",
        cwd: dir,
      }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-10-12T00:00:01.000Z",
        message: {
          role: "bashExecution",
          command: "grep -r FALCON-3 /tmp",
          output: "no matches",
          exitCode: 1,
        },
      }),
    ].join("\n") + "\n",
  );

  archiveAgentSessionFiles(agent.id, [source]);

  assert.equal(searchArchivedSessionEntries("FALCON-3").length, 1);
  assert.equal(searchArchivedSessionEntries("no matches").length, 1);
});

test("无文件/缺失文件/空文件时正常跳过：不报错也不造空档", () => {
  const agent = freshAgent();

  archiveAgentSessionFiles(agent.id, []);
  archiveAgentSessionFiles(agent.id, [path.join(root, "no-such-session.jsonl")]);
  const emptyFile = path.join(freshSourceDir(), "empty.jsonl");
  fs.writeFileSync(emptyFile, "");
  archiveAgentSessionFiles(agent.id, [emptyFile]);

  assert.equal(
    fs.existsSync(archiveDirFor(agent.id)),
    false,
    "没有可归档的会话文件时不落目录、不造空档",
  );
});

test("损坏行不影响其余条目归档与索引（jsonl 坏行容忍）", () => {
  const agent = freshAgent();
  const sourceDir = freshSourceDir();
  const source = syntheticSessionFile(sourceDir, { userText: "半行前的暗号 BROKEN-1" });
  fs.appendFileSync(source, "{ this is not json\n");
  const before = fs.readFileSync(source);

  archiveAgentSessionFiles(agent.id, [source]);

  const copies = fs.readdirSync(archiveDirFor(agent.id));
  assert.equal(
    Buffer.compare(fs.readFileSync(path.join(archiveDirFor(agent.id), copies[0])), before),
    0,
    "归档副本仍是逐字节原文（坏行原样保留）",
  );
  assert.equal(searchArchivedSessionEntries("BROKEN-1").length, 1, "其余条目照常进索引");
});

test("检索服务层：空查询返回空、limit 收敛", () => {
  const agent = freshAgent();
  const source = syntheticSessionFile(freshSourceDir(), { userText: "LIMIT-9 出现", assistantText: "ok" });
  archiveAgentSessionFiles(agent.id, [source]);

  assert.deepEqual(searchArchivedSessionEntries("   "), []);
  assert.equal(searchArchivedSessionEntries("LIMIT-9", { limit: 1 }).length, 1);
  assert.equal(searchArchivedSessionEntries("LIMIT-9", { limit: 0 }).length, 1, "limit 下限收敛为 1");
});
