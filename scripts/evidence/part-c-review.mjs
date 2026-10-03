// 票 05 · 证据 C：互审规则（确定性、无模型、零成本）
//
// 证明"构建者不验证自己"不是 UI 约定，而是服务层强制：
//   任务由 A 认领 → A 完成（进 in_review）→ A 自己 approve 被**拒** →
//   必须由另一个成员 B approve 才能进 done。
//
// 它跑在独立数据目录、不起服务，因此不触发任何 wake / 模型调用。
//
// 用法：WORKSPLICE_DATA_DIR=/tmp/ws-evidence/data-partc node part-c-review.mjs
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.WORKSPLICE_DATA_DIR;
if (!dataDir) {
  console.error("请先设置 WORKSPLICE_DATA_DIR（在独立目录里跑，避免污染正式数据）");
  process.exit(1);
}

const collabUrl = new URL("../../lib/domain/collab/index.ts", import.meta.url);
const {
  createAgent,
  createChannel,
  sendMessage,
  createTask,
  claimTask,
  updateTaskStatus,
  getTaskView,
} = await import(collabUrl.href);

const MODEL = { provider: "new-api", modelId: "space-bunny-free", thinkingLevel: "low" };
const tag = new Date().toISOString().slice(11, 19).replace(/:/g, "");

const A = createAgent({ name: `Dev-${tag}`, description: "实现者", ...MODEL });
const B = createAgent({ name: `Reviewer-${tag}`, description: "审者", ...MODEL });
const channel = createChannel({
  name: `review-rules-${tag}`,
  type: "public",
  description: "票 05 证据 C：互审规则",
  memberIds: [A.id, B.id],
});

const anchor = sendMessage({
  targetId: channel.id,
  authorId: A.id,
  content: "把 parser.js 的 split 改成引号感知切分。",
  wake: false,
});
const task = createTask({ messageId: anchor.message.id });
console.log(`任务 #${task.number} 建立（作者 Dev），频道 ${channel.name}\n`);

const claimed = claimTask({ channelId: channel.id, taskNumber: task.number, memberId: A.id });
console.log(`1) Dev 认领            → ${claimed.status}`);

const delivered = updateTaskStatus({
  channelId: channel.id,
  taskNumber: task.number,
  status: "in_review",
  memberId: A.id,
});
console.log(`2) Dev 交付（in_review）→ ${delivered.status}`);

let selfApprove;
try {
  const r = updateTaskStatus({
    channelId: channel.id,
    taskNumber: task.number,
    status: "done",
    memberId: A.id,
  });
  selfApprove = `未拦截（status=${r.status}）← 意外！`;
} catch (error) {
  selfApprove = `被拒：${error instanceof Error ? error.message : String(error)}`;
}
console.log(`3) Dev 想自己 approve  → ${selfApprove}`);

const approved = updateTaskStatus({
  channelId: channel.id,
  taskNumber: task.number,
  status: "done",
  memberId: B.id,
});
console.log(`4) Reviewer approve    → ${approved.status}`);

const view = getTaskView(task.id);
console.log(`\n最终状态：${view.status}   owner=${view.owner?.name ?? "—"}   审者=${B.name}`);
console.log(`数据目录：${path.resolve(dataDir)}（存在=${existsSync(dataDir)}）`);
