import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { mergeChannelRows, shallowEqualChannel } =
  await jiti.import("./channel-list.ts");

/** DM 行构造器：与 /api/channels 返回形态同形（ChannelWithMeta）。 */
function dm(messageCount) {
  return {
    id: "dm:owner↔agent",
    name: "dm:owner↔agent",
    type: "dm",
    description: "",
    archived: 0,
    created_at: "2026-08-03T00:00:00.000Z",
    joined: true,
    memberCount: 2,
    unread: 0,
    messageCount,
  };
}

// 红-绿切片 1：发送消息后服务端 messageCount 0→1，merge 必须把「有消息」信号传播进侧栏
test("mergeChannelRows 传播 messageCount（owner 发送消息后侧栏 DM「有消息」信号即时更新）", () => {
  const prev = [dm(0)];
  const fresh = [dm(1)];
  const merged = mergeChannelRows(prev, fresh);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].messageCount, 1);
});

// 红-绿切片 2：未变更行保持对象引用（避免 ChannelView 因 channel prop 变化重建 loader）
test("mergeChannelRows 未变更行复用旧对象引用（引用稳定铁律）", () => {
  const prev = [dm(3)];
  const fresh = [dm(3)];
  const merged = mergeChannelRows(prev, fresh);
  assert.equal(merged, prev);
  assert.equal(merged[0], prev[0]);
});

// 红-绿切片 3：新增行（如懒创建的 DM）被并入，旧列表语义保留
test("mergeChannelRows 并入新行并保留既有行", () => {
  const all = { ...dm(0), id: "#all", name: "#all", type: "public" };
  const prev = [all];
  const fresh = [all, dm(1)];
  const merged = mergeChannelRows(prev, fresh);
  assert.deepEqual(
    merged.map((c) => c.id),
    ["#all", "dm:owner↔agent"],
  );
  assert.equal(merged[0], prev[0]);
  assert.equal(merged[1].messageCount, 1);
});

// 红-绿切片 4：shallowEqualChannel 必须纳入 messageCount——否则发送后信号冻结在旧值
test("shallowEqualChannel 感知 messageCount 变化（否则侧栏 DM 分组冻结）", () => {
  assert.equal(shallowEqualChannel(dm(0), dm(1)), false);
  assert.equal(shallowEqualChannel(dm(0), dm(0)), true);
});
