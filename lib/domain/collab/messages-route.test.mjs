import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/messages applies freshness-hold: 409 with held payload on stale baseSeq", async () => {
  const source = await readRoute("messages/route.ts");
  assert.match(source, /sendMessage\(/);
  assert.match(source, /baseSeq: typeof input\.baseSeq === "number"/);
  assert.match(source, /status: 409/);
  assert.match(source, /result\.held/);
  assert.match(source, /whatHappened/);
  assert.match(source, /quoteId/);
});

test("GET /api/channels/[id]/messages supports seq cursor pagination params", async () => {
  const source = await readRoute("channels/[id]/messages/route.ts");
  assert.match(source, /searchParams\.get\("before"\)/);
  assert.match(source, /searchParams\.get\("limit"\)/);
  assert.match(source, /searchParams\.get\("targetId"\)/);
  assert.match(source, /Message does not belong to this channel/);
  assert.match(source, /listMessages\(/);
});

test("§09 abandoned marks ride on listMessages: service attaches them, route passes through", async () => {
  const messages = await readFile(
    new URL("../../domain/collab/messages.ts", import.meta.url),
    "utf-8",
  );
  assert.match(messages, /listAbandonedMarks\(/);
  assert.match(messages, /abandonedMarks: marksBySeq\.get\(row\.seq\)/);
});

test("join/leave/archive routes default to the owner as the current member", async () => {
  const join = await readRoute("channels/[id]/join/route.ts");
  const leave = await readRoute("channels/[id]/leave/route.ts");
  const archive = await readRoute("channels/[id]/archive/route.ts");
  for (const source of [join, leave, archive]) {
    assert.match(source, /CURRENT_MEMBER_ID/);
  }
  assert.match(join, /joinChannel\(id, memberId, CURRENT_MEMBER_ID\)/);
  assert.match(leave, /leaveChannel\(id, memberId, CURRENT_MEMBER_ID\)/);
  assert.match(archive, /setChannelArchived\(id, body\.archived !== false, CURRENT_MEMBER_ID\)/);
});

test("thread read route and single message route exist", async () => {
  const thread = await readRoute("messages/[id]/thread/route.ts");
  const single = await readRoute("messages/[id]/route.ts");
  assert.match(thread, /getThreadInfo\(/);
  assert.match(single, /getMessageWithAuthor\(/);
  assert.match(single, /status: 404/);
});

test("POST /api/channels accepts initial memberIds", async () => {
  const source = await readRoute("channels/route.ts");
  assert.match(source, /memberIds/);
  assert.match(source, /listChannelsWithMeta/);
});

test("mute route: GET lists agent mute states; POST toggles for a member as the owner", async () => {
  const source = await readRoute("channels/[id]/mute/route.ts");
  assert.match(source, /muteChannel\(id, body\.memberId, actorId\)/);
  assert.match(source, /unmuteChannel\(id, body\.memberId, actorId\)/);
  assert.match(source, /CURRENT_MEMBER_ID/);
  assert.match(source, /member\.type === "agent"/);
  assert.match(source, /listChannelMutes\(/);
  assert.match(source, /status: 404/);
});

/**
 * 票 #251 的红线：composer 的首席提示**只说明**——不拦截发送、不改写正文、不因为打字
 * 发额外请求。这里用真实 `POST /api/messages` + 真实服务层取证：频道配上首席之后，
 * 一条无人点名的消息落库的正文与请求体逐字一致，首席配置没有插进发送路径。
 */
test("chief hint does not touch the send path: unmentioned content lands verbatim", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createJiti } = await import("jiti");
  const { openDataDb } = await import("../../data/sqlite.ts");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-send-path-"));
  globalThis.__workspliceDb = openDataDb(root);
  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const { POST } = await jiti.import("../../../app/api/messages/route.ts");
    const {
      createAgent,
      createChannel,
      joinChannel,
      listMessages,
      sendMessage,
      setChannelChief,
    } = await import("./index.ts");

    const channel = createChannel({ name: "send-path-room" });
    const chief = createAgent({ name: "send-path-chief" });
    joinChannel(channel.id, chief.id);
    setChannelChief(channel.id, chief.id);

    const content = "怎么给你们这个 channel 设置工作路径？  @ 不是点名, 也不改标点。";
    // 服务层直发：正文逐字落库，首席配置不参与正文
    const result = sendMessage({ targetId: channel.id, authorId: "owner", content });
    assert.equal(result.held, false);
    assert.equal(result.message.content, content);

    // 同一个频道再走 HTTP 薄封装（客户端 composer 的实际路径）：请求体里的正文不改写
    const response = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetId: channel.id,
          content: "第二条：没人点名。",
        }),
      }),
    );
    assert.equal(response.status, 201);
    const latest = listMessages(channel.id).messages.at(-1);
    assert.equal(latest.content, "第二条：没人点名。");
    assert.equal(latest.author_id, "owner");
  } finally {
    globalThis.__workspliceDb.close();
    delete globalThis.__workspliceDb;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
