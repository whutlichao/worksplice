"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MemberRow, TaskStatus } from "@/lib/data/types";
import type { ChannelMessage } from "@/components/ChannelView";

/** §3.5 pinned 项（与 GET /api/channels/[id]/pinned 返回形态同形；
 *  ChannelView 旧内联定义的上游，避免 ChannelView ↔ hook 循环 import）。 */
export interface PinnedItem {
  message: ChannelMessage;
  order: number;
  pinnedAt: string;
}

/** §3.5 pinned 排序三选一（与服务端 PinSortMode 同形）。 */
export type PinnedSort = "manual" | "recent" | "az";

/** §3.7 任务视图（与 GET /api/channels/[id]/tasks 返回形态同形；
 *  ChannelView 旧内联定义的上游，避免 ChannelView ↔ hook 循环 import）。 */
export interface ChannelTask {
  id: string;
  message_id: string;
  number: number;
  status: TaskStatus;
  owner_id: string | null;
  /** §3.7 重开封锁标记：置 1 期间 agent 不可自动认领，仅 Owner 认领接管。 */
  reopened: number;
  updated_at: string;
  channelId: string;
  anchor: ChannelMessage;
  owner: MemberRow | null;
  /** §3.7/ADR-0002 看板拖拽：服务端按当前身份推导的合法转移落点（与状态机一致，客户端不镜像）。 */
  reachable: TaskStatus[];
  /** Task thread 中高于 Owner 已读游标的非 Owner 回复数。 */
  unreadReplyCount: number;
}

/** §3.2 mute 行（与 GET /api/channels/[id]/mute 返回形态同形）。 */
export interface ChannelMuteRow {
  memberId: string;
  name: string;
  muted: boolean;
}

/** BAI-6 打开频道期间推进已读游标（纯函数：fetch 可注入，便于测试）。
 *
 * 调用方（3s 轮询 effect）在合并出新消息时 fire-and-forget 调用：
 * `void markChannelRead(cid).catch(() => undefined)`。服务端幂等（游标只前进），
 * 404（频道被删）/ 网络失败由调用方吞掉，不干扰消息合并。channelId 为空时由调用方跳过。 */
export async function markChannelRead(
  channelId: string,
  fetchFn: FetchFn = fetch,
): Promise<number> {
  const res = await fetchFn(
    `/api/channels/${encodeURIComponent(channelId)}/read`,
    {
      method: "POST",
    },
  );
  if (!res.ok) throw new Error(`POST read: ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { readSeq?: number };
  return body.readSeq ?? 0;
}

export interface TaskThreadReadReceipt {
  baselineSeq: number;
  readSeq: number;
  unreadReplyCount: number;
}

/** 推进单个 Task thread 中已呈现的回复（纯函数：fetch 可注入，便于测试）。 */
export async function postTaskThreadRead(
  taskId: string,
  throughSeq: number,
  fetchFn: FetchFn = fetch,
): Promise<TaskThreadReadReceipt> {
  const res = await fetchFn(
    `/api/tasks/${encodeURIComponent(taskId)}/read`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ throughSeq }),
    },
  );
  if (!res.ok) throw new Error(`POST task read: ${res.status}`);
  return (await res.json()) as TaskThreadReadReceipt;
}

/** 频道消息页（与 GET /api/channels/[id]/messages 返回形态同形）。 */
export interface ChannelMessagesPage {
  messages: ChannelMessage[];
  hasMore: boolean;
  maxSeq: number;
}

/** 每页消息数（与 ChannelView 旧内联实现一致）。 */
export const CHANNEL_PAGE_LIMIT = 50;
/** agent-loop 回复轮询间隔（§5.4：agent 回复落入消息流）。 */
export const CHANNEL_POLL_MS = 3000;

type FetchFn = typeof fetch;

/** 轮询合并：按 id 去重 + 按 seq 排序（纯函数，便于测试）。 */
export function mergeIncomingMessages(
  prev: ChannelMessage[],
  incoming: ChannelMessage[],
): ChannelMessage[] {
  if (incoming.length === 0) return prev;
  const merged = [
    ...prev,
    ...incoming.filter((m) => !prev.some((p) => p.id === m.id)),
  ];
  return merged.sort((a, b) => a.seq - b.seq);
}

/** 取一页频道消息（纯函数：fetch 可注入，便于测试）。 */
export async function loadMessagesPage(
  targetId: string,
  before?: number,
  fetchFn: FetchFn = fetch,
): Promise<ChannelMessagesPage> {
  const params = new URLSearchParams({ limit: String(CHANNEL_PAGE_LIMIT) });
  if (before !== undefined) params.set("before", String(before));
  const res = await fetchFn(
    `/api/channels/${encodeURIComponent(targetId)}/messages?${params}`,
  );
  if (!res.ok) throw new Error(`GET messages: ${res.status}`);
  return (await res.json()) as ChannelMessagesPage;
}

/**
 * 轮询合并推进：maxSeq 未推进时返回同一引用（调用方跳过 setState，避免全列表重排闪动）；
 * 推进时合并新消息并更新 hasMore/maxSeq。
 */
export function applyPollPage(
  prev: ChannelMessagesPage,
  page: ChannelMessagesPage,
): ChannelMessagesPage {
  if (page.maxSeq <= prev.maxSeq) return prev;
  return {
    messages: mergeIncomingMessages(prev.messages, page.messages),
    hasMore: page.hasMore,
    maxSeq: page.maxSeq,
  };
}

/** 向上分页拼接：早页 prepend 到前面（纯函数）。 */
export function prependPageMessages(
  prev: ChannelMessage[],
  page: ChannelMessage[],
): ChannelMessage[] {
  return [...page, ...prev];
}

/** 切换频道快照一致性判定：一致时调用方可跳过 setState，避免重复 commit 闪动。 */
export function isSameMessagesPage(
  prev: ChannelMessagesPage,
  page: ChannelMessagesPage,
): boolean {
  return (
    prev.maxSeq === page.maxSeq &&
    prev.hasMore === page.hasMore &&
    prev.messages.length === page.messages.length &&
    prev.messages.every((m, i) => m.id === page.messages[i]?.id)
  );
}

/** §3.5 pinned 客户端兜底排序（纯函数：fetch 可注入 test 不需要网络，便于测试）。
 *
 * 与服务端 listPinned 同语义的客户端镜像：manual = order 升序；
 * recent = pinnedAt 降序、同毫秒按 order 降序兜底（服务端 `b.row.order - a.row.order`）；
 * az = 内容字典序。服务端已按 sort 排好序返回，本函数供视图在本地重排
 * （如重排乐观态）与 hook 级测试锁定排序语义用。
 */
export function sortPinnedItems(
  items: PinnedItem[],
  sort: PinnedSort,
): PinnedItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (sort === "recent") {
      return b.pinnedAt.localeCompare(a.pinnedAt) || b.order - a.order;
    }
    if (sort === "az")
      return a.message.content.localeCompare(b.message.content);
    return a.order - b.order;
  });
  return sorted;
}

/** 取频道 pinned 列表（纯函数：fetch 可注入，便于测试）。 */
export async function loadPinnedPage(
  channelId: string,
  sort: PinnedSort,
  fetchFn: FetchFn = fetch,
): Promise<PinnedItem[]> {
  const res = await fetchFn(
    `/api/channels/${encodeURIComponent(channelId)}/pinned?sort=${sort}`,
  );
  if (!res.ok) throw new Error(`GET pinned: ${res.status}`);
  const body = (await res.json()) as { pinned?: PinnedItem[] };
  return body.pinned ?? [];
}

/** 提交 pinned 重排（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 movePinned 同语义：按新顺序的 messageId 数组一次提交；
 * 服务端只重排已 pin 的行（setPinnedOrder），缺省保持原位。
 */
export async function postPinnedOrder(
  channelId: string,
  order: string[],
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const res = await fetchFn(
    `/api/channels/${encodeURIComponent(channelId)}/pinned/reorder`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    },
  );
  if (!res.ok) throw new Error(`reorder: ${res.status}`);
}

/** §3.5 pin / unpin 切换（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 togglePin 同语义：已 pin 则 DELETE，否则 POST；
 * 返回切换后的 pin 态（true = 已 pin）。
 */
export async function togglePinnedMessage(
  channelId: string,
  messageId: string,
  alreadyPinned: boolean,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  const res = alreadyPinned
    ? await fetchFn(
        `/api/channels/${encodeURIComponent(channelId)}/pinned?messageId=${messageId}`,
        {
          method: "DELETE",
        },
      )
    : await fetchFn(`/api/channels/${encodeURIComponent(channelId)}/pinned`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
  if (!res.ok) throw new Error(`pin: ${res.status}`);
  return !alreadyPinned;
}

/** 取频道 mute 列表（纯函数：fetch 可注入，便于测试）。 */
export async function loadMutesPage(
  channelId: string,
  fetchFn: FetchFn = fetch,
): Promise<ChannelMuteRow[]> {
  const res = await fetchFn(
    `/api/channels/${encodeURIComponent(channelId)}/mute`,
  );
  if (!res.ok) throw new Error(`GET mutes: ${res.status}`);
  const body = (await res.json()) as { mutes?: ChannelMuteRow[] };
  return body.mutes ?? [];
}

/** §3.2 mute 开关（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 toggleMute 同语义：取反提交；返回切换后的静音态。
 */
export async function toggleChannelMute(
  channelId: string,
  memberId: string,
  muted: boolean,
  fetchFn: FetchFn = fetch,
): Promise<boolean> {
  const next = !muted;
  const res = await fetchFn(
    `/api/channels/${encodeURIComponent(channelId)}/mute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, muted: next }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "mute failed");
  }
  return next;
}

/** 成员集合显式失效判定（纯函数：hook 内失效 effect 的决策面，便于测试）。
 *
 * 新建 agent 自动加入 #all 后外部成员集已变——调用方经 membersVersion 递增
 * 宣告失效（>0 即重拉）；未传/0 时不触发（旧调用方行为不变）。 */
export function shouldInvalidateMembers(membersVersion?: number): boolean {
  return membersVersion !== undefined && membersVersion !== 0;
}

/** 取频道成员 id 集合（纯函数：fetch 可注入，便于测试）。 */
export async function loadChannelMemberIds(
  channelId: string,
  fetchFn: FetchFn = fetch,
): Promise<Set<string>> {
  const res = await fetchFn(
    `/api/channels/${encodeURIComponent(channelId)}/members`,
  );
  if (!res.ok) throw new Error(`GET members: ${res.status}`);
  const body = (await res.json()) as { members?: Array<{ id: string }> };
  return new Set((body.members ?? []).map((m) => m.id));
}

/** 取频道任务板（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 loadTasks 同语义：GET /api/channels/[id]/tasks
 * 返回按 number 升序的任务视图（含 reachable/reopened，服务端事实）。 */
export async function loadTasksPage(
  channelId: string,
  fetchFn: FetchFn = fetch,
): Promise<ChannelTask[]> {
  const res = await fetchFn(
    `/api/channels/${encodeURIComponent(channelId)}/tasks`,
  );
  if (!res.ok) throw new Error(`GET tasks: ${res.status}`);
  const body = (await res.json()) as { tasks?: ChannelTask[] };
  return body.tasks ?? [];
}

/** 任务线程回复不进入频道主序列；后台刷新只合并未读数，避免改写任务视图的其他状态。 */
export function mergeTaskUnreadCounts(
  current: ChannelTask[],
  refreshed: ChannelTask[],
): ChannelTask[] {
  const counts = new Map(
    refreshed.map((task) => [task.id, task.unreadReplyCount]),
  );
  let changed = false;
  const merged = current.map((task) => {
    const unreadReplyCount = counts.get(task.id);
    if (unreadReplyCount === undefined || unreadReplyCount === task.unreadReplyCount) {
      return task;
    }
    changed = true;
    return { ...task, unreadReplyCount };
  });
  return changed ? merged : current;
}

/** 任务转移结果：updated 携带服务端回写的任务视图；held 携带并发摘要（§6.3）；
 * conflict/blocked 携带让路原因（§3.7：已认领冲突 / 重开封锁）。 */
export type TaskTransitionResult =
  | { kind: "updated"; task: ChannelTask }
  | { kind: "held"; whatHappened: string }
  | { kind: "conflict"; reason: string }
  | { kind: "blocked"; reason: string };

/** 解析 claim / update-status 响应的 409 三分支（纯函数：路由契约的客户端镜像）。
 *
 * 路由返回：held → { held: true, whatHappened }；conflict → { conflict: true, reason }；
 * blocked → { blocked: true, reason }（§3.7 重开封锁）。未知形态抛错，不静默吞掉。 */
export function parseTaskTransitionBody(body: {
  task?: ChannelTask;
  held?: boolean;
  whatHappened?: string;
  conflict?: boolean;
  blocked?: boolean;
  reason?: string;
}): TaskTransitionResult {
  if (body.task) return { kind: "updated", task: body.task };
  if (body.held)
    return { kind: "held", whatHappened: body.whatHappened ?? "held" };
  if (body.conflict)
    return { kind: "conflict", reason: body.reason ?? "conflict" };
  if (body.blocked)
    return { kind: "blocked", reason: body.reason ?? "blocked" };
  throw new Error("task transition: empty response");
}

/** 认领任务（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 runTaskAction(claim) 同语义：POST /api/tasks/[id]/claim
 * 携带 baseSeq（调用时的频道版本）；held/conflict/blocked 不抛错，由调用方提示并让路。 */
export async function claimChannelTask(
  taskId: string,
  baseSeq: number,
  fetchFn: FetchFn = fetch,
): Promise<TaskTransitionResult> {
  const res = await fetchFn(`/api/tasks/${encodeURIComponent(taskId)}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseSeq }),
  });
  const body = (await res.json().catch(() => ({}))) as Parameters<
    typeof parseTaskTransitionBody
  >[0];
  if (!res.ok) {
    if (body.held || body.conflict || body.blocked)
      return parseTaskTransitionBody(body);
    throw new Error(body.task ? "claim failed" : `claim: ${res.status}`);
  }
  return parseTaskTransitionBody(body);
}

/** 任务状态转移（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 runTaskAction(updateStatus) 同语义：
 * POST /api/tasks/[id]/update-status 携带 { status, baseSeq }；
 * held/conflict/blocked 不抛错，由调用方提示并让路。 */
export async function updateChannelTaskStatus(
  taskId: string,
  status: TaskStatus,
  baseSeq: number,
  fetchFn: FetchFn = fetch,
): Promise<TaskTransitionResult> {
  const res = await fetchFn(
    `/api/tasks/${encodeURIComponent(taskId)}/update-status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, baseSeq }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as Parameters<
    typeof parseTaskTransitionBody
  >[0];
  if (!res.ok) {
    if (body.held || body.conflict || body.blocked)
      return parseTaskTransitionBody(body);
    throw new Error(`update-status: ${res.status}`);
  }
  return parseTaskTransitionBody(body);
}

/** §3.7 complete 两步序列（纯函数：fetch 可注入，便于测试）。
 *
 * 与 agent-loop runTaskOperation 的 complete 同语义：回复先落任务线程
 * （thread 自己的 seq 空间，baseSeq = 线程版本），再经 update-status 置 in_review
 * （channel freshness，baseSeq = 频道版本）；任一步 held 即停，由调用方提示。
 * 复用 hook 内已有发送通道 postChannelMessage（04 票前置：02 票 send 通道）。 */
export async function completeTaskWithReply(
  taskId: string,
  anchorId: string,
  replyContent: string,
  threadBaseSeq: number,
  channelBaseSeq: number,
  fetchFn: FetchFn = fetch,
): Promise<TaskTransitionResult> {
  const reply = await postChannelMessage(
    anchorId,
    replyContent,
    undefined,
    threadBaseSeq,
    undefined,
    fetchFn,
  );
  if (reply.kind === "held")
    return { kind: "held", whatHappened: reply.whatHappened };
  return updateChannelTaskStatus(taskId, "in_review", channelBaseSeq, fetchFn);
}

/** 把已有消息转为任务（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 convertMessageToTask 同语义：POST /api/tasks { messageId }；
 * 409（已是任务）与其他错误抛错，由调用方提示（任务板是 04 票范围）。 */
export async function convertMessageToTaskRow(
  messageId: string,
  fetchFn: FetchFn = fetch,
): Promise<ChannelTask> {
  const res = await fetchFn("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    task?: ChannelTask;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `convert to task: ${res.status}`);
  if (!body.task) throw new Error("convert to task: empty response");
  return body.task;
}

/** Tasks tab 建任务（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 createTaskFromBoard 同语义：POST /api/tasks
 * { channelId, content }（服务端先发消息再建任务）；失败抛错，由调用方提示。 */
export async function createBoardTaskRow(
  channelId: string,
  content: string,
  fetchFn: FetchFn = fetch,
): Promise<ChannelTask> {
  const res = await fetchFn("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId, content }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    task?: ChannelTask;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `create task: ${res.status}`);
  if (!body.task) throw new Error("create task: empty response");
  return body.task;
}

/** 发送结果：sent 携带服务端回写的消息；held 携带并发摘要（§6.3 freshness-hold）。 */
export type SendChannelMessageResult =
  | { kind: "sent"; message: ChannelMessage }
  | { kind: "held"; whatHappened: string };

/** 发送一条频道消息（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 handleSend 同语义：baseSeq = 发送时的频道版本；
 * JSON（无附件）或 multipart（有附件）一次请求原子提交；held 时服务端不落盘。
 */
export async function postChannelMessage(
  targetId: string,
  content: string,
  quoteId: string | undefined,
  baseSeq: number,
  files?: File[],
  fetchFn: FetchFn = fetch,
): Promise<SendChannelMessageResult> {
  let res: Response;
  if (files && files.length > 0) {
    // §3.5 附件随消息一起 multipart 提交：一次请求原子完成（held 时服务端不落盘）。
    const form = new FormData();
    form.append("targetId", targetId);
    form.append("content", content);
    form.append("baseSeq", String(baseSeq));
    if (quoteId) form.append("quoteId", quoteId);
    for (const file of files) form.append("files", file);
    res = await fetchFn("/api/messages", { method: "POST", body: form });
  } else {
    res = await fetchFn("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId, content, quoteId, baseSeq }),
    });
  }
  const body = (await res.json().catch(() => ({}))) as {
    message?: ChannelMessage;
    held?: boolean;
    whatHappened?: string;
    error?: string;
  };
  if (!res.ok) {
    if (body.held)
      return { kind: "held", whatHappened: body.whatHappened ?? "held" };
    throw new Error(body.error ?? `POST messages: ${res.status}`);
  }
  if (body.message) return { kind: "sent", message: body.message };
  throw new Error("POST messages: empty response");
}

/**
 * 频道消息数据循环（01 票：轮询 + merge + maxSeq/hasMore；02 票：发送 + held + busyAction；
 * 03 票：pinned 数据循环 + 附属区 mute/members；04 票：任务板数据循环 + 转移序列）。
 *
 * ChannelView 只做排版：消息状态、分页、轮询合并、发送通道、pinned/附属区、任务板全部经此 hook。
 * 缓存按频道分桶（切回看过的频道直接命中快照），请求代际丢弃迟到响应。
 *
 * 02 票语义（与 ChannelView 旧内联实现一致）：
 * - `send` 携带 baseSeq（调用时的 maxSeq）；held 后置 heldNotice + 重拉（loadLatest）+ 抛 held 文案。
 * - 发送成功后经 loadLatest 重拉收敛（append 入口是后续票的事，本票不做乐观追加）。
 * - `send` 只管发送与 held 收敛：quoting 清理与 As Task 转化留视图侧（handleSend 内），hook 不持有引用/As Task 状态。
 * - `busyAction` 沿旧语义由视图侧任务动作（runTaskAction）驱动（与旧内联 useState 同一共享锁）；
 *   `send` 本体不加锁（与旧 handleSend 一致，Composer 的 busy 态只反映任务动作）。
 *
 * 03 票语义（与 ChannelView 旧内联实现一致）：
 * - `pinnedItems / pinnedSort / setPinnedSort / reorderPinned` 持有 pinned 数据循环：
 *   切换频道或排序变化时重拉（loadPinnedPage 经服务端 sort），Manual 排序下 ↑/↓ 重排
 *   经 postPinnedOrder 提交后重拉收敛；pin/unpin 经 togglePin 切换后重拉收敛。
 * - `mutes / channelMemberIds` 持有附属区：切换频道时重拉（loadMutesPage / loadChannelMemberIds）；
 *   成员集合另由 `membersVersion` 显式失效（新建 agent 自动加入 #all 后外部成员集已变，
 *   不切频道时也需重拉——旧语义只在 channelId 变化时加载，新成员恒 stale）。
 * - `togglePin / toggleMute` 只管切换与重拉收敛：toast 文案（mute.toastMuted 等）与
 *   成员增删（addChannelMember/removeChannelMember）留视图侧，hook 不持有 i18n/成员行状态。
 *   loadPinned 是 hook 内部私有的重拉原语（togglePin / reorderPinned / 切频道共用），不再导出。
 *
 * 04 票语义（与 ChannelView 旧内联实现一致）：
 * - `tasks / tasksError / taskNotice` 持有任务板数据循环：切换频道时重拉
 *   （loadTasksPage 经服务端按 number 升序），旧频道任务先清空避免闪现。
 * - `taskOps{claim,complete,unclaim,close,approve,reject,reopen}` 持有转移序列：
 *   claim 经 claimChannelTask（held/conflict/blocked 让路：提示 + 重拉，不抛错）；
 *   complete 经 completeTaskWithReply（先落线程回复再置 in_review，依赖 hook 内
 *   已有 postChannelMessage 发送通道：线程回复用线程版本 baseSeq，状态更新用频道版本）；
 *   其余转移（unclaim/close/approve/reject/reopen）经 updateChannelTaskStatus
 *   映射到目标状态（todo/closed/done/in_progress）；成功后重拉收敛。
 * - 创建两途径（convert/createBoard）与 reopen 封锁标记透出在纯函数层：
 *   convert 走 convertMessageToTaskRow（409 抛错由调用方提示），board 创建走
 *   createBoardTaskRow（服务端先发消息再建任务）；reopened=1 的行经 loadTasksPage
 *   原样返回，视图只做徽标展示（TaskCard 已有），claim 让路由 blocked 返回。
 * - toast 文案（tasks.held/tasks.denied/converted/created）与 invalid-drop 提示留视图侧，
 *   hook 只暴露 taskNotice/tasksError 状态与 setter 供视图写文案。
 */
export function useChannelData(
  channelId: string | undefined,
  t?: (key: string, params?: Record<string, string | number>) => string,
  membersVersion?: number,
) {
  const latestRequestRef = useRef(0);
  const cacheRef = useRef(new Map<string, ChannelMessagesPage>());
  /** 附属区分桶缓存：成员/mute/pinned/任务切回看过的频道直接命中快照，避免计数先空后闪。
   * pinned 缓存键含 sort（`cid:sort`），与服务端排序语义对齐。 */
  const membersCacheRef = useRef(new Map<string, Set<string>>());
  const mutesCacheRef = useRef(new Map<string, ChannelMuteRow[]>());
  const pinnedCacheRef = useRef(new Map<string, PinnedItem[]>());
  const tasksCacheRef = useRef(new Map<string, ChannelTask[]>());

  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [maxSeq, setMaxSeq] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 消息加载态：区分“正在拉新频道首屏”与“该频道真没消息”，避免切换时闪一下空态。
   * 缓存命中时为 false（直接画快照）；仅缓存未命中等待首包时为 true。 */
  const [messagesLoading, setMessagesLoading] = useState(true);
  // 02 票：发送通道状态——held 提示与发送并发锁。
  const [heldNotice, setHeldNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  // 03 票：pinned 数据循环 + 附属区状态。
  const [pinnedSort, setPinnedSort] = useState<PinnedSort>("manual");
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [pinnedError, setPinnedError] = useState<string | null>(null);
  const [mutes, setMutes] = useState<ChannelMuteRow[]>([]);
  const [channelMemberIds, setChannelMemberIds] = useState<Set<string>>(
    new Set(),
  );
  const [membersError, setMembersError] = useState<string | null>(null);
  /** 附属区加载态：首包回来前头部计数位显示占位符，不先画空再闪出数字。 */
  const [membersLoading, setMembersLoading] = useState(true);
  const [mutesLoading, setMutesLoading] = useState(true);
  const [pinnedLoading, setPinnedLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  // 04 票：任务板数据循环状态。
  const [tasks, setTasks] = useState<ChannelTask[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskNotice, setTaskNotice] = useState<string | null>(null);
  // 03 票：迟到响应守卫——pinned/mutes/members 重拉与频道切换竞速时丢弃旧频道响应。
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;
  const pinnedSortRef = useRef(pinnedSort);
  pinnedSortRef.current = pinnedSort;

  const loadPage = useCallback(
    (targetId: string, before?: number) => loadMessagesPage(targetId, before),
    [],
  );

  const loadLatest = useCallback(() => {
    const id = channelId;
    if (!id) return;
    const requestId = ++latestRequestRef.current;
    setLoadError(null);
    void loadPage(id)
      .then((page) => {
        // 切换频道时旧频道的迟到响应直接丢弃，避免旧内容闪现覆盖新频道。
        if (latestRequestRef.current !== requestId) return;
        cacheRef.current.set(id, page);
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setMaxSeq(page.maxSeq);
      })
      .catch((e) => {
        if (latestRequestRef.current !== requestId) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      });
  }, [channelId, loadPage]);

  // 03 票：pinned 列表加载（当前成员的个性化 pinned，排序三选一经服务端）。
  // 写 pinnedCache（键含 sort），供切换/切回直接命中快照。
  const loadPinned = useCallback(() => {
    const id = channelId;
    if (!id) {
      setPinnedItems([]);
      setPinnedLoading(false);
      return;
    }
    const sort = pinnedSortRef.current;
    void loadPinnedPage(id, sort)
      .then((items) => {
        if (channelIdRef.current !== id) return;
        pinnedCacheRef.current.set(`${id}:${sort}`, items);
        setPinnedItems(items);
        setPinnedError(null);
        setPinnedLoading(false);
      })
      .catch((e) => {
        if (channelIdRef.current !== id) return;
        setPinnedError(e instanceof Error ? e.message : String(e));
        setPinnedLoading(false);
      });
  }, [channelId]);

  // 04 票：任务板加载（服务端按 number 升序，含 reachable/reopened 视图附料）。
  // 写 tasksCache，供切换/切回直接命中快照。
  const loadTasks = useCallback(() => {
    const id = channelId;
    if (!id) {
      setTasks([]);
      setTasksLoading(false);
      return;
    }
    void loadTasksPage(id)
      .then((rows) => {
        if (channelIdRef.current !== id) return;
        tasksCacheRef.current.set(id, rows);
        setTasks(rows);
        setTasksError(null);
        setTasksLoading(false);
      })
      .catch((e) => {
        if (channelIdRef.current !== id) return;
        setTasksError(e instanceof Error ? e.message : String(e));
        setTasksLoading(false);
      });
  }, [channelId]);

  // 03 票：附属区加载（mute 列表 + 频道成员 id 集合）。写对应缓存，供切换/切回命中快照。
  const loadMutes = useCallback(() => {
    const id = channelId;
    if (!id) {
      setMutes([]);
      setMutesLoading(false);
      return;
    }
    void loadMutesPage(id)
      .then((rows) => {
        if (channelIdRef.current !== id) return;
        mutesCacheRef.current.set(id, rows);
        setMutes(rows);
        setMutesLoading(false);
      })
      .catch(() => {
        if (channelIdRef.current !== id) return;
        setMutesLoading(false);
      });
  }, [channelId]);

  const loadMembers = useCallback(() => {
    const id = channelId;
    if (!id) {
      setChannelMemberIds(new Set());
      setMembersLoading(false);
      return;
    }
    void loadChannelMemberIds(id)
      .then((ids) => {
        if (channelIdRef.current !== id) return;
        membersCacheRef.current.set(id, ids);
        setChannelMemberIds(ids);
        setMembersError(null);
        setMembersLoading(false);
      })
      .catch((e) => {
        if (channelIdRef.current !== id) return;
        setMembersError(e instanceof Error ? e.message : String(e));
        setMembersLoading(false);
      });
  }, [channelId]);

  // 成员集合显式失效：新建 agent 自动加入 #all 后外部成员集已变——不切频道时
  // loadMembers 重拉收敛（缓存键仍按 channelId，不污染切换频道的快照纪律）。
  // membersVersion 未传时不触发（旧调用方行为不变）。
  useEffect(() => {
    if (!shouldInvalidateMembers(membersVersion)) return;
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersVersion]);

  // 切换频道：缓存快照式替换 + 后台重拉；迟到响应由 requestId 丢弃。
  // 03 票：pinned/附属区随频道切换重拉（旧频道状态先清空，避免旧内容闪现）。
  useEffect(() => {
    latestRequestRef.current += 1;
    const requestId = latestRequestRef.current;
    const cid = channelId ?? "";
    const cached = cacheRef.current.get(cid);
    if (cached) {
      setMessages(cached.messages);
      setHasMore(cached.hasMore);
      setMaxSeq(cached.maxSeq);
      setLoadError(null);
      setMessagesLoading(false);
    } else {
      // 缓存未命中：先清空旧频道内容（避免把 A 频道的消息顶着 B 频道的标题展示），
      // 首包回来前只亮加载态，不画“该频道还没有消息”空态。
      setMessages([]);
      setHasMore(false);
      setMaxSeq(0);
      setMessagesLoading(true);
      setLoadError(null);
    }
    void loadPage(cid)
      .then((page) => {
        if (latestRequestRef.current !== requestId) return;
        const prev = cacheRef.current.get(cid);
        cacheRef.current.set(cid, page);
        setMessagesLoading(false);
        // 后台刷新与缓存一致时跳过 setState，避免重复 commit 造成的闪动。
        if (prev && isSameMessagesPage(prev, page)) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setMaxSeq(page.maxSeq);
      })
      .catch((e) => {
        if (latestRequestRef.current !== requestId) return;
        setMessagesLoading(false);
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    // 03 票：pinned/附属区随频道切换重拉。缓存命中直接画快照（不闪空）；
    // 未命中才清空旧值 + 亮 loading + 后台重拉（旧频道状态先清空，避免旧内容闪现）。
    // 04 票：任务板同策略（右键 Convert 判定依赖旧频道任务清空，仍先清空再快照覆盖）。
    const sortAtSwitch = pinnedSortRef.current;
    const cachedPinned = pinnedCacheRef.current.get(`${cid}:${sortAtSwitch}`);
    const cachedMutes = mutesCacheRef.current.get(cid);
    const cachedMembers = membersCacheRef.current.get(cid);
    const cachedTasks = tasksCacheRef.current.get(cid);
    if (cachedPinned) {
      setPinnedItems(cachedPinned);
      setPinnedError(null);
      setPinnedLoading(false);
    } else {
      setPinnedItems([]);
      setPinnedError(null);
      setPinnedLoading(true);
    }
    if (cachedMutes) {
      setMutes(cachedMutes);
      setMutesLoading(false);
    } else {
      setMutes([]);
      setMutesLoading(true);
    }
    if (cachedMembers) {
      setChannelMemberIds(cachedMembers);
      setMembersError(null);
      setMembersLoading(false);
    } else {
      setChannelMemberIds(new Set());
      setMembersError(null);
      setMembersLoading(true);
    }
    // 任务板：旧频道任务先清空（messages tab 右键 Convert 判定依赖），命中再覆盖。
    setTasks([]);
    setTasksError(null);
    setTasksLoading(true);
    if (cachedTasks) {
      setTasks(cachedTasks);
      setTasksLoading(false);
    }
    void loadPinnedPage(cid, pinnedSortRef.current)
      .then((items) => {
        if (latestRequestRef.current !== requestId) return;
        pinnedCacheRef.current.set(`${cid}:${pinnedSortRef.current}`, items);
        setPinnedItems(items);
        setPinnedLoading(false);
      })
      .catch((e) => {
        if (latestRequestRef.current !== requestId) return;
        setPinnedError(e instanceof Error ? e.message : String(e));
        setPinnedLoading(false);
      });
    void loadMutesPage(cid)
      .then((rows) => {
        if (latestRequestRef.current !== requestId) return;
        mutesCacheRef.current.set(cid, rows);
        setMutes(rows);
        setMutesLoading(false);
      })
      .catch(() => {
        if (latestRequestRef.current !== requestId) return;
        setMutesLoading(false);
      });
    // 04 票：任务板随频道切换重拉（旧频道任务已清空，重拉收敛到服务端事实）。
    void loadTasksPage(cid)
      .then((rows) => {
        if (latestRequestRef.current !== requestId) return;
        tasksCacheRef.current.set(cid, rows);
        setTasks(rows);
        setTasksLoading(false);
      })
      .catch((e) => {
        if (latestRequestRef.current !== requestId) return;
        setTasksError(e instanceof Error ? e.message : String(e));
        setTasksLoading(false);
      });
    void loadChannelMemberIds(cid)
      .then((ids) => {
        if (latestRequestRef.current !== requestId) return;
        membersCacheRef.current.set(cid, ids);
        setChannelMemberIds(ids);
        setMembersLoading(false);
      })
      .catch((e) => {
        if (latestRequestRef.current !== requestId) return;
        setMembersError(e instanceof Error ? e.message : String(e));
        setMembersLoading(false);
      });
    // loadPage 稳定引用，仅 channelId 变化时重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // 03 票：排序变化时重拉 pinned（与旧内联 `loadPinned` 依赖 [channel?.id, pinnedSort] 同语义）。
  const pinnedSortForEffect = pinnedSort;
  useEffect(() => {
    if (!channelId) return;
    const id = channelId;
    void loadPinnedPage(id, pinnedSortForEffect)
      .then((items) => {
        if (
          channelIdRef.current !== id ||
          pinnedSortRef.current !== pinnedSortForEffect
        )
          return;
        setPinnedItems(items);
        setPinnedError(null);
      })
      .catch((e) => {
        if (
          channelIdRef.current !== id ||
          pinnedSortRef.current !== pinnedSortForEffect
        )
          return;
        setPinnedError(e instanceof Error ? e.message : String(e));
      });
  }, [channelId, pinnedSortForEffect]);

  // agent-loop 回复轮询（§5.4）：增量合并新消息；合并出新消息时推进已读游标
  // （BAI-6：打开频道期间持续 /read，否则切走后残留陈旧角标）；后台 tab 暂停；卸载清理。
  useEffect(() => {
    if (!channelId) return;
    const cid = channelId;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled || document.hidden) return;
      // Thread 回复不改变 Channel maxSeq；刷新 Task 未读数独立于主序列是否有新消息。
      void loadTasksPage(cid)
        .then((rows) => {
          if (cancelled || channelIdRef.current !== cid) return;
          setTasks((current) => {
            const refreshed = mergeTaskUnreadCounts(current, rows);
            if (refreshed !== current) tasksCacheRef.current.set(cid, refreshed);
            return refreshed;
          });
        })
        .catch(() => undefined);
      void loadPage(cid)
        .then((page) => {
          if (cancelled) return;
          const prev = cacheRef.current.get(cid);
          const base: ChannelMessagesPage = prev ?? {
            messages: [],
            hasMore: false,
            maxSeq: 0,
          };
          const next = applyPollPage(base, page);
          if (next === base) return;
          cacheRef.current.set(cid, next);
          setMessages(next.messages);
          setHasMore(next.hasMore);
          setMaxSeq(next.maxSeq);
          // 打开中语义：本 hook 只为当前选中频道挂载，合并出新消息即 fire-and-forget
          // 推进已读游标（服务端幂等只前进；失败吞掉，不干扰消息合并）。
          void markChannelRead(cid).catch(() => undefined);
        })
        .catch(() => undefined);
    }, CHANNEL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [channelId, loadPage]);

  const loadEarlier = useCallback(() => {
    if (!channelId || !hasMore || messages.length === 0)
      return Promise.resolve();
    const before = messages[0].seq;
    return loadPage(channelId, before)
      .then((page) => {
        setMessages((prev) => prependPageMessages(prev, page.messages));
        setHasMore(page.hasMore);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [channelId, hasMore, messages, loadPage]);

  // 02 票：发送通道——baseSeq 携带、held 后重拉提示、成功后重拉收敛。
  // maxSeq 读 ref 快照：并发发送取调用时版本，避免闭包拿到旧 maxSeq。
  // 03 票同理：pinnedItems/mutes 读 ref 快照，避免 toggle/reorder 闭包拿到旧列表。
  const maxSeqRef = useRef(maxSeq);
  maxSeqRef.current = maxSeq;
  const pinnedItemsRef = useRef(pinnedItems);
  pinnedItemsRef.current = pinnedItems;
  const mutesRef = useRef(mutes);
  mutesRef.current = mutes;
  const send = useCallback(
    async (
      targetId: string,
      content: string,
      quoteId?: string,
      files?: File[],
    ): Promise<ChannelMessage | null> => {
      if (!channelId) return null;
      const baseSeq = maxSeqRef.current;
      const result = await postChannelMessage(
        targetId,
        content,
        quoteId,
        baseSeq,
        files,
      );
      if (result.kind === "held") {
        // held 语义与旧内联实现一致：记摘要 + 重拉提示 + 抛 held 文案（Composer 显示）。
        setHeldNotice(result.whatHappened);
        loadLatest();
        throw new Error(t ? t("message.held") : "message held");
      }
      loadLatest();
      return result.message;
    },
    [channelId, loadLatest, t],
  );

  // 03 票：pin/unpin 切换 + Manual 重排 + mute 开关——切换后重拉收敛
  // （与 ChannelView 旧内联 togglePin/movePinned/toggleMute 同语义，toast 文案留视图侧）。
  const togglePin = useCallback(
    async (messageId: string): Promise<void> => {
      if (!channelId) return;
      const alreadyPinned = pinnedItemsRef.current.some(
        (item) => item.message.id === messageId,
      );
      await togglePinnedMessage(channelId, messageId, alreadyPinned);
      loadPinned();
    },
    [channelId, loadPinned],
  );

  const reorderPinned = useCallback(
    async (index: number, direction: -1 | 1): Promise<void> => {
      if (!channelId) return;
      const items = pinnedItemsRef.current;
      const target = index + direction;
      if (target < 0 || target >= items.length) return;
      const reordered = [...items];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved);
      await postPinnedOrder(
        channelId,
        reordered.map((item) => item.message.id),
      );
      loadPinned();
    },
    [channelId, loadPinned],
  );

  const toggleMute = useCallback(
    async (memberId: string): Promise<boolean | null> => {
      if (!channelId) return null;
      const row = mutesRef.current.find((m) => m.memberId === memberId);
      if (!row) return null;
      const next = await toggleChannelMute(channelId, memberId, row.muted);
      const updated = mutesRef.current.map((x) =>
        x.memberId === memberId ? { ...x, muted: next } : x,
      );
      mutesCacheRef.current.set(channelId, updated);
      setMutes(updated);
      return next;
    },
    [channelId],
  );

  // 04 票：任务动作（claim / 转移序列）——与 ChannelView 旧内联 runTaskAction 同语义：
  // busyAction 沿旧语义是共享锁（channel 加入/离开/归档同锁）；held 后置 heldNotice +
  // taskNotice 摘要 + 重拉（loadTasks + loadLatest）；conflict/blocked 让路记 reason +
  // taskNotice，重拉不抛错。busy 时直接返回（与旧 `if (!channel || busyAction) return` 一致）。
  const runTaskTransition = useCallback(
    async (
      task: ChannelTask,
      action: "claim" | "updateStatus",
      status?: TaskStatus,
    ): Promise<void> => {
      if (!channelId || busyAction) return;
      setBusyAction(true);
      setTasksError(null);
      setTaskNotice(null);
      try {
        const baseSeq = maxSeqRef.current;
        const result =
          action === "claim"
            ? await claimChannelTask(task.id, baseSeq)
            : await updateChannelTaskStatus(task.id, status ?? "todo", baseSeq);
        if (result.kind === "held") {
          setHeldNotice(t ? t("tasks.held") : "task held");
          setTaskNotice(result.whatHappened);
        } else if (result.kind === "conflict" || result.kind === "blocked") {
          setTasksError(result.reason);
        }
        loadTasks();
        loadLatest();
      } catch (e) {
        setTasksError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyAction(false);
      }
    },
    [channelId, busyAction, loadTasks, loadLatest, t],
  );

  // 04 票：complete 两步（先落线程回复再置 in_review）——与 agent-loop runTaskOperation
  // 的 complete 同语义，依赖 hook 内已有 postChannelMessage 发送通道：
  // 线程回复用线程版本 baseSeq（调用方传入任务线程最后一条 seq），状态更新用
  // 频道版本（maxSeqRef 快照）；busy 沿旧 runTaskAction 同一共享锁；held 即停并提示 + 重拉。
  const completeTask = useCallback(
    async (
      task: ChannelTask,
      replyContent: string,
      threadBaseSeq: number,
    ): Promise<void> => {
      if (!channelId || busyAction) return;
      setBusyAction(true);
      setTasksError(null);
      setTaskNotice(null);
      try {
        const result = await completeTaskWithReply(
          task.id,
          task.message_id,
          replyContent,
          threadBaseSeq,
          maxSeqRef.current,
        );
        if (result.kind === "held") {
          setHeldNotice(t ? t("tasks.held") : "task held");
          setTaskNotice(result.whatHappened);
        } else if (result.kind === "conflict" || result.kind === "blocked") {
          setTasksError(result.reason);
        }
        loadTasks();
        loadLatest();
      } catch (e) {
        setTasksError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyAction(false);
      }
    },
    [channelId, busyAction, loadTasks, loadLatest, t],
  );

  // 04 票：创建两途径——convert 已有消息（409 抛错由调用方提示，与旧内联同语义：
  // tasks.alreadyTask 文案在视图侧组装，hook 只透出 tasksError/taskNotice 状态更新）；
  // board 创建走服务端先发消息再建任务；成功后重拉收敛（旧内联同语义：
  // convert 本地 append + notice，board 创建 notice + 双重拉——此处统一重拉收敛到服务端事实）。
  const convertToTask = useCallback(
    async (message: ChannelMessage): Promise<ChannelTask | null> => {
      if (!channelId) return null;
      try {
        const created = await convertMessageToTaskRow(message.id);
        if (channelId) {
          const prev = tasksCacheRef.current.get(channelId) ?? [];
          tasksCacheRef.current.set(channelId, [...prev, created]);
        }
        setTasks((prev) => [...prev, created]);
        setTaskNotice(
          t
            ? t("tasks.converted", { number: String(created.number) })
            : `task #${created.number}`,
        );
        return created;
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        setTasksError(text);
        setTaskNotice(text);
        return null;
      }
    },
    [channelId, t],
  );

  const createTaskFromBoard = useCallback(
    async (contentInput: string): Promise<void> => {
      if (!channelId) return;
      const content = contentInput.trim();
      if (!content) return;
      setTasksError(null);
      setTaskNotice(null);
      try {
        const created = await createBoardTaskRow(channelId, content);
        setTaskNotice(
          t
            ? t("tasks.created", { number: String(created.number) })
            : `task #${created.number}`,
        );
        loadTasks();
        loadLatest();
      } catch (e) {
        setTasksError(e instanceof Error ? e.message : String(e));
      }
    },
    [channelId, loadTasks, loadLatest, t],
  );

  // 04 票：任务转移入口按动作名收敛（票据 taskOps{claim,complete,unclaim,...} 的 interface 面）：
  // claim → runTaskTransition(claim)；complete → completeTask（两步）；其余转移
  // （unclaim/close/approve/reject/reopen）→ update-status 目标状态映射。
  const taskOps = useMemo(
    () => ({
      claim: (task: ChannelTask) => runTaskTransition(task, "claim"),
      complete: (
        task: ChannelTask,
        replyContent: string,
        threadBaseSeq: number,
      ) => completeTask(task, replyContent, threadBaseSeq),
      unclaim: (task: ChannelTask) =>
        runTaskTransition(task, "updateStatus", "todo"),
      close: (task: ChannelTask) =>
        runTaskTransition(task, "updateStatus", "closed"),
      approve: (task: ChannelTask) =>
        runTaskTransition(task, "updateStatus", "done"),
      reject: (task: ChannelTask) =>
        runTaskTransition(task, "updateStatus", "in_progress"),
      reopen: (task: ChannelTask) =>
        runTaskTransition(task, "updateStatus", "todo"),
    }),
    [runTaskTransition, completeTask],
  );

  return {
    messages,
    messagesLoading,
    maxSeq,
    hasMore,
    loadError,
    loadPage,
    loadLatest,
    loadEarlier,
    send,
    heldNotice,
    busyAction,
    setBusyAction,
    setHeldNotice,
    pinnedItems,
    pinnedSort,
    setPinnedSort,
    pinnedError,
    pinnedLoading,
    togglePin,
    reorderPinned,
    mutes,
    mutesLoading,
    loadMutes,
    toggleMute,
    channelMemberIds,
    membersLoading,
    membersError,
    loadMembers,
    tasks,
    tasksLoading,
    tasksError,
    taskNotice,
    setTasksError,
    setTaskNotice,
    loadTasks,
    runTaskTransition,
    completeTask,
    convertToTask,
    createTaskFromBoard,
    taskOps,
  };
}
