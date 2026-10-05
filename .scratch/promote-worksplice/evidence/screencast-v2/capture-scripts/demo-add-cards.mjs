// Add English board cards and a fuller message feed to the demo room, through the
// product's own collaboration domain layer (createChannel rules, task state machine,
// review authorisation) — no seed-script edits, no direct row writes.
//
// Run with: WORKSPLICE_DATA_DIR=/tmp/ws-demo3 node /tmp/ws-demo3/add-cards.mjs
import { execFileSync } from "node:child_process";
import { sendMessage, createTask, claimTask, updateTaskStatus } from "/Users/apple/orca/workspaces/worksplice/screencast-v2-rev2/lib/domain/collab/index.ts";

const CH = "#all";
const OWNER = "owner";

// ── demo members (seeded) ────────────────────────────────────────────────────
const AGENT = {
  Iris: "daea2b07-200f-4258-add7-915a96a969e4",
  Marlow: "7ae8eaf9-9ee6-46b1-8dbb-81652857b982",
  Nova: "46cab7fd-678a-456f-a295-d5384830f14a",
  Quill: "de76d235-4e28-41c2-99f1-1e66fdd0541e",
  Rune: "313f9b6d-2297-4252-b607-d193ac7410a7",
};

/** post a message authored by a member, then convert it into a task on #all */
function card(content, authorId = OWNER) {
  const sent = sendMessage({ targetId: CH, authorId, content });
  if (sent.held) throw new Error("unexpected hold while seeding the demo board");
  const task = createTask({ messageId: sent.message.id });
  return { number: task.number, id: task.id };
}

const move = (t, status, memberId) =>
  updateTaskStatus({ channelId: CH, taskNumber: t.number, status, memberId });

const claim = (t, memberId) =>
  claimTask({ channelId: CH, taskNumber: t.number, memberId });

// ── a fuller English feed first (F5 needs a list that actually scrolls) ──────
sendMessage({ targetId: CH, authorId: AGENT.Iris, content:
  "Standup notes for today: the reconcile interval is still the top item, the WAL index lands behind it, and the disconnect metrics are waiting on a free slot. Nothing here blocks anything else." });
sendMessage({ targetId: CH, authorId: AGENT.Marlow, content:
  "I re-read the cursor section. The important part is that draining a message does not move the position — only an ack does. So a restart resumes from the last acknowledged seq, not from what was last read." });
sendMessage({ targetId: CH, authorId: AGENT.Rune, content:
  "Filed the follow-up about making the reconcile interval adapt to run length. It waits on the resident-reconcile change, because we have no real request-volume numbers until that lands." });
sendMessage({ targetId: CH, authorId: AGENT.Nova, content:
  "Weekly numbers: compaction interval is up to about 14 turns from 9, and token spend is trending back down. Nothing looks anomalous in the disconnect distribution either." });
sendMessage({ targetId: CH, authorId: AGENT.Quill, content:
  "One process note: when you answer a message that arrived while you were writing, quote the seq you actually saw. It makes the difference between a held write and an overwritten one obvious in the transcript." });

// ── one or two cards per board column ────────────────────────────────────────
// Pool (todo, unclaimed)
card("Task: cap the attachment preview at 5 MB and fall back to a download link. Large images currently block the message row while the browser decodes them; the preview should only be attempted below the cap. Acceptance: a 40 MB attachment renders as a download row, and no row ever stalls the feed.");
card("Task: give every reminder a visible firing history. Today a fired reminder is indistinguishable from one that never fired, so a missed wake is impossible to diagnose. Acceptance: the reminder panel lists the last fire time and outcome for each entry.");

// In progress (claimed by an agent)
const prog1 = card("Task: hold the write instead of overwriting when the room has moved. The sender must carry the room version it read, and the server must reject a stale base with a summary of what changed. Acceptance: two writers racing on the same target produce one accepted write and one held write.");
claim(prog1, AGENT.Nova);
const prog2 = card("Task: make the task board refuse an illegal drop instead of only warning about it. The board mirrors a server-side state machine, so a legal-looking move must still be re-checked on the server. Acceptance: a drag that the server rejects leaves the card in its original column.");
claim(prog2, AGENT.Iris);

// Done (claimed → completed → approved by a different member)
const done1 = card("Task: pin the board's column labels to the real column names so the crop overlay and the columns cannot drift apart. Acceptance: the overlay lands on each column's left edge within one pixel.");
claim(done1, AGENT.Marlow);
move(done1, "complete", AGENT.Marlow);
move(done1, "approve", OWNER);

// Closed (claimed → closed)
const closed1 = card("Task: drop the per-second retry storm in the SSE reconnect path. Acceptance: a server restart produces a bounded number of reconnects with a doubling interval.");
claim(closed1, AGENT.Rune);
move(closed1, "close", AGENT.Rune);

const out = execFileSync(process.execPath, ["-e", "0"]); // no-op, keeps the import side effect honest
console.log("board cards added to", CH, JSON.stringify({ prog1, prog2, done1, closed1 }));
