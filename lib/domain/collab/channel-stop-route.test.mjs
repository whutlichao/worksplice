import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

/**
 * POST /api/channels/[id]/stop 的薄路由分支付局：
 * 200（停止 / 幂等 no-op）、404（频道不存在）、403（DM 不可停）、500（服务异常可读）。
 * 用 jiti 直接调用真实 route handler，不靠源码正则冒充行为。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-stop-route-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import(
  "../../../app/api/channels/[id]/stop/route.ts",
);
const {
  createAgent,
  createChannel,
  createDirectChannel,
  createRoomTurnStore,
  joinChannel,
  sendMessage,
  setRoomTurnStore,
} = await import("./index.ts");

function stopRequest(id) {
  return POST(new Request(`http://localhost/api/channels/${encodeURIComponent(id)}/stop`, {
    method: "POST",
  }), { params: Promise.resolve({ id }) });
}

test("POST /api/channels/[id]/stop stops the current turn and is idempotent", async () => {
  setRoomTurnStore(createRoomTurnStore());
  try {
    const agent = createAgent({ name: "route-stop-agent" });
    const channel = createChannel({ name: "route-stop-room" });
    joinChannel(channel.id, agent.id);
    sendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: `@${agent.name} take a look`,
    });

    const first = await stopRequest(channel.id);
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.stopped, true);
    assert.equal(typeof firstBody.epoch, "number");

    const second = await stopRequest(channel.id);
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.stopped, false);
    assert.equal(secondBody.epoch, firstBody.epoch);
  } finally {
    setRoomTurnStore(null);
  }
});

test("POST /api/channels/[id]/stop maps missing channel to 404", async () => {
  const response = await stopRequest("no-such-channel");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Channel not found",
    code: "channel_not_found",
  });
});

test("POST /api/channels/[id]/stop maps DM to 403", async () => {
  const agent = createAgent({ name: "route-dm-agent" });
  const dm = createDirectChannel(agent.id);
  const response = await stopRequest(dm.id);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Cannot stop a DM channel",
    code: "dm_not_stoppable",
  });
});

test("POST /api/channels/[id]/stop maps unexpected service errors to readable 500", async () => {
  const agent = createAgent({ name: "route-error-agent" });
  const channel = createChannel({ name: "route-error-room" });
  joinChannel(channel.id, agent.id);
  setRoomTurnStore({
    stopTurn() {
      throw new Error("room store exploded");
    },
  });
  try {
    const response = await stopRequest(channel.id);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "room store exploded" });
  } finally {
    setRoomTurnStore(null);
  }
});
