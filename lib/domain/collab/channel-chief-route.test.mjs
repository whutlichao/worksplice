import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

/**
 * POST /api/channels/[id]/chief（票 #250）的薄路由分支付局：
 * 200（设置 / 清除并回出生效首席）、400（非法入参）、404（频道 / 成员不存在）、
 * 409（人类成员之外的状态冲突：非本频道成员、已软删）。403 由服务层裁决（非 Owner），
 * 人类面进门恒 Owner，故路由侧只透传 `ChannelChiefError.status`。
 * 用 jiti 直接调用真实 route handler，不靠源码正则冒充行为。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-channel-chief-route-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("../../../app/api/channels/[id]/chief/route.ts");
const {
  createAgent,
  createChannel,
  deleteAgent,
  joinChannel,
  setGlobalChief,
} = await import("./index.ts");

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

function makeAgent(prefix, { join = null } = {}) {
  const agent = createAgent({ name: unique(prefix) });
  if (join) joinChannel(join, agent.id);
  return agent;
}

function chiefRequest(id, body) {
  return POST(
    new Request(`http://localhost/api/channels/${encodeURIComponent(id)}/chief`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

test("POST sets a channel chief and answers the effective chief", async () => {
  const channel = createChannel({ name: unique("route-chief-room") });
  const agent = makeAgent("route-chief-agent", { join: channel.id });

  const response = await chiefRequest(channel.id, { memberId: agent.id });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    channelId: channel.id,
    chiefMemberId: agent.id,
    chief: { id: agent.id, name: agent.name },
    chiefSource: "channel",
  });
  assert.equal(globalThis.__workspliceDb.getChannel(channel.id).chief_member_id, agent.id);
});

test("POST with memberId null clears the binding and falls back to the global chief", async () => {
  const globalChief = makeAgent("route-global-chief");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("route-clear-room") });
    const agent = makeAgent("route-clear-agent", { join: channel.id });
    await chiefRequest(channel.id, { memberId: agent.id });

    const response = await chiefRequest(channel.id, { memberId: null });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      channelId: channel.id,
      chiefMemberId: null,
      chief: { id: globalChief.id, name: globalChief.name },
      chiefSource: "global",
    });
    assert.equal(globalThis.__workspliceDb.getChannel(channel.id).chief_member_id, null);

    // 全局也没有 ⇒ 静默（source = none），请求本身仍然成功。
    setGlobalChief(null);
    const silent = await chiefRequest(channel.id, { memberId: null });
    assert.equal(silent.status, 200);
    assert.equal((await silent.json()).chiefSource, "none");
  } finally {
    setGlobalChief(null);
  }
});

test("POST rejects malformed bodies with 400", async () => {
  const channel = createChannel({ name: unique("route-bad-room") });

  for (const body of [{}, { memberId: 42 }, { memberId: "" }, "not-json"]) {
    const response = await chiefRequest(channel.id, body);
    assert.equal(response.status, 400, `body ${JSON.stringify(body)} 应被拒绝`);
    const payload = await response.json();
    assert.match(payload.error, /memberId/);
  }
  assert.equal(
    globalThis.__workspliceDb.getChannel(channel.id).chief_member_id,
    null,
    "非法入参不写绑定",
  );
});

test("POST maps missing channel / member to 404", async () => {
  const channel = createChannel({ name: unique("route-404-room") });

  const missingChannel = await chiefRequest("no-such-channel", { memberId: OWNER_MEMBER_ID });
  assert.equal(missingChannel.status, 404);
  assert.deepEqual(await missingChannel.json(), {
    error: "Channel not found",
    code: "channel_not_found",
  });

  const missingMember = await chiefRequest(channel.id, { memberId: "no-such-member" });
  assert.equal(missingMember.status, 404);
  assert.equal((await missingMember.json()).code, "member_not_found");
});

test("POST maps ineligible targets to 400 / 409 and never half-writes", async () => {
  const channel = createChannel({ name: unique("route-conflict-room") });
  const outsider = makeAgent("route-outsider");
  const deleted = makeAgent("route-deleted", { join: channel.id });
  deleteAgent(deleted.id);

  const human = await chiefRequest(channel.id, { memberId: OWNER_MEMBER_ID });
  assert.equal(human.status, 400);
  assert.equal((await human.json()).code, "human_member");

  const notMember = await chiefRequest(channel.id, { memberId: outsider.id });
  assert.equal(notMember.status, 409);
  assert.equal((await notMember.json()).code, "not_channel_member");

  const deletedTarget = await chiefRequest(channel.id, { memberId: deleted.id });
  assert.equal(deletedTarget.status, 409);
  assert.equal((await deletedTarget.json()).code, "member_deleted");

  assert.equal(
    globalThis.__workspliceDb.getChannel(channel.id).chief_member_id,
    null,
    "三次拒绝都没有留下绑定",
  );
});
