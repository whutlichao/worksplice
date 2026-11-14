import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { openDataDb } from "../../data/sqlite.ts";

/**
 * POST /api/global-chief（票 #251）的薄路由分发布局：200（设置 / 清空并回出当前首席）、
 * 400 / 404 / 409（拒绝目标：人类成员 / 不存在的 id / 已软删身份，各自带 `code`）。
 * 用 jiti 直接调用真实 route handler，不靠源码正则冒充行为；另有一条源码级断言守
 * 「路由只做薄封装、不自己写库」。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-global-chief-route-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const routeSourceUrl = new URL("../../../app/api/global-chief/route.ts", import.meta.url);
const { POST } = await jiti.import(routeSourceUrl.href);
const { POST: channelChiefPost } = await jiti.import(
  "../../../app/api/channels/[id]/chief/route.ts",
);
const {
  createAgent,
  createChannel,
  deleteAgent,
  getGlobalChief,
  getOwner,
  joinChannel,
  listChannelsWithMeta,
  setGlobalChief,
} = await import("./index.ts");
const { OWNER_MEMBER_ID } = await import("../../data/schema.ts");

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

function makeAgent(prefix) {
  return createAgent({ name: unique(prefix) });
}

function chiefRequest(body) {
  return POST(
    new Request("http://localhost/api/global-chief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

test("POST sets the global chief and answers the current one", async () => {
  const agent = makeAgent("global-chief-route-set");

  const response = await chiefRequest({ memberId: agent.id });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    chief: { id: agent.id, name: agent.name },
  });
  assert.equal(getGlobalChief()?.id, agent.id);
});

test("POST 换人即换：同一时刻至多一位，上一位自动让位", async () => {
  const first = makeAgent("global-chief-route-first");
  const second = makeAgent("global-chief-route-second");

  await chiefRequest({ memberId: first.id });
  const response = await chiefRequest({ memberId: second.id });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    chief: { id: second.id, name: second.name },
  });
  assert.equal(getGlobalChief()?.id, second.id, "上一位必须同时被清掉");
});

test("POST with memberId null clears the global chief (频道回到「没有默认收件人」)", async () => {
  const agent = makeAgent("global-chief-route-clear");
  await chiefRequest({ memberId: agent.id });

  const response = await chiefRequest({ memberId: null });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { chief: null });
  assert.equal(getGlobalChief(), undefined);
});

test("POST 拒绝非法目标：人类成员 400 / 已软删 409 / 不存在的 id 404，各带稳定 code 且不写库", async () => {
  const keep = makeAgent("global-chief-route-keep");
  setGlobalChief(keep.id);
  const deleted = makeAgent("global-chief-route-deleted");
  deleteAgent(deleted.id);
  const owner = getOwner();

  for (const [label, memberId, status, code] of [
    ["human member", owner.id, 400, "human_member"],
    ["soft-deleted agent", deleted.id, 409, "member_deleted"],
    ["unknown id", "member-does-not-exist", 404, "member_not_found"],
  ]) {
    const response = await chiefRequest({ memberId });
    assert.equal(response.status, status, label);
    const body = await response.json();
    assert.equal(body.code, code, `${label} 要有稳定 code（UI 按 code 选文案）`);
    assert.ok(body.error, `${label} 的原因要可读`);
    assert.equal(
      getGlobalChief()?.id,
      keep.id,
      `${label} 被拒时不得改掉当前的全局首席`,
    );
  }
});

test("同一语义错误在两条 chief 写面上同状态码同 code（跨路由一致，§1）", async () => {
  const channel = createChannel({ name: unique("global-chief-parity-room") });
  const deleted = makeAgent("global-chief-parity-deleted");
  deleteAgent(deleted.id);
  const owner = getOwner();

  // 频道路由的同类拒绝：不存在的成员 / 人类成员 / 已软删身份
  const channelAnswer = async (memberId) => {
    const response = await channelChiefPost(
      new Request(`http://localhost/api/channels/${channel.id}/chief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId }),
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );
    return { status: response.status, ...(await response.json()) };
  };

  for (const memberId of ["member-does-not-exist", owner.id, deleted.id]) {
    const global = await chiefRequest({ memberId });
    const globalBody = await global.json();
    const local = await channelAnswer(memberId);
    assert.equal(
      global.status,
      local.status,
      `${memberId}: 同语义错误必须同状态码（global ${global.status} vs channel ${local.status}）`,
    );
    assert.equal(globalBody.code, local.code, `${memberId}: code 也必须同义`);
  }
});

test("POST rejects malformed bodies (missing memberId / empty string / wrong type)", async () => {
  for (const body of [{}, { memberId: "" }, { memberId: 42 }, "not json"]) {
    const response = await chiefRequest(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok((await response.json()).error);
  }
});

test("global-chief 路由是薄封装：写面只有协作域服务层，不直接摸数据层", async () => {
  const source = await readFile(routeSourceUrl, "utf-8");

  assert.match(source, /setGlobalChief\(/);
  assert.match(source, /getGlobalChief\(/);
  // 薄封装：不在路由里访问 Store / 表 / SQL（唯一写面是协作域）
  assert.doesNotMatch(source, /getDb|better-sqlite3|globalThis\.__workspliceDb/);
  assert.doesNotMatch(source, /UPDATE\s+members|INSERT\s+INTO/i);
});

test("换人 / 清空后，回落全局首席的频道行跟着变（composer 提示读的就是这一行）", async () => {
  const channel = createChannel({ name: unique("global-chief-room") });
  const first = makeAgent("global-chief-fallback-first");
  const second = makeAgent("global-chief-fallback-second");
  joinChannel(channel.id, first.id);
  joinChannel(channel.id, second.id);
  const rowOf = () =>
    listChannelsWithMeta(OWNER_MEMBER_ID).find((row) => row.id === channel.id);

  await chiefRequest({ memberId: first.id });
  assert.deepEqual(rowOf().chief, { id: first.id, name: first.name });
  assert.equal(rowOf().chiefSource, "global");

  // 换人：所有回落全局的频道跟着换
  await chiefRequest({ memberId: second.id });
  assert.deepEqual(rowOf().chief, { id: second.id, name: second.name });

  // 清空：回到静默（没有默认收件人），不留上一位的影子
  await chiefRequest({ memberId: null });
  assert.equal(rowOf().chief, null);
  assert.equal(rowOf().chiefSource, "none");
});
