#!/bin/bash
# 浏览器验收的一键复现（隔离临时数据目录；不碰 live data、不建会话、不调真实模型）。
#
# 用法：bash .scratch/thread-open-scroll/issues/evidence/run-browser-acceptance.sh
#
# 做三件事：
#   ① 重建 /tmp/wsp-thread-open-scroll（假消息直接落库，见 seed-browser-fixture.mjs）；
#   ② 用该数据目录起 dev（30142）；
#   ③ 用 ego-browser 驱动真实浏览器量三个落点 + 轮询不抢滚动，结果打到 stdout。
set -e
cd /Users/apple/orca/workspaces/worksplice/thread-open-scroll

pkill -f "next dev -H 127.0.0.1 -p 30142" || true
sleep 2
rm -rf /tmp/wsp-thread-open-scroll
mkdir -p /tmp/wsp-thread-open-scroll
WORKSPLICE_DATA_DIR=/tmp/wsp-thread-open-scroll \
  node .scratch/thread-open-scroll/issues/evidence/seed-browser-fixture.mjs > /tmp/wsp-fixture.json
CID=$(python3 -c "import json;print(json.load(open('/tmp/wsp-fixture.json'))['unread']['channelId'])")
echo "CID=$CID"

WORKSPLICE_DATA_DIR=/tmp/wsp-thread-open-scroll nohup npm run dev > /tmp/wsp-thread-open-scroll-dev.log 2>&1 &
for _ in $(seq 1 40); do
  if curl -sf -o /dev/null http://127.0.0.1:30142/api/channels; then break; fi
  sleep 1
done
curl -sf -o /dev/null http://127.0.0.1:30142/api/channels || { echo "DEV TIMEOUT"; exit 1; }

ego-browser nodejs <<EOF
const task = await taskSpace(21);
const page = task.page("p1");
const snap = () => {
  const sc = document.querySelector(".tt-scroll");
  const r = sc.getBoundingClientRect();
  const rows = [...sc.querySelectorAll("[data-thread-message-seq]")];
  const v = rows.filter((n) => n.getBoundingClientRect().bottom > r.top && n.getBoundingClientRect().top < r.bottom);
  return {
    rowCount: rows.length,
    title: document.querySelector(".tt-title")?.textContent,
    scrollTop: Math.round(sc.scrollTop),
    maxScrollTop: Math.round(sc.scrollHeight - sc.clientHeight),
    atBottom: Math.abs(sc.scrollTop + sc.clientHeight - sc.scrollHeight) <= 2,
    firstVisibleSeq: v.length ? Number(v[0].dataset.threadMessageSeq) : null,
    firstVisibleOffsetFromTop: v.length ? Math.round(v[0].getBoundingClientRect().top - r.top) : null,
    seqsAboveViewport: rows.filter((n) => n.getBoundingClientRect().bottom <= r.top).map((n) => Number(n.dataset.threadMessageSeq)),
    visibleSeqs: v.map((n) => Number(n.dataset.threadMessageSeq)),
  };
};
const waitRows = (n) => page.waitForFunction(
  (want) => document.querySelectorAll(".tt-scroll [data-thread-message-seq]").length === want,
  n, { timeout: 20000 },
);
const out = {};

// 场景 1：Task #1 有未读（8 条已读历史 + 3 条未读 + 8 条 Owner 尾部 = 19 行）
await page.goto("http://127.0.0.1:30142/#c/${CID}");
await page.waitForSelector('loc=role:button[name*="打开任务 #1 的讨论"]', { state: "visible" });
await page.click('loc=role:button[name*="打开任务 #1 的讨论"]');
await waitRows(19); await page.waitForTimeout(1500);
out.s1_taskUnread = await page.evaluate(snap);
out.s1_shot = await page.screenshot({ path: "/tmp/wsp-1-unread.png" });

// 用户上翻后，3s 线程轮询不得抢滚动
await page.evaluate(() => { document.querySelector(".tt-scroll").scrollTop = 300; });
await page.waitForTimeout(300);
out.s1_afterUserScroll = await page.evaluate(snap);
await page.waitForTimeout(7500);
out.s1_afterPolls = await page.evaluate(snap);

// 场景 2：Task #2 全已读（12 行）⇒ 底部
await page.click('loc=role:button[name*="打开任务 #2 的讨论"]');
await waitRows(12); await page.waitForTimeout(1200);
out.s2_taskAllRead = await page.evaluate(snap);
out.s2_shot = await page.screenshot({ path: "/tmp/wsp-2-allread.png" });

// 场景 3：普通非 Task thread（12 行）⇒ 底部
await page.goto("http://127.0.0.1:30142/#c/${CID}");
await page.waitForTimeout(1200);
await page.click('[title="展开线程回复"] >> nth=2');
await waitRows(12); await page.waitForTimeout(1200);
out.s3_plainThread = await page.evaluate(snap);
out.s3_shot = await page.screenshot({ path: "/tmp/wsp-3-plain.png" });

console.log(JSON.stringify({ spaceId: task.spaceId, out }, null, 1));
EOF
