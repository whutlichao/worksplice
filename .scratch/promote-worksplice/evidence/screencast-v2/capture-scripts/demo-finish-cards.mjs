// finish the demo board: approve the Done card, add + close a Closed card
import { sendMessage, createTask, claimTask, updateTaskStatus } from "/Users/apple/orca/workspaces/worksplice/screencast-v2-rev2/lib/domain/collab/index.ts";
const CH = "#all";
const Rune = "313f9b6d-2297-4252-b607-d193ac7410a7";
const OWNER = "owner";
// #6 is in_progress and owned by Marlow → approve it into Done (approver ≠ owner)
updateTaskStatus({ channelId: CH, taskNumber: 6, status: "in_review", memberId: "7ae8eaf9-9ee6-46b1-8dbb-81652857b982" });
const approved = updateTaskStatus({ channelId: CH, taskNumber: 6, status: "done", memberId: OWNER });
console.log("approved #6 →", approved.task.status);
// Closed card
const sent = sendMessage({ targetId: CH, authorId: OWNER, content:
  "Task: drop the per-second retry storm in the SSE reconnect path. Acceptance: a server restart produces a bounded number of reconnects with a doubling interval." });
const t = createTask({ messageId: sent.message.id });
claimTask({ channelId: CH, taskNumber: t.number, memberId: Rune });
const closed = updateTaskStatus({ channelId: CH, taskNumber: t.number, status: "closed", memberId: Rune });
console.log("closed #" + t.number, "→", closed.task.status);
