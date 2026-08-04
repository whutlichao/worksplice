import { existsSync, readFileSync } from "fs";
import { getDb } from "../raft/db-singleton.ts";
import { listAgents } from "../raft/members.ts";
import type { MemberRow } from "../data/db.ts";
import { ROOM_MARKER_PATTERN } from "./loop.ts";

/**
 * 崩溃恢复（§5.3）：启动时按 seq 补拉。
 * 双写流中 raft 消息表是房间事实唯一来源；agent 回复的写序是
 * SDK 写 session jsonl → app 读回补写 SQLite。若在两步之间崩溃，SQLite 落后于
 * session jsonl 的已投递回复——本模块扫描 jsonl（user 条目携带的 target 标记，
 * 见 loop.ts roomMarker）找回缺失的 assistant 回复，按序补写并推进消费游标。
 * 只读不解析 pi 原生文件（读写权归 SDK），不 import SDK（保持启动路径轻量）。
 */

export interface SessionReply {
  targetId: string;
  markerSeq: number;
  content: string;
}

/** 解析 session jsonl：user 消息中的房间标记 → 其后的 assistant 文本回复。 */
export function scanSessionReplies(filePath: string): SessionReply[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const replies: SessionReply[] = [];
  let current: { targetId: string; seq: number } | null = null;
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
      if (match) current = { targetId: match[1], seq: Number(match[2]) };
      continue;
    }
    if (message.role !== "assistant" || !current) continue;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
      .map((block) => (block as { text?: string }).text ?? "")
      .join("\n")
      .trim();
    if (!text) continue;
    replies.push({ targetId: current.targetId, markerSeq: current.seq, content: text });
  }
  return replies;
}

export interface BackfillResult {
  inserted: number;
  targets: string[];
}

/** 单个 agent 的补拉：缺失回复按序补写；有补写的 target 把游标推进到其标记 seq。 */
export function backfillAgentReplies(agent: MemberRow): BackfillResult {
  const file = agent.pi_session_file;
  if (!file || !existsSync(file)) return { inserted: 0, targets: [] };
  const replies = scanSessionReplies(file);
  if (replies.length === 0) return { inserted: 0, targets: [] };

  const db = getDb();
  let inserted = 0;
  const insertedTargets = new Set<string>();
  const cursorByTarget = new Map<string, number>();
  db.withTransaction(() => {
    for (const reply of replies) {
      if (db.hasMessage(reply.targetId, agent.id, reply.content)) continue;
      const seq = db.maxSeq(reply.targetId) + 1;
      db.insertMessageAt({ targetId: reply.targetId, authorId: agent.id, content: reply.content, seq });
      inserted += 1;
      insertedTargets.add(reply.targetId);
      cursorByTarget.set(
        reply.targetId,
        Math.max(cursorByTarget.get(reply.targetId) ?? 0, reply.markerSeq),
      );
    }
  });
  for (const [targetId, seq] of cursorByTarget) {
    if (insertedTargets.has(targetId)) {
      db.setConsumedSeq(agent.id, targetId, Math.max(db.getConsumedSeq(agent.id, targetId), seq));
    }
  }
  return { inserted, targets: [...insertedTargets] };
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
