"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { previewLine } from "@/lib/preview";
import { Composer, MessageRow, mergeIncomingMessages, type ChannelMessage, type ChannelWithMeta, type PinnedItem, type ReactionSummary } from "./ChannelView";
import { ReminderModal } from "./ReminderModal";
import type { MemberRow } from "@/lib/data/db";
import { memberPanel, notifyPinnedChanged, type PanelContent } from "@/lib/panel-state";

const INK = "#141111";
/** 面板线程轮询间隔（与中央轮询同纪律：3s、后台 tab 暂停、卸载清理）。 */
const THREAD_POLL_MS = 3000;

/**
 * 右栏面板：线程视图（ticket 13 从 ChannelView 迁出）。
 *
 * 锚点 + 消息列表 + composer + 引用 + 轮询（agent 在任务线程里的回复自动冒出）；
 * freshness baseSeq 按线程自己的 seq 空间（最后一条消息的 seq），并发下收到 held 提示而非静默丢消息。
 * 引用态是面板局部的——与中央 composer 互不污染。
 */
export function ThreadPanel({
  anchorId,
  channel,
  currentMemberId,
  agents,
  owner,
  onOpenPanel,
  onClose,
  initialAnchor,
  initialMessages,
}: {
  anchorId: string;
  channel: ChannelWithMeta | null;
  currentMemberId: string;
  agents?: MemberRow[];
  owner?: MemberRow | null;
  onOpenPanel: (content: PanelContent) => void;
  onClose: () => void;
  /** 测试注入：初始锚点与消息（生产走 anchorId 拉取）。 */
  initialAnchor?: ChannelMessage | null;
  initialMessages?: ChannelMessage[];
}) {
  const { t } = useI18n();

  const [anchor, setAnchor] = useState<ChannelMessage | null>(initialAnchor ?? null);
  const [messages, setMessages] = useState<ChannelMessage[]>(initialMessages ?? []);
  const [loading, setLoading] = useState(!initialAnchor);
  const [error, setError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState<ChannelMessage | null>(null);

  // §3.5 pinned（当前成员在该 channel 的个性化 pinned）：面板本地拉取，按钮态与频道区共用服务端事实
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);

  // §5.6 提醒弹窗（锚点消息动作栏 ⏰，与旧 thread 侧栏一致——只锚点行提供）
  const [reminderTarget, setReminderTarget] = useState<{
    targetId: string;
    targetLabel: string;
    defaultTitle?: string;
  } | null>(null);

  // §3.7 任务：锚点行"Convert to Task"判定（已转任务不显示菜单项）
  const [taskMessageIds, setTaskMessageIds] = useState<Set<string>>(new Set());

  // 👥 频道成员 id 集合（@ 补全的 joined 标记 + mention 渲染）
  const [channelMemberIds, setChannelMemberIds] = useState<Set<string>>(new Set());

  /** @ 提及补全候选 = 全部 agent + joined 标记（§3.2，镜像中央 Composer 的形态）。 */
  const mentionable = useMemo(
    () =>
      (agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        joined: channelMemberIds.has(a.id),
      })),
    [agents, channelMemberIds],
  );

  /** §3.2 mention 渲染成员表（agents + owner 全量，高亮解析用）。 */
  const mentionMembers = useMemo(
    () =>
      [...(agents ?? []), ...(owner ? [owner] : [])].map((m) => ({
        id: m.id,
        name: m.name,
        type: m.type,
      })),
    [agents, owner],
  );

  const loadThread = useCallback(async (messageId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}/thread`);
      if (!res.ok) throw new Error(`GET thread: ${res.status}`);
      const body = (await res.json()) as { anchor: ChannelMessage; messages: ChannelMessage[] };
      setAnchor(body.anchor);
      setMessages(body.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 锚点变化 → 全量重拉（测试注入 initialAnchor 时跳过）
  useEffect(() => {
    if (initialAnchor) return;
    void loadThread(anchorId);
  }, [anchorId, initialAnchor, loadThread]);

  /** §3.5 pinned 列表加载（按钮态 = pinnedItems 含该消息；排序不影响判定）。 */
  const loadPinned = useCallback(() => {
    if (!channel) return;
    void fetch(`/api/channels/${encodeURIComponent(channel.id)}/pinned?sort=manual`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET pinned: ${res.status}`);
        const body = (await res.json()) as { pinned?: PinnedItem[] };
        setPinnedItems(body.pinned ?? []);
      })
      .catch(() => undefined);
  }, [channel]);

  useEffect(() => {
    loadPinned();
  }, [loadPinned]);

  /** §3.7 频道任务列表（只用于锚点行 Convert to Task 判定）。 */
  const loadTasks = useCallback(() => {
    if (!channel) return;
    void fetch(`/api/channels/${encodeURIComponent(channel.id)}/tasks`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET tasks: ${res.status}`);
        const body = (await res.json()) as { tasks?: Array<{ message_id: string }> };
        setTaskMessageIds(new Set((body.tasks ?? []).map((task) => task.message_id)));
      })
      .catch(() => undefined);
  }, [channel]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  /** 👥 频道成员加载（@ 补全 joined 标记）。 */
  const loadMembers = useCallback(() => {
    if (!channel) {
      setChannelMemberIds(new Set());
      return;
    }
    void fetch(`/api/channels/${encodeURIComponent(channel.id)}/members`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET members: ${res.status}`);
        const body = (await res.json()) as { members?: MemberRow[] };
        setChannelMemberIds(new Set((body.members ?? []).map((m) => m.id)));
      })
      .catch(() => undefined);
  }, [channel]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // 面板线程轮询：与中央轮询并存为两套循环——agent 在任务线程里的回复自动冒出
  useEffect(() => {
    if (!anchorId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled || document.hidden) return;
      void fetch(`/api/messages/${encodeURIComponent(anchorId)}/thread`)
        .then(async (res) => {
          if (!res.ok || cancelled) return;
          const body = (await res.json()) as { anchor: ChannelMessage; messages: ChannelMessage[] };
          // 初始拉取失败（anchor 为 null）时轮询自愈：只要服务端锚点仍指向同一消息即采纳
          setAnchor((prev) => (!prev || prev.id === body.anchor.id ? body.anchor : prev));
          setMessages((prev) => mergeIncomingMessages(prev, body.messages));
        })
        .catch(() => undefined);
    }, THREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [anchorId]);

  const joined = channel?.joined ?? false;
  const isArchived = channel?.archived === 1;
  const composerDisabled = !channel || !joined || isArchived;
  const composerDisabledHint = !channel
    ? ""
    : isArchived
      ? t("message.archivedHint")
      : joined
        ? ""
        : t("message.joinHint");

  /** 线程发送：freshness baseSeq = 线程最后一条 seq（自己的 seq 空间）；held → 重拉 + 提示。 */
  const handleSend = useCallback(
    async (targetId: string, content: string, quoteId?: string, files?: File[]) => {
      const baseSeq = messages[messages.length - 1]?.seq ?? 0;
      let res: Response;
      if (files && files.length > 0) {
        const form = new FormData();
        form.append("targetId", targetId);
        form.append("content", content);
        form.append("baseSeq", String(baseSeq));
        if (quoteId) form.append("quoteId", quoteId);
        for (const file of files) form.append("files", file);
        res = await fetch("/api/messages", { method: "POST", body: form });
      } else {
        res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId, content, quoteId, baseSeq }),
        });
      }
      const body = (await res.json().catch(() => ({}))) as {
        message?: ChannelMessage;
        held?: boolean;
        error?: string;
      };
      if (!res.ok) {
        if (body.held) {
          void loadThread(anchorId);
          throw new Error(t("message.held"));
        }
        throw new Error(body.error ?? `POST messages: ${res.status}`);
      }
      if (body.message) {
        setMessages((prev) => [...prev, body.message as ChannelMessage]);
      }
      setQuoting(null);
    },
    [messages, anchorId, loadThread, t],
  );

  /** §3.4 reaction 切换：线程内消息各自更新（锚点与列表同步）。 */
  const toggleReaction = useCallback(async (message: ChannelMessage, emoji: string) => {
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(message.id)}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!res.ok) throw new Error(`reaction: ${res.status}`);
      const body = (await res.json()) as { reactions?: ReactionSummary[] };
      if (!body.reactions) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, reactions: body.reactions } : m)),
      );
      setAnchor((prev) =>
        prev && prev.id === message.id ? { ...prev, reactions: body.reactions } : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** §3.5 pin / unpin：切换后重拉本地 pinned 列表（服务端事实）。 */
  const togglePin = useCallback(
    async (message: ChannelMessage) => {
      if (!channel) return;
      const alreadyPinned = pinnedItems.some((item) => item.message.id === message.id);
      try {
        const res = alreadyPinned
          ? await fetch(`/api/channels/${encodeURIComponent(channel.id)}/pinned?messageId=${message.id}`, {
              method: "DELETE",
            })
          : await fetch(`/api/channels/${encodeURIComponent(channel.id)}/pinned`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messageId: message.id }),
            });
        if (!res.ok) throw new Error(`pin: ${res.status}`);
        loadPinned();
        // ticket 13：通知中央频道重拉 pinned（面板/中央双端收敛到服务端事实）
        notifyPinnedChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [channel, pinnedItems, loadPinned],
  );

  const handleCopyLink = async (message: ChannelMessage) => {
    const url = `${window.location.origin}${window.location.pathname}#c/${encodeURIComponent(channel?.id ?? "")}?m=${message.id}`;
    await copyText(url);
  };

  /** 把锚点消息转为任务（§3.7 创建途径 1）。 */
  const convertAnchorToTask = useCallback(
    async (msg: ChannelMessage): Promise<void> => {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: msg.id }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          task?: { message_id: string };
          error?: string;
        };
        if (!res.ok) {
          if (res.status === 409) throw new Error(t("tasks.alreadyTask"));
          throw new Error(body.error ?? `convert to task: ${res.status}`);
        }
        if (body.task) {
          setTaskMessageIds((prev) => new Set(prev).add(body.task!.message_id));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [t],
  );

  /** mention 点击（§3.2）：agent / 人类都进右栏面板（单槽替换）。 */
  const openMention = useCallback(
    (token: { memberId: string; name: string; isHuman: boolean }) => {
      onOpenPanel(memberPanel(token.memberId, token.isHuman));
    },
    [onOpenPanel],
  );

  /** 锚点消息提醒入口（§5.6，与旧 thread 侧栏一致：只锚点行提供）。 */
  const openAnchorReminder = (message: ChannelMessage) => {
    setReminderTarget({
      targetId: message.id,
      targetLabel: `#${message.seq} ${message.author?.name ?? ""}`.trim(),
      defaultTitle: previewLine(message.content, 60),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: `2px solid ${INK}`,
          background: "var(--yellow)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-hanken)", fontWeight: 700, fontSize: 14 }}>
          {t("message.thread")} {anchor ? `#${anchor.seq}` : ""}
        </span>
        {error && (
          <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 10, color: "var(--coral)" }}>
            {error}
          </span>
        )}
        <button
          type="button"
          aria-label={t("detail.close")}
          onClick={onClose}
          style={{
            marginLeft: "auto",
            width: 24,
            height: 24,
            background: "#ffffff",
            border: `2px solid ${INK}`,
            cursor: "pointer",
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          <X size={13} style={{ display: "block", margin: "auto" }} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {anchor && (
          <MessageRow
            message={anchor}
            isAnchor
            currentMemberId={currentMemberId}
            pinned={pinnedItems.some((item) => item.message.id === anchor.id)}
            canConvertToTask={!taskMessageIds.has(anchor.id)}
            mentionMembers={mentionMembers}
            onOpenMention={openMention}
            onReply={() => undefined}
            onQuote={setQuoting}
            onCopyLink={(target) => void handleCopyLink(target)}
            onConvertToTask={(target) => void convertAnchorToTask(target)}
            onSetReminder={joined ? openAnchorReminder : undefined}
            onToggleReaction={joined ? toggleReaction : undefined}
            onTogglePin={joined ? togglePin : undefined}
          />
        )}
        {loading ? (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>
            {t("message.threadLoading")}
          </div>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              currentMemberId={currentMemberId}
              pinned={pinnedItems.some((item) => item.message.id === m.id)}
              canConvertToTask={false}
              mentionMembers={mentionMembers}
              onOpenMention={openMention}
              onReply={() => undefined}
              onQuote={setQuoting}
              onCopyLink={(target) => void handleCopyLink(target)}
              onToggleReaction={joined ? toggleReaction : undefined}
              onTogglePin={joined ? togglePin : undefined}
            />
          ))
        )}
      </div>
      <Composer
        targetId={anchor?.id ?? anchorId}
        disabled={composerDisabled}
        disabledHint={composerDisabledHint}
        quoting={quoting}
        onClearQuote={() => setQuoting(null)}
        onSend={handleSend}
        members={mentionable}
      />
      {reminderTarget && (
        <ReminderModal
          targetId={reminderTarget.targetId}
          targetLabel={reminderTarget.targetLabel}
          defaultTitle={reminderTarget.defaultTitle}
          channelId={channel?.id ?? ""}
          onClose={() => setReminderTarget(null)}
          onChanged={() => void loadThread(anchorId)}
        />
      )}
    </div>
  );
}
