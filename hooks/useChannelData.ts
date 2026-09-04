"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelMessage } from "@/components/ChannelView";

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
  const merged = [...prev, ...incoming.filter((m) => !prev.some((p) => p.id === m.id))];
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
  const res = await fetchFn(`/api/channels/${encodeURIComponent(targetId)}/messages?${params}`);
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

/** 发送结果：sent 携带服务端回写的消息；held 携带并发摘要（§6.3 freshness-hold）。 */
export type SendChannelMessageResult =
  | { kind: "sent"; message: ChannelMessage }
  | { kind: "held"; whatHappened: string };

/** 发送一条频道消息（纯函数：fetch 可注入，便于测试）。
 *
 * 与 ChannelView 旧内联 handleSend 同语义：baseSeq = 发送时的房间版本；
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
    if (body.held) return { kind: "held", whatHappened: body.whatHappened ?? "held" };
    throw new Error(body.error ?? `POST messages: ${res.status}`);
  }
  if (body.message) return { kind: "sent", message: body.message };
  throw new Error("POST messages: empty response");
}

/**
 * 频道消息数据循环（01 票：轮询 + merge + maxSeq/hasMore；02 票：发送 + held + busyAction）。
 *
 * ChannelView 只做排版：消息状态、分页、轮询合并、发送通道全部经此 hook。
 * 缓存按频道分桶（切回看过的频道直接命中快照），请求代际丢弃迟到响应。
 *
 * 02 票语义（与 ChannelView 旧内联实现一致）：
 * - `send` 携带 baseSeq（调用时的 maxSeq）；held 后置 heldNotice + 重拉（loadLatest）+ 抛 held 文案。
 * - 发送成功后经 loadLatest 重拉收敛（append 入口是后续票的事，本票不做乐观追加）。
 * - `send` 只管发送与 held 收敛：quoting 清理与 As Task 转化留视图侧（handleSend 内），hook 不持有引用/As Task 状态。
 * - `busyAction` 沿旧语义由视图侧任务动作（runTaskAction）驱动（与旧内联 useState 同一共享锁）；
 *   `send` 本体不加锁（与旧 handleSend 一致，Composer 的 busy 态只反映任务动作）。
 */
export function useChannelData(channelId: string | undefined, t?: (key: string) => string) {
  const latestRequestRef = useRef(0);
  const cacheRef = useRef(new Map<string, ChannelMessagesPage>());

  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [maxSeq, setMaxSeq] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 02 票：发送通道状态——held 提示与发送并发锁。
  const [heldNotice, setHeldNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

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

  // 切换频道：缓存快照式替换 + 后台重拉；迟到响应由 requestId 丢弃。
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
    } else {
      setMessages([]);
      setHasMore(false);
      setMaxSeq(0);
      setLoadError(null);
    }
    void loadPage(cid)
      .then((page) => {
        if (latestRequestRef.current !== requestId) return;
        const prev = cacheRef.current.get(cid);
        cacheRef.current.set(cid, page);
        // 后台刷新与缓存一致时跳过 setState，避免重复 commit 造成的闪动。
        if (prev && isSameMessagesPage(prev, page)) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setMaxSeq(page.maxSeq);
      })
      .catch((e) => {
        if (latestRequestRef.current !== requestId) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    // loadPage 稳定引用，仅 channelId 变化时重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // agent-loop 回复轮询（§5.4）：增量合并新消息；后台 tab 暂停；卸载清理。
  useEffect(() => {
    if (!channelId) return;
    const cid = channelId;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled || document.hidden) return;
      void loadPage(cid)
        .then((page) => {
          if (cancelled) return;
          const prev = cacheRef.current.get(cid);
          const base: ChannelMessagesPage = prev ?? { messages: [], hasMore: false, maxSeq: 0 };
          const next = applyPollPage(base, page);
          if (next === base) return;
          cacheRef.current.set(cid, next);
          setMessages(next.messages);
          setHasMore(next.hasMore);
          setMaxSeq(next.maxSeq);
        })
        .catch(() => undefined);
    }, CHANNEL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [channelId, loadPage]);

  const loadEarlier = useCallback(() => {
    if (!channelId || !hasMore || messages.length === 0) return Promise.resolve();
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
  const maxSeqRef = useRef(maxSeq);
  maxSeqRef.current = maxSeq;
  const send = useCallback(
    async (
      targetId: string,
      content: string,
      quoteId?: string,
      files?: File[],
    ): Promise<ChannelMessage | null> => {
      if (!channelId) return null;
      const baseSeq = maxSeqRef.current;
      const result = await postChannelMessage(targetId, content, quoteId, baseSeq, files);
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

  return { messages, maxSeq, hasMore, loadError, loadPage, loadLatest, loadEarlier, send, heldNotice, busyAction, setBusyAction, setHeldNotice };
}
