import { existsSync, readFileSync, statSync } from "fs";
import { normalize } from "path";
import { getDb } from "../raft/db-singleton.ts";
import { listAgents, normalizeWorkspacePath } from "../raft/members.ts";
import type { MemberRow } from "../data/db.ts";
import { ROOM_MARKER_PATTERN, parseAgentAction } from "./loop.ts";

/**
 * 崩溃恢复（§5.3）：启动时按 seq 补拉。
 * 双写流中 raft 消息表是房间事实唯一来源；agent 回复的写序是
 * SDK 写 session jsonl → app 读回补写 SQLite。若在两步之间崩溃，SQLite 落后于
 * session jsonl 的已投递回复——本模块扫描 jsonl（user 条目携带的 target 标记，
 * 见 loop.ts roomMarker）找回缺失的 assistant 回复，按序补写并推进消费游标。
 * 只读不解析 pi 原生文件（读写权归 SDK），不 import SDK（保持启动路径轻量）。
 *
 * 与实时路径同构：一个标记轮只投递最后一条 assistant 文本（revise 的草稿、
 * 工具调用中间产物都会被后续条目覆盖）；回复内容按 parseAgentAction 解析
 * （JSON 协议取 content，非 JSON 整段为内容，ignore 不落库）。
 */

export interface SessionReply {
  targetId: string;
  markerSeq: number;
  content: string;
}

/**
 * 解析 session jsonl 文件头（type:"session" 条目）的 cwd 字段。
 * 与 SDK SessionManager.listAll 的 cwd 同源（同从 header 解析，已核对），
 * 使 backfill 做归属校验时无需 import SDK（保持启动路径轻量）。
 */
export function readSessionHeaderCwd(filePath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; cwd?: unknown };
      if (entry?.type === "session" && typeof entry.cwd === "string" && entry.cwd) {
        return entry.cwd;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 固化引用的 session 文件集合（不含本成员自己的登记；含 soft-deleted 成员——
 * ticket 08：软删行保留 pi_session_file 是 ADR-0003 的所有权凭证，被删成员仍登记
 * 的文件同样不得由其他成员补写）。
 */
function referencedSessionFilesExcluding(agentId: string): Set<string> {
  const referenced = new Set<string>();
  for (const member of getDb().listMembersIncludingDeleted()) {
    if (member.id === agentId) continue;
    if (member.pi_session_file) referenced.add(normalize(member.pi_session_file));
  }
  return referenced;
}

/**
 * backfill 归属门禁（ticket 04，ADR-0003 的 backfill 侧落地，文件级）：
 * 补写前确认该文件仍属于该 agent——
 * 1. header cwd 必须等于成员 workspace（跨 cwd 错绑 = 历史脏数据）；
 * 2. 文件不得被其他活成员固化引用（03 修复前双绑定残留 → 防同文件双作者补写）；
 * 3. 文件 mtime 不得早于成员创建时间（成员不可能在自己创建之前拥有会话——
 *    继承自 deleted/他人 agent 的旧文件必然更老，确定性规则无逻辑误杀）。
 * 任一不过 → 整文件跳过：不补写、不推进游标（避免"只补写跳过、游标却推进"的半截态）。
 */
export function backfillOwnershipGate(
  agent: MemberRow,
  referencedByOthers: ReadonlySet<string>,
): { pass: boolean; reason: string | null } {
  const file = agent.pi_session_file;
  if (!file) return { pass: false, reason: "no session file bound" };
  if (!existsSync(file)) return { pass: false, reason: "session file missing on disk" };
  if (!agent.workspace_path) return { pass: false, reason: "member has no workspace" };
  const headerCwd = readSessionHeaderCwd(file);
  if (headerCwd === null) {
    return { pass: false, reason: "session file header has no cwd" };
  }
  if (normalize(headerCwd) !== normalizeWorkspacePath(agent.workspace_path)) {
    return {
      pass: false,
      reason: `header cwd (${headerCwd}) != workspace (${agent.workspace_path})`,
    };
  }
  if (referencedByOthers.has(normalize(file))) {
    return { pass: false, reason: "session file also referenced by another member" };
  }
  const mtime = statSync(file).mtime.getTime();
  const createdAt = new Date(agent.created_at).getTime();
  if (mtime < createdAt) {
    return {
      pass: false,
      reason: `file mtime (${new Date(mtime).toISOString()}) predates member creation (${agent.created_at})`,
    };
  }
  return { pass: true, reason: null };
}

/** 解析 session jsonl：每个房间标记之后只保留最后一条 assistant 文本作为该轮回复。 */
export function scanSessionReplies(filePath: string): SessionReply[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const replies: SessionReply[] = [];
  let current: { targetId: string; seq: number } | null = null;
  let pendingText: string | null = null;

  const flush = () => {
    if (current && pendingText) {
      const parsed = parseAgentAction(pendingText);
      if (parsed.action === "reply" && parsed.content) {
        replies.push({ targetId: current.targetId, markerSeq: current.seq, content: parsed.content });
      }
    }
    pendingText = null;
  };

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message" || !entry.message) continue;
    const message = entry.message;
    if (message.role === "user") {
      const text =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
                .map((block) => (block as { text?: string }).text ?? "")
                .join("\n")
            : "";
      const match = ROOM_MARKER_PATTERN.exec(text);
      // 新的 user 条目（无论是否带标记）结束上一轮；带标记才开启新的 raft 轮。
      // 若该条目是 revise prompt（带 [worksplice:revision]），上一轮 assistant 是
      // 被 held 的草稿（实时路径从未落库）——丢弃而非按回复补写。
      if (!text.includes("[worksplice:revision]")) flush();
      pendingText = null;
      current = match ? { targetId: match[1], seq: Number(match[2]) } : null;
      continue;
    }
    if (message.role !== "assistant") continue;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
      .map((block) => (block as { text?: string }).text ?? "")
      .join("\n")
      .trim();
    if (!text) continue;
    pendingText = text; // 最后一条胜出
  }
  flush();
  return replies;
}

export interface BackfillResult {
  inserted: number;
  targets: string[];
}

/**
 * 单个 agent 的补拉：缺失回复按序补写。
 * 游标推进到每个标记轮的标记 seq（标记存在即证明该轮 prompt 已进入 agent 上下文，
 * agent 读过 ≤ 标记 seq 的全部消息）——即使回复已存在（崩溃于补写后 ack 前）也推进。
 */
export function backfillAgentReplies(agent: MemberRow): BackfillResult {
  const file = agent.pi_session_file;
  if (!file || !existsSync(file)) return { inserted: 0, targets: [] };

  // ticket 04 归属门禁：文件级校验不过 → 整文件跳过（不补写、不推进游标）。
  const gate = backfillOwnershipGate(agent, referencedSessionFilesExcluding(agent.id));
  if (!gate.pass) {
    console.warn(`[backfill] skipping session file ${file} for member ${agent.id}: ${gate.reason}`);
    return { inserted: 0, targets: [] };
  }

  const replies = scanSessionReplies(file);
  if (replies.length === 0) return { inserted: 0, targets: [] };

  const db = getDb();
  let inserted = 0;
  const targets = new Set<string>();
  const cursorByTarget = new Map<string, number>();
  const contentBlockedTargets = new Set<string>();
  db.withTransaction(() => {
    for (const reply of replies) {
      // ticket 04 轮级兑底（跨作者内容去重）：同 target 同内容已被他人落库 =
      // 疑似继承文件的他人回复（soft-delete 保留消息）——跳过补写，且该 target
      // 游标不推进（保持 pending，留给正常 wake 流程重读重做），避免把他人回复
      // 冒充为本 agent 的投递。真实崩溃恢复中同内容跨作者几乎不可能（各 agent
      // 回复独立），误杀率极低。
      if (db.hasMessageByContentByOther(reply.targetId, agent.id, reply.content)) {
        contentBlockedTargets.add(reply.targetId);
        continue;
      }
      cursorByTarget.set(
        reply.targetId,
        Math.max(cursorByTarget.get(reply.targetId) ?? 0, reply.markerSeq),
      );
      if (db.hasMessage(reply.targetId, agent.id, reply.content)) continue;
      const seq = db.maxSeq(reply.targetId) + 1;
      db.insertMessageAt({ targetId: reply.targetId, authorId: agent.id, content: reply.content, seq });
      inserted += 1;
      targets.add(reply.targetId);
    }
  });
  if (contentBlockedTargets.size > 0) {
    console.warn(
      `[backfill] member ${agent.id}: skipped ${contentBlockedTargets.size} reply round(s) whose ` +
        `content already exists under another author (targets: ${[...contentBlockedTargets].join(", ")}); ` +
        `cursor left pending for re-read`, 
    );
  }
  for (const [targetId, seq] of cursorByTarget) {
    db.setConsumedSeq(agent.id, targetId, Math.max(db.getConsumedSeq(agent.id, targetId), seq));
  }
  return { inserted, targets: [...targets] };
}

/** 启动时全量补拉（对所有未删除 agent）；补写直接落库，不触发 wake。 */
export function backfillAllAgents(): BackfillResult {
  let inserted = 0;
  const targets = new Set<string>();
  for (const agent of listAgents()) {
    const result = backfillAgentReplies(agent);
    inserted += result.inserted;
    for (const targetId of result.targets) targets.add(targetId);
  }
  return { inserted, targets: [...targets] };
}
