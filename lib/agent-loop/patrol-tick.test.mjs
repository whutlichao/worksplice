import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";

/**
 * 巡检挂在**既有**每分钟低频维护节拍上（票 #267）：不新起定时器，`tickAgentLoopMaintenance`
 * 一轮里除提醒 cron 与 handoff 恢复扫描外，还跑一次巡检。
 *
 * 这条用例只钉「接线存在且真的跑到判定结果的投递面」；巡检自身的判定 / 落点 / 去重
 * 由 `lib/domain/collab/patrol*.test.mjs` 覆盖。
 */

let root;
let fixtureSeq = 0;

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-patrol-tick-"));
  globalThis.__workspliceDb = openDataDb(root);
  setPatrolSignatureStore(null);
});

test.afterEach(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
  setPatrolSignatureStore(null);
});

const { setPatrolSignatureStore } = await import("../domain/collab/patrol-run.ts");
const {
  createAgent,
  createChannel,
  createTask,
  joinChannel,
  listMessages,
  sendMessage,
  setGlobalChief,
} = await import("../domain/collab/index.ts");
const { tickAgentLoopMaintenance } = await import("./loop.ts");

function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

test("低频维护 tick 跑一轮巡检：卡住任务落成一条频道汇总", () => {
  const chief = createAgent({ name: unique("chief") });
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("team") });
  joinChannel(channel.id, chief.id);

  const sent = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "nobody picked this up",
  });
  assert.equal(sent.held, false);
  const task = createTask({ messageId: sent.message.id });
  globalThis.__workspliceDb.updateTask(task.id, {
    updatedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
  });

  const before = listMessages(channel.id).messages.length;
  const ticked = tickAgentLoopMaintenance(new Date());

  assert.equal(ticked.patrol.status, "reported");
  const messages = listMessages(channel.id).messages;
  assert.equal(messages.length, before + 1);
  assert.match(messages[messages.length - 1].content, /^Task patrol: 1 stalled task/);

  // 同一状态再 tick 一次不重报（签名集跨 tick 存活）。
  assert.equal(tickAgentLoopMaintenance(new Date()).patrol.reported, 0);
  assert.equal(listMessages(channel.id).messages.length, before + 1);
});
