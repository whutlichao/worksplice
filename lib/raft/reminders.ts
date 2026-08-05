import { getDb } from "./db-singleton.ts";
import { getChannel, isChannelMember, resolveChannelForTarget } from "./channels.ts";
import { getMember } from "./members.ts";
import { sendMessage } from "./messages.ts";
import { emitWake } from "../agent-loop/wake.ts";
import { nextFireAt, isValidRecurrence } from "./recurrence.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";
import type { MemberRow, MessageRow, ReminderLogEvent, ReminderRow } from "../data/db.ts";

/**
 * reminder 服务层（§3.9/§5.6）：schedule / list / snooze / update / cancel / log / fire。
 * - 设置者：作者本人（agent 拥有自己的时间；人类在 UI 直接设，author = Owner）；
 * - 触发（app 内 cron 逐分钟轮询 fireDueReminders）：到点投递系统消息到锚定 target
 *   （作者署名、不触发 channel 级 wake）+ 定向唤醒作者（agent → agent-loop wake；
 *   human → 系统消息本身即 UI 可见通知）；
 * - recurrence 到期按 DSL 续算下一次 fire_at（§3.9 [锁定] DSL，时区安全）；
 * - cancel 后不再触发；管理操作记录生命周期事件到 reminder_logs（schedule/fire/
 *   snooze/update/cancel/reschedule/error）。
 */

export class ReminderNotFoundError extends Error {
  constructor(id: string) {
    super(`Reminder not found: ${id}`);
    this.name = "ReminderNotFoundError";
  }
}

export class ReminderNotAuthorizedError extends Error {
  constructor() {
    super("Only the reminder author (or the owner) can manage this reminder");
    this.name = "ReminderNotAuthorizedError";
  }
}

export interface ReminderView extends ReminderRow {
  author: MemberRow | null;
  target: { kind: "channel" | "message"; id: string } | null;
  /** 归属 channel（消息锚定的提醒也归一化回其 channel；无 target 时为 null）。 */
  channelId: string | null;
  channelName: string | null;
  /** 消息锚定时锚点消息的 seq（定位/展示用）；channel 锚定或无线索时为 null。 */
  anchorSeq: number | null;
}

export type FireOutcome =
  | { status: "fired"; reminder: ReminderView; systemMessage: MessageRow | null; postError?: string }
  | { status: "not_due"; reason?: string };

/** 系统消息正文（人类可见的提醒锚点，§3.9）。 */
export function systemReminderContent(reminder: ReminderRow): string {
  const recurrence = reminder.recurrence ? ` (recurring: ${reminder.recurrence})` : "";
  return `⏰ Reminder: ${reminder.title}${recurrence}`;
}

function toView(reminder: ReminderRow): ReminderView {
  let target: ReminderView["target"] = null;
  let channelId: string | null = null;
  let anchorSeq: number | null = null;
  if (reminder.target_id) {
    const channel = resolveChannelForTarget(reminder.target_id);
    channelId = channel?.id ?? null;
    if (getChannel(reminder.target_id)) {
      target = { kind: "channel", id: reminder.target_id };
    } else {
      target = { kind: "message", id: reminder.target_id };
      anchorSeq = getDb().getMessage(reminder.target_id)?.seq ?? null;
    }
  }
  return {
    ...reminder,
    author: getMember(reminder.author_id) ?? null,
    target,
    channelId,
    channelName: channelId ? getChannel(channelId)?.name ?? null : null,
    anchorSeq,
  };
}

function log(reminderId: string, event: ReminderLogEvent, detail = ""): void {
  getDb().insertReminderLog({ reminderId, event, detail });
}

/** 管理权限：作者本人或 Owner（人类恒为 Owner，可代管，§3.6）。 */
function assertCanManage(reminder: ReminderRow, actorId: string): void {
  if (reminder.author_id !== actorId && actorId !== OWNER_MEMBER_ID) {
    throw new ReminderNotAuthorizedError();
  }
}

/** target 归一化：channel id / 顶层消息 id；thread 内消息归一化到其锚点；返回 undefined 表非法。 */
function normalizeTarget(targetId: string): string | undefined {
  if (getChannel(targetId)) return targetId;
  const message = getDb().getMessage(targetId);
  if (!message) return undefined;
  // thread 内消息（target 是另一条消息）→ 线程锚点（§6.1 thread 以锚点消息 id 为 target）
  if (getDb().getMessage(message.target_id)) return message.target_id;
  return message.id;
}

/** 校验 fire_at（ISO 可解析字符串）。 */
function assertValidFireAt(fireAt: string): void {
  if (typeof fireAt !== "string" || Number.isNaN(Date.parse(fireAt))) {
    throw new Error("fireAt must be a valid date string (ISO)");
  }
}

/**
 * 创建提醒（§3.9）：title 必填；recurrence 必为合法 DSL；target 归一化后必须落在
 * 作者所在的 channel（投递系统消息的前置条件）。记 schedule log。
 */
export function scheduleReminder(input: {
  title: string;
  fireAt: string;
  recurrence?: string | null;
  targetId?: string | null;
  authorId: string;
}): ReminderView {
  const title = input.title.trim();
  if (!title) throw new Error("Reminder title is required");
  assertValidFireAt(input.fireAt);
  if (input.recurrence && !isValidRecurrence(input.recurrence)) {
    throw new Error("Invalid recurrence DSL");
  }
  const author = getMember(input.authorId);
  if (!author || author.deleted === 1) throw new Error("Member not found");

  let targetId: string | null = null;
  if (input.targetId !== undefined && input.targetId !== null) {
    const normalized = normalizeTarget(input.targetId);
    if (!normalized) throw new Error("Reminder target not found");
    const channel = resolveChannelForTarget(normalized);
    if (!channel) throw new Error("Reminder target not found");
    if (!isChannelMember(channel.id, input.authorId)) {
      throw new Error("You are not a member of this channel");
    }
    targetId = normalized;
  }

  const reminder = getDb().insertReminder({
    title,
    fireAt: new Date(input.fireAt).toISOString(),
    recurrence: input.recurrence && isValidRecurrence(input.recurrence) ? input.recurrence.trim() : null,
    targetId,
    authorId: input.authorId,
    status: "scheduled",
  });
  log(reminder.id, "schedule", `fire at ${reminder.fire_at}`);
  return toView(reminder);
}

export function listReminders(filter: { authorId?: string; targetId?: string } = {}): ReminderView[] {
  const db = getDb();
  let rows: ReminderRow[];
  if (filter.authorId !== undefined) {
    rows = db.listRemindersByAuthor(filter.authorId);
  } else if (filter.targetId !== undefined) {
    // 查询侧同样归一化：thread 内消息的提醒锚定在锚点（与 scheduleReminder 同规则）
    const normalized = normalizeTarget(filter.targetId) ?? filter.targetId;
    rows = db.listRemindersForTarget(normalized);
  } else {
    rows = db.listReminders();
  }
  return rows.map(toView);
}

export function getReminderView(id: string): ReminderView {
  const reminder = getDb().getReminderById(id);
  if (!reminder) throw new ReminderNotFoundError(id);
  return toView(reminder);
}

function assertScheduled(reminder: ReminderRow): void {
  if (reminder.status !== "scheduled") {
    throw new Error(`Only scheduled reminders can be managed (current: ${reminder.status})`);
  }
}

/**
 * snooze（§3.9 管理）：fire_at = max(now, fire_at) + minutes。仅 scheduled；作者/Owner。
 */
export function snoozeReminder(id: string, minutes: number, actorId: string): ReminderView {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("minutes must be a positive number");
  const reminder = getDb().getReminderById(id);
  if (!reminder) throw new ReminderNotFoundError(id);
  assertCanManage(reminder, actorId);
  assertScheduled(reminder);
  const base = Math.max(Date.now(), new Date(reminder.fire_at).getTime());
  const next = new Date(base + minutes * 60_000).toISOString();
  const updated = getDb().updateReminder(id, { fireAt: next });
  log(id, "snooze", `+${minutes}min → ${next}`);
  return toView(updated!);
}

/**
 * update（§3.9 管理）：title / fireAt / recurrence / targetId 均可改，校验同创建。
 * 仅 scheduled；作者/Owner。记 update log。
 */
export function updateReminder(
  id: string,
  input: { title?: string; fireAt?: string; recurrence?: string | null; targetId?: string | null },
  actorId: string,
): ReminderView {
  const reminder = getDb().getReminderById(id);
  if (!reminder) throw new ReminderNotFoundError(id);
  assertCanManage(reminder, actorId);
  assertScheduled(reminder);

  if (input.title !== undefined && !input.title.trim()) throw new Error("Reminder title is required");
  if (input.fireAt !== undefined) assertValidFireAt(input.fireAt);
  if (input.recurrence !== undefined && input.recurrence !== null && !isValidRecurrence(input.recurrence)) {
    throw new Error("Invalid recurrence DSL");
  }
  let targetId: string | null | undefined = input.targetId;
  if (input.targetId !== undefined && input.targetId !== null) {
    const normalized = normalizeTarget(input.targetId);
    if (!normalized) throw new Error("Reminder target not found");
    const channel = resolveChannelForTarget(normalized);
    if (!channel || !isChannelMember(channel.id, reminder.author_id)) {
      throw new Error("You are not a member of this channel");
    }
    targetId = normalized;
  }

  const updated = getDb().updateReminder(id, {
    title: input.title !== undefined ? input.title.trim() : undefined,
    fireAt: input.fireAt !== undefined ? new Date(input.fireAt).toISOString() : undefined,
    recurrence: input.recurrence !== undefined ? (input.recurrence ?? null) : undefined,
    targetId: targetId !== undefined ? (targetId ?? null) : undefined,
  });
  if (!updated) throw new ReminderNotFoundError(id);
  log(id, "update", `fire at ${updated.fire_at}`);
  return toView(updated);
}

/** cancel（§3.9）：status → canceled，之后 cron 不再触发。仅 scheduled；作者/Owner。 */
export function cancelReminder(id: string, actorId: string): ReminderView {
  const reminder = getDb().getReminderById(id);
  if (!reminder) throw new ReminderNotFoundError(id);
  assertCanManage(reminder, actorId);
  assertScheduled(reminder);
  const updated = getDb().updateReminder(id, { status: "canceled" });
  log(id, "cancel");
  return toView(updated!);
}

/** 生命周期事件流（§3.9 log）。 */
export function getReminderLog(id: string): Array<{ event: ReminderLogEvent; detail: string; created_at: string }> {
  const reminder = getDb().getReminderById(id);
  if (!reminder) throw new ReminderNotFoundError(id);
  return getDb().listReminderLogs(id);
}

/**
 * 触发单个到点提醒（§5.6 fire）：投递系统消息到**频道主流程**（channel 锚定 → 该
 * channel；消息锚定 → 其归属 channel，正文附锚点 #seq 引用，§3.9 可见性修正），
 * wake: false —— 不惊动 channel 其他 agent）+ 定向唤醒作者（agent → emitWake
 * reason=reminder；human → 系统消息即 UI 通知）。recurrence 续算下一次 fire_at；
 * 无 recurrence → fired。
 * 幂等：status/fire_at 校验在触发前，重复调用返回 not_due，不重复投递。
 * 消息投递失败（作者已退出 channel 等）→ 记 error log 并收口 fired（不无限重试）。
 * 全程同步执行（无 await），单进程内不存在两个 tick 交错——状态迁移与投递原子可见。
 */
export function fireReminder(id: string, now: Date = new Date()): FireOutcome {
  const db = getDb();
  const reminder = db.getReminderById(id);
  if (!reminder) throw new ReminderNotFoundError(id);
  if (reminder.status !== "scheduled" || new Date(reminder.fire_at).getTime() > now.getTime()) {
    return { status: "not_due", reason: reminder.status !== "scheduled" ? `status ${reminder.status}` : "future fire_at" };
  }

  let systemMessage: MessageRow | null = null;
  let postError: string | undefined;
  if (reminder.target_id) {
    try {
      // 消息锚定的提醒投到其归属 channel 主流程（原设计投 thread 不可见，修正为频道可见）
      const channel = resolveChannelForTarget(reminder.target_id);
      const deliveryTarget = channel ? channel.id : reminder.target_id;
      let content = systemReminderContent(reminder);
      if (channel && !getChannel(reminder.target_id)) {
        const anchorSeq = getDb().getMessage(reminder.target_id)?.seq;
        if (anchorSeq !== undefined) content += ` (anchored on #${anchorSeq})`;
      }
      const sent = sendMessage({
        targetId: deliveryTarget,
        authorId: reminder.author_id,
        content,
        wake: false,
      });
      if (!sent.held) {
        systemMessage = sent.message;
      } else {
        postError = `system message held unexpectedly (roomSeq ${sent.roomSeq})`;
      }
    } catch (error) {
      postError = error instanceof Error ? error.message : String(error);
    }
  }

  const fireTime = new Date(reminder.fire_at);
  let next: Date | null = null;
  if (reminder.recurrence) {
    next = nextFireAt(reminder.recurrence, fireTime);
    if (!next) postError = postError ?? `cannot compute next fire for recurrence: ${reminder.recurrence}`;
  }
  db.withTransaction(() => {
    // 状态迁移 + log（同步单线程内与上文的投递不可交错，双保险）
    const detail =
      systemMessage
        ? `system message #${systemMessage.seq} posted to ${systemMessage.target_id}`
        : postError
          ? `no system message: ${postError}`
          : "no target — no system message";
    log(id, postError && !systemMessage ? "error" : "fire", detail);
    if (next) {
      db.updateReminder(id, { fireAt: next.toISOString(), status: "scheduled" });
      log(id, "reschedule", `next fire at ${next!.toISOString()}`);
    } else {
      db.updateReminder(id, { status: "fired" });
    }
  });

  if (systemMessage) {
    const author = getMember(reminder.author_id);
    if (author?.type === "agent") {
      emitWake({
        agentId: author.id,
        targetId: systemMessage.target_id,
        seq: systemMessage.seq,
        reason: "reminder",
      });
    }
  }

  const final = db.getReminderById(id)!;
  return { status: "fired", reminder: toView(final), systemMessage, postError };
}

/** 到点扫描（§5.6 cron 入口）：status=scheduled 且 fire_at <= now 的全部触发，按 fire_at 序。 */
export function fireDueReminders(now: Date = new Date()): FireOutcome[] {
  const due = getDb()
    .listReminders()
    .filter((r) => r.status === "scheduled" && new Date(r.fire_at).getTime() <= now.getTime());
  return due.map((reminder) => fireReminder(reminder.id, now));
}
