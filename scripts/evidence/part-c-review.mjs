// 票 05 / #295 · 证据 C：任务状态权威（确定性、无模型、零成本）
//
// 证明"只有人类 Owner 与当前全局首席可以改任务状态"是服务层强制：
//   - 普通 agent / 频道首席 claim、complete 均被 403 拒绝；
//   - 人类 Owner 通过代认领把 owner 写成 builder；
//   - 当前全局首席把 in_progress 收口到 in_review；
//   - 人类 Owner 再 approve 到 done。
//
// 它跑在独立数据目录、不起服务，因此不触发任何 wake / 模型调用。
//
// 用法：WORKSPLICE_DATA_DIR=/tmp/ws-evidence/data-partc node part-c-review.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.WORKSPLICE_DATA_DIR;
if (!dataDir) {
  console.error("请先设置 WORKSPLICE_DATA_DIR（在独立目录里跑，避免污染正式数据）");
  process.exit(1);
}

const collabUrl = new URL("../../lib/domain/collab/index.ts", import.meta.url);
const {
  CURRENT_MEMBER_ID,
  claimTask,
  claimTaskForAssignee,
  createAgent,
  createChannel,
  createTask,
  getTaskView,
  sendMessage,
  setChannelChief,
  setGlobalChief,
  updateTaskStatus,
} = await import(collabUrl.href);

const MODEL = { provider: "new-api", modelId: "space-bunny-free", thinkingLevel: "low" };
const tag = new Date().toISOString().slice(11, 19).replace(/:/g, "");

const builder = createAgent({ name: `Dev-${tag}`, description: "实现者", ...MODEL });
const channelChief = createAgent({
  name: `ChannelChief-${tag}`,
  description: "频道首席（无任务状态写权）",
  ...MODEL,
});
const globalChief = createAgent({
  name: `GlobalChief-${tag}`,
  description: "当前全局首席（任务状态权威）",
  ...MODEL,
});
const channel = createChannel({
  name: `task-authority-${tag}`,
  type: "public",
  description: "票 05 / #295：任务状态权威",
  memberIds: [builder.id, channelChief.id, globalChief.id],
});
setChannelChief(channel.id, channelChief.id);

const anchor = sendMessage({
  targetId: channel.id,
  authorId: builder.id,
  content: "把 parser.js 的 split 改成引号感知切分。",
  wake: false,
});
const task = createTask({ messageId: anchor.message.id });
console.log(`任务 #${task.number} 建立（作者 @${builder.name}），频道 ${channel.name}\n`);

function expectDenied(label, fn) {
  try {
    const result = fn();
    throw new Error(`${label} 未被拒绝（status=${result?.status ?? "unknown"}）`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.equal(error?.status, 403, `${label} 必须返回 403：${error}`);
    console.log(`${label} → 403（${error.code}）`);
  }
}

expectDenied("1) 普通 agent claim", () =>
  claimTask({ channelId: channel.id, taskNumber: task.number, memberId: builder.id }),
);
expectDenied("2) 频道首席 claim", () =>
  claimTask({ channelId: channel.id, taskNumber: task.number, memberId: channelChief.id }),
);

const assigned = claimTaskForAssignee({
  channelId: channel.id,
  taskNumber: task.number,
  actorId: CURRENT_MEMBER_ID,
  assigneeId: builder.id,
});
assert.equal(assigned.status, "claimed");
assert.equal(assigned.task.owner_id, builder.id);
console.log(`3) Owner 代认领          → owner=@${builder.name}`);

expectDenied("4) 普通 owner complete", () =>
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: task.number,
    status: "in_review",
    memberId: builder.id,
  }),
);
expectDenied("5) 频道首席 complete", () =>
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: task.number,
    status: "in_review",
    memberId: channelChief.id,
  }),
);

setGlobalChief(globalChief.id);
const reviewed = updateTaskStatus({
  channelId: channel.id,
  taskNumber: task.number,
  status: "in_review",
  memberId: globalChief.id,
});
assert.equal(reviewed.status, "updated");
console.log(`6) 全局首席 complete    → ${reviewed.task.status}`);

const approved = updateTaskStatus({
  channelId: channel.id,
  taskNumber: task.number,
  status: "done",
  memberId: CURRENT_MEMBER_ID,
});
assert.equal(approved.status, "updated");
console.log(`7) Owner approve         → ${approved.task.status}`);

const view = getTaskView(task.id);
assert.equal(view.status, "done");
assert.equal(view.owner_id, builder.id);
console.log(`\n最终状态：${view.status}   owner=@${view.owner?.name ?? "—"}`);
console.log(`数据目录：${path.resolve(dataDir)}（存在=${existsSync(dataDir)}）`);
