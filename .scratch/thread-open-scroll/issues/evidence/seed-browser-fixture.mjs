// 浏览器验收夹具（票据 `.scratch/thread-open-scroll/issues/01-thread-open-scroll.md` 的证据脚本）。
//
// 用法（必须显式指定隔离数据目录，拒绝写默认目录 ~/.worksplice）：
//   WORKSPLICE_DATA_DIR=/tmp/wsp-thread-open-scroll node .scratch/thread-open-scroll/issues/evidence/seed-browser-fixture.mjs
//
// 与 `scripts/seed-demo.mjs` 同纪律：门禁先于一切 import；**不调用真实模型**（全部 wake:false）。
// 与 seed-demo 的差异：本夹具按票面要求「假消息直接落库」——绕过 协作域 写接口，
// 直接经数据层 appendMessage 造场景（含精确控制 task_thread_reads.read_seq 的未读基线），
// 因为域层没有「把游标设成任意值」的入口（也不该有）。
//
// 三个场景落在同一个 channel 里，各自一个 Task 锚点：
//   #1 未读：8 条已读历史 + 3 条未读回复 + 8 条 Owner 尾部回复
//      ——未读批次夹在中间（后面还有内容），所以「贴最早未读」不会被滚动上限截断，
//      与「贴底」是两个可区分的落点；更早的已读历史留在窗口上方。
//   #2 全已读：12 条历史，游标推到最新 ⇒ 打开应停在底部
//   #3 普通 thread：非 Task 锚点，12 条回复 ⇒ 打开应停在底部

import { createJiti } from "jiti";
import path from "node:path";

const dataDirOverride = process.env.WORKSPLICE_DATA_DIR;
if (!dataDirOverride) {
  console.error(
    "夹具拒绝污染默认数据目录：请先设置 WORKSPLICE_DATA_DIR=<dir> 再运行，例如\n" +
      "  WORKSPLICE_DATA_DIR=/tmp/wsp-thread-open-scroll node .scratch/thread-open-scroll/issues/evidence/seed-browser-fixture.mjs",
  );
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { openDataDb } = await jiti.import(path.join(repoRoot, "lib/data/sqlite.ts"));
const { OWNER_MEMBER_ID } = await jiti.import(path.join(repoRoot, "lib/data/schema.ts"));

const store = openDataDb(path.resolve(dataDirOverride));
globalThis.__workspliceDb = store;

const owner = store.getMember(OWNER_MEMBER_ID);
if (!owner) throw new Error("owner member missing");

const agent = store.insertMember({ type: "agent", name: "fixture-agent" });
const channel = store.insertChannel({
  name: "fixture-room",
  description: "thread-open-scroll 隔离夹具",
});
store.addChannelMember(channel.id, OWNER_MEMBER_ID);
store.addChannelMember(channel.id, agent.id);

/** 顶层消息（锚点/频道消息）。 */
function top(content, authorId = OWNER_MEMBER_ID) {
  return store.appendMessage({ targetId: channel.id, authorId, content });
}

/** 线程回复：target = 锚点消息 id，线程自己有独立 seq 空间。 */
function reply(anchor, content, authorId = agent.id) {
  return store.appendMessage({ targetId: anchor.id, authorId, content });
}

const scenario = {};

// ── #1 有未读：8 条已读历史 + 3 条未读回复 + 8 条 Owner 尾部回复 ───────────
{
  const anchor = top("TASK 1 — 有未读回复：打开应停在最早一条未读上");
  const readHistory = [];
  for (let i = 1; i <= 8; i += 1) readHistory.push(reply(anchor, `已读历史 ${i}/8`));
  const task = store.insertTask({ messageId: anchor.id, number: 1 });
  // 基线 = 最新非 Owner 回复（域层同款），再把游标停回已读的进度。
  store.advanceTaskThreadRead(task.id, readHistory[7].seq, OWNER_MEMBER_ID);
  const firstUnread = reply(anchor, "未读回复 A —— 打开后这条应贴近滚动区顶部，不手动滚动即可看见");
  const secondUnread = reply(anchor, "未读回复 B —— 更晚的一条，应在 A 下方");
  const lastUnread = reply(anchor, "未读回复 C —— 本批未读的最后一条");
  // 尾部 Owner 回复不计未读，只把内容撑长，让「贴最早未读」有足够滚动空间（不撞滚动上限）。
  for (let i = 1; i <= 8; i += 1) reply(anchor, `尾部 Owner 回复 ${i}/8`, OWNER_MEMBER_ID);
  scenario.unread = {
    channelId: channel.id,
    anchorSeq: anchor.seq,
    firstUnreadSeq: firstUnread.seq,
    secondUnreadSeq: secondUnread.seq,
    lastUnreadSeq: lastUnread.seq,
    readSeq: store.getTaskThreadRead(task.id).read_seq,
    readHistorySeqs: readHistory.map((m) => m.seq),
  };
}

// ── #2 全部已读：打开应停在底部 ───────────────────────────────────────────
{
  const anchor = top("TASK 2 — 全部已读：打开应停在最新回复（底部）");
  const history = [];
  for (let i = 1; i <= 12; i += 1) history.push(reply(anchor, `全已读历史 ${i}/12`));
  const task = store.insertTask({ messageId: anchor.id, number: 2 });
  store.advanceTaskThreadRead(task.id, history[11].seq, OWNER_MEMBER_ID);
  scenario.allRead = {
    channelId: channel.id,
    anchorSeq: anchor.seq,
    latestSeq: history[11].seq,
    readSeq: store.getTaskThreadRead(task.id).read_seq,
  };
}

// ── #3 普通非 Task thread：打开应停在底部 ─────────────────────────────────
{
  const anchor = top("普通 THREAD — 不是 Task：打开应停在底部，即使有更晚的非 Owner 回复");
  const history = [];
  for (let i = 1; i <= 12; i += 1) history.push(reply(anchor, `普通回复 ${i}/12`));
  scenario.plainThread = {
    channelId: channel.id,
    anchorSeq: anchor.seq,
    latestSeq: history[11].seq,
  };
}

console.log(JSON.stringify(scenario, null, 2));
store.close();
delete globalThis.__workspliceDb;
