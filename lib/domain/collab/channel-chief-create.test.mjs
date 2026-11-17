import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

/**
 * 建频道时指定首席（票 #252）的服务 / 路由 seam。
 *
 * 断言的是**外部行为**：建出来的频道此刻生效的首席是谁（`resolveEffectiveChief`）、
 * 绑定有没有写、被拒绝时频道到底有没有被创建。绑定校验在写库前完成，所以非法目标
 * 不可能留下「建了一半的频道 / 半条绑定」。
 *
 * 最后一条是路由接线断言（与 repo 里既有接线断言同档）：真实行为由上面的路由用例跑。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-create-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("../../../app/api/channels/route.ts");
const {
  createAgent,
  createChannel,
  deleteAgent,
  getChannel,
  listChannels,
  resolveEffectiveChief,
  setGlobalChief,
} = await import("./index.ts");

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

function makeAgent(prefix) {
  return createAgent({ name: unique(prefix) });
}

function channelNames() {
  return listChannels().map((channel) => channel.name);
}

function createRequest(body) {
  return POST(
    new Request("http://localhost/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// ─── 服务层：createChannel({ chiefMemberId }) ────────────────────────────────

test("createChannel binds a legal chief and the channel resolves it as its own", () => {
  setGlobalChief(null);
  const agent = makeAgent("create-chief-agent");

  const channel = createChannel({
    name: unique("create-chief-room"),
    type: "public",
    memberIds: [agent.id],
    chiefMemberId: agent.id,
  });

  assert.equal(getChannel(channel.id).chief_member_id, agent.id);
  assert.equal(
    channel.chief_member_id,
    agent.id,
    "createChannel 返回的行也带绑定，调用方拿不到半个真相",
  );
  const effective = resolveEffectiveChief(channel.id);
  assert.equal(effective.source, "channel");
  assert.equal(effective.chief.id, agent.id);
});

test("createChannel without a chief leaves the binding empty and falls back to the global chief", () => {
  const globalChief = makeAgent("create-fallback-global");
  setGlobalChief(globalChief.id);
  try {
    const omitted = createChannel({ name: unique("create-no-chief-room") });
    assert.equal(getChannel(omitted.id).chief_member_id, null);
    assert.equal(resolveEffectiveChief(omitted.id).source, "global");
    assert.equal(resolveEffectiveChief(omitted.id).chief.id, globalChief.id);

    const explicitNull = createChannel({
      name: unique("create-null-chief-room"),
      chiefMemberId: null,
    });
    assert.equal(getChannel(explicitNull.id).chief_member_id, null);
    assert.equal(resolveEffectiveChief(explicitNull.id).source, "global");
  } finally {
    setGlobalChief(null);
  }
});

test("createChannel rejects an illegal chief before writing anything", () => {
  setGlobalChief(null);
  const member = makeAgent("create-member");
  const outsider = makeAgent("create-outsider");
  const deleted = makeAgent("create-deleted");
  deleteAgent(deleted.id);

  const cases = [
    { code: "human_member", chiefMemberId: OWNER_MEMBER_ID, memberIds: [member.id] },
    { code: "member_deleted", chiefMemberId: deleted.id, memberIds: [member.id] },
    { code: "not_channel_member", chiefMemberId: outsider.id, memberIds: [member.id] },
    { code: "member_not_found", chiefMemberId: "no-such-member", memberIds: [member.id] },
  ];

  for (const testCase of cases) {
    const name = unique(`rej-${testCase.code}`);
    const before = channelNames();
    assert.throws(
      () =>
        createChannel({
          name,
          type: "private",
          memberIds: testCase.memberIds,
          chiefMemberId: testCase.chiefMemberId,
        }),
      (error) => error.code === testCase.code,
      `必须以 ${testCase.code} 拒绝`,
    );
    assert.deepEqual(channelNames(), before, `${testCase.code}：频道不得被创建`);
    assert.equal(
      listChannels().some((channel) => channel.name === name),
      false,
      `${testCase.code}：库里不得留下建了一半的频道`,
    );
  }
});

// ─── 路由：POST /api/channels { chiefMemberId } ──────────────────────────────

test("POST /api/channels creates a channel with the requested chief", async () => {
  setGlobalChief(null);
  const agent = makeAgent("route-create-agent");

  const response = await createRequest({
    name: unique("route-create-room"),
    type: "public",
    memberIds: [agent.id],
    chiefMemberId: agent.id,
  });
  assert.equal(response.status, 201);
  const { channel } = await response.json();
  assert.equal(getChannel(channel.id).chief_member_id, agent.id);
  assert.equal(resolveEffectiveChief(channel.id).source, "channel");
});

test("POST /api/channels rejects an illegal chief with a readable code and creates nothing", async () => {
  setGlobalChief(null);
  const member = makeAgent("route-create-member");
  const name = unique("route-create-rejected");

  const response = await createRequest({
    name,
    type: "private",
    memberIds: [member.id],
    chiefMemberId: OWNER_MEMBER_ID,
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "human_member");
  assert.match(payload.error, /agent/i);
  assert.equal(channelNames().includes(name), false);
});

test("POST /api/channels passes the chief selection through and translates rejections", async () => {
  const source = await readFile(
    new URL("../../../app/api/channels/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /chiefMemberId/,
    "建频道路由必须把 chiefMemberId 传给 createChannel（票 #252）",
  );
  assert.match(
    source,
    /jsonError\(error, 400\)/,
    "非法目标要经 jsonError 按协作域的拒绝语义回 4xx + code，而不是一律 400",
  );
});
