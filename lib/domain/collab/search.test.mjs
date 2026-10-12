import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-search-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");
const { searchMessages } = await import("./search.ts");
const { archiveAgentSessionFiles } = await import("../../session-archive.ts");

function freshChannel(name = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  return createChannel({ name });
}

function freshAgent(name = `arch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  return createAgent({ name });
}

/** 合成 session JSONL（票 06 的归档缝）：头行 + 用户消息（可埋关键事实）+ 可选 compact summary。 */
function syntheticSessionFile(dir, { userText, summary } = {}) {
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "synthetic-search",
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
    ...(summary
      ? [
          JSON.stringify({
            type: "compaction",
            id: "e2",
            parentId: "e1",
            timestamp: "2026-10-12T00:00:02.000Z",
            summary,
            firstKeptEntryId: "e1",
            tokensBefore: 100,
          }),
        ]
      : []),
  ];
  const filePath = path.join(dir, "session.jsonl");
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  return filePath;
}

function freshSourceDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-search-src-"));
}

test("keyword hits message body with a <mark> snippet and channel/author enrichment (§6.4)", () => {
  const channel = freshChannel();
  sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "今天讨论了全文搜索的实现方案，包括触发器同步和结果摘要。",
  });
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "无关消息" });

  const hits = searchMessages("全文搜索");
  assert.equal(hits.length, 1);
  const hit = hits[0];
  assert.equal(hit.channel?.id, channel.id);
  assert.equal(hit.author?.id, OWNER_MEMBER_ID);
  assert.equal(hit.inThread, false);
  assert.match(hit.snippet, /<mark>全文搜索<\/mark>/);
  assert.match(hit.snippet, /触发器同步/);
});

test("new messages are searchable immediately (trigger sync, §6.4)", () => {
  const channel = freshChannel();
  const sent = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "立即可搜的独特关键词 xylophone-quantum",
  }).message;

  const hits = searchMessages("xylophone-quantum");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, sent.id);
});

test("short CJK tokens (<3 chars) fall back to LIKE and still match (§6.4)", () => {
  const channel = freshChannel();
  sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "提醒功能在 cron 里逐分钟触发",
  });

  // “提醒”是双字词：trigram 需要 ≥3 字符，走 LIKE 兜底路径
  const hits = searchMessages("提醒");
  assert.equal(hits.length, 1);
  assert.match(hits[0].snippet, /<mark>提醒<\/mark>/);

  // 混合长度（含短 token）整体走 LIKE：AND 语义
  const mixed = searchMessages("提醒 cron");
  assert.equal(mixed.length, 1);

  const none = searchMessages("提醒 不存在词xyz");
  assert.equal(none.length, 0);
});

test("thread messages resolve to their anchor channel and report inThread", () => {
  const channel = freshChannel();
  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "锚点消息",
  }).message;
  const reply = sendMessage({
    targetId: anchor.id,
    authorId: OWNER_MEMBER_ID,
    content: "线程里的中子星回复",
  }).message;

  const hits = searchMessages("中子星");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, reply.id);
  assert.equal(hits[0].inThread, true);
  assert.equal(hits[0].channel?.id, channel.id);
});

test("empty/whitespace queries return no hits", () => {
  assert.deepEqual(searchMessages(""), []);
  assert.deepEqual(searchMessages("   "), []);
});

test("snippet escapes message HTML and LIKE wildcards are treated literally", () => {
  const channel = freshChannel();
  sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "<script>alert(1)</script> 命中率 100% 完成",
  });

  const hits = searchMessages("命中率");
  assert.equal(hits.length, 1);
  assert.ok(!hits[0].snippet.includes("<script>"), "raw HTML must not leak into snippet");
  assert.ok(hits[0].snippet.includes("&lt;script&gt;"));

  // “%” 是 LIKE 通配符：应被转义为字面量（兜底路径）
  const percent = searchMessages("%");
  assert.equal(percent.length, 1);
  const underscore = searchMessages("_");
  assert.equal(underscore.length, 0);
});

test("limit clamps to MAX_SEARCH_LIMIT and negative/zero limits are handled", () => {
  const channel = freshChannel();
  for (let i = 0; i < 5; i++) {
    sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: `批量种子消息 ${i}` });
  }
  assert.equal(searchMessages("批量种子").length, 5);
  assert.equal(searchMessages("批量种子", { limit: 2 }).length, 2);
  assert.equal(searchMessages("批量种子", { limit: 0 }).length, 1);
  assert.equal(searchMessages("批量种子", { limit: 999 }).length, 5);
});

test("caller-scoped search hides channels the caller does not belong to (§1.3 不提升调用者权限)", () => {
  const agent = createAgent({ name: `scoped-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  const joined = freshChannel();
  const hidden = freshChannel();
  sendMessage({ targetId: joined.id, authorId: OWNER_MEMBER_ID, content: "生态 scopeprobe joined" });
  sendMessage({ targetId: hidden.id, authorId: OWNER_MEMBER_ID, content: "生态 scopeprobe hidden" });
  joinChannel(joined.id, agent.id);

  // 未给调用者：人类面（Owner）行为不变——看不见的那条也在
  assert.equal(searchMessages("生态 scopeprobe").length, 2);
  // 给了调用者：只剩它所在频道的内容
  const scoped = searchMessages("生态 scopeprobe", { memberId: agent.id });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].channel?.id, joined.id);
  // 加入之后立刻可见（调用者作用域按当前成员资格算）
  joinChannel(hidden.id, agent.id, OWNER_MEMBER_ID);
  assert.equal(searchMessages("生态 scopeprobe", { memberId: agent.id }).length, 2);
});

test("caller-scoped search fetches past the whole-DB limit so hidden hits cannot starve the member's quota", () => {
  const agent = createAgent({ name: `starve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  const visible = freshChannel();
  const hidden = freshChannel();
  // 不可见命中先插（rowid DESC 时更靠前）：若「先按 limit 取全库再过滤」，会挤掉可见结果。
  sendMessage({ targetId: hidden.id, authorId: OWNER_MEMBER_ID, content: "火星 starveprobe one" });
  sendMessage({ targetId: hidden.id, authorId: OWNER_MEMBER_ID, content: "火星 starveprobe two" });
  sendMessage({ targetId: visible.id, authorId: OWNER_MEMBER_ID, content: "火星 starveprobe three" });
  sendMessage({ targetId: visible.id, authorId: OWNER_MEMBER_ID, content: "火星 starveprobe four" });
  joinChannel(visible.id, agent.id);

  assert.equal(searchMessages("火星 starveprobe", { limit: 2 }).length, 2);
  const scoped = searchMessages("火星 starveprobe", { limit: 2, memberId: agent.id });
  assert.equal(scoped.length, 2, "可见命中不得被不可见命中挤掉配额");
  for (const hit of scoped) {
    assert.equal(hit.channel?.id, visible.id);
  }
});

// ---------------------------------------------------------------------------
// 归档会话原文同源可检索（上下文治理票 07；spec B2/B3/B4）
// ---------------------------------------------------------------------------

test("B2：归档会话原文经同一检索面命中——归档＋索引前不可命中，归档后可定位", () => {
  const agent = freshAgent();
  const source = syntheticSessionFile(freshSourceDir(), { userText: "关键事实：检索暗号是 NEBULA-5" });

  assert.deepEqual(searchMessages("NEBULA-5"), [], "归档＋索引前不可经检索面命中");

  archiveAgentSessionFiles(agent.id, [source]);

  const hits = searchMessages("NEBULA-5");
  assert.equal(hits.length, 1);
  const hit = hits[0];
  assert.equal(hit.source, "archive");
  assert.equal(hit.agent_id, agent.id);
  assert.ok(hit.archive_id, "命中携带归档会话标识");
  assert.equal(hit.source_path, source, "定位回原始 session 文件");
  assert.equal(hit.entry_index, 2, "定位到源文件内的具体条目（1 基行号）");
  assert.equal(hit.entry_type, "message");
  assert.match(hit.snippet, /<mark>NEBULA-5<\/mark>/, "命中片段高亮关键事实");
  assert.equal(hit.agent?.id, agent.id, "补 agent 归属供消费面呈现");
});

test("B3：compact summary 文本经同一检索面命中（不单独建 summary 面）", () => {
  const agent = freshAgent();
  const source = syntheticSessionFile(freshSourceDir(), {
    userText: "普通对话，无关键事实",
    summary: "摘要：迁移窗口定在 AURORA-7，之后回滚。",
  });
  archiveAgentSessionFiles(agent.id, [source]);

  const hits = searchMessages("AURORA-7");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, "archive");
  assert.equal(hits[0].entry_type, "compaction", "summary 随归档原文进同一索引面");
  assert.equal(hits[0].agent_id, agent.id);
  assert.match(hits[0].archive_id, new RegExp(`^${agent.id}/[0-9a-f]{64}$`), "命中携带归档副本标识");
});

test("B4：成员面归档作用域——只见自己的归档；owner 面维持全量（不新增 ACL 层）", () => {
  const agentA = freshAgent();
  const agentB = freshAgent();
  archiveAgentSessionFiles(agentA.id, [
    syntheticSessionFile(freshSourceDir(), { userText: "共享暗号 PROBE-X 属于 A" }),
  ]);
  archiveAgentSessionFiles(agentB.id, [
    syntheticSessionFile(freshSourceDir(), { userText: "共享暗号 PROBE-X 属于 B" }),
  ]);

  // owner 面（人类搜索 UI）：全量可见（Owner 语义不变）
  assert.equal(searchMessages("PROBE-X").length, 2);
  // 成员面：同查询只命中自己的归档，非本人归档对成员不可见
  const scoped = searchMessages("PROBE-X", { memberId: agentA.id });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].agent_id, agentA.id);
  assert.equal(searchMessages("PROBE-X", { memberId: agentB.id })[0].agent_id, agentB.id);
});

test("消息与归档同源返回：交替合并，两来源都不被对方挤出 limit 名额", () => {
  const channel = freshChannel();
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "合并探针 COMET-1 消息一" });
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "合并探针 COMET-1 消息二" });
  const agent = freshAgent();
  archiveAgentSessionFiles(agent.id, [
    syntheticSessionFile(freshSourceDir(), { userText: "合并探针 COMET-1 归档原文" }),
  ]);

  const all = searchMessages("COMET-1");
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((hit) => hit.source),
    ["message", "archive", "message"],
    "交替合并：各自内部顺序不变",
  );

  // 消息命中数超过 limit 也不把归档命中挤没（owner 默认 limit=20 的真实场景，spec B2）
  for (let index = 0; index < 3; index += 1) {
    sendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: `合并探针 COMET-1 追加 ${index}`,
    });
  }
  const limited = searchMessages("COMET-1", { limit: 2 });
  assert.equal(limited.length, 2, "limit 收口合并后的总条数");
  assert.deepEqual(limited.map((hit) => hit.source), ["message", "archive"]);

  // 归档面单独可达：查询只命中归档时不依赖消息名额
  const archiveOnly = searchMessages("COMET-1 归档原文");
  assert.equal(archiveOnly.length, 1);
  assert.equal(archiveOnly[0].source, "archive");
});
