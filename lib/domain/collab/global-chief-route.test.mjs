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
 * 400（入参形态非法、目标不是存活 agent）。用 jiti 直接调用真实 route handler，
 * 不靠源码正则冒充行为；另有一条源码级断言守「路由只做薄封装、不自己写库」。
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
const { createAgent, deleteAgent, getGlobalChief, getOwner, setGlobalChief } =
  await import("./index.ts");

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

test("POST rejects a human member, a soft-deleted agent and an unknown id without writing", async () => {
  const keep = makeAgent("global-chief-route-keep");
  setGlobalChief(keep.id);
  const deleted = makeAgent("global-chief-route-deleted");
  deleteAgent(deleted.id);
  const owner = getOwner();

  for (const [label, memberId] of [
    ["human member", owner.id],
    ["soft-deleted agent", deleted.id],
    ["unknown id", "member-does-not-exist"],
  ]) {
    const response = await chiefRequest({ memberId });
    assert.equal(response.status, 400, label);
    const body = await response.json();
    assert.match(body.error, /live agent/, `${label} 的原因要可读`);
    assert.equal(
      getGlobalChief()?.id,
      keep.id,
      `${label} 被拒时不得改掉当前的全局首席`,
    );
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
