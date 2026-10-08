"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { previewLine } from "@/lib/preview";
import { Composer, MessageRow, type ChannelMessage, type ChannelWithMeta, type ReactionSummary } from "./ChannelView";
import { mergeIncomingMessages } from "@/hooks/useChannelData";
import { ReminderModal } from "./ReminderModal";
import type { MemberRow } from "@/lib/data/types";
import { memberPanel, type PanelContent } from "@/lib/panel-state";
import { composerMentionCandidates } from "@/lib/mention";

/** 面板线程轮询间隔（与中央轮询同纪律：3s、后台 tab 暂停、卸载清理）。 */
const THREAD_POLL_MS = 3000;

/**
 * 右栏面板：线程视图（ticket 13 从 ChannelView 迁出）。
 *
 * 锚点 + 消息列表 + composer + 引用 + 轮询（agent 在任务线程里的回复自动冒出）；
 * freshness baseSeq 按线程自己的 seq 空间（最后一条消息的 seq），并发下收到 held 提示而非静默丢消息。
 * 引用态是面板局部的——与中央 composer 互不污染。
 *
 * 形态（票 07）：根是 fragment——头（`.tt-summary` sticky）/ 滚动区（`.tt-scroll`）/ composer 槽
 * （`.tt-reply`）是 `.dock` 单槽容器（DetailPanel）的 flex 子项（与上游 `.dock` 内含 `.dock-head` /
 * `.dock-scroll` 同形）。**零行为改动**：轮询 / freshness / 引用态 / 动作栏门控一字未动。
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

  /** @ 提及补全候选 = 频道成员 agent（§3.2，镜像中央 Composer；非成员手输名字仍可穿透唤醒）。 */
  const mentionable = useMemo(
    () => composerMentionCandidates(agents ?? [], channelMemberIds),
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
    <>
      <div
        className="tt-summary"
        style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}
      >
        <span className="tt-title">
          {t("message.thread")} {anchor ? `#${anchor.seq}` : ""}
        </span>
        {error && (
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: "var(--fs-mono-xs)",
              color: "var(--error)",
            }}
          >
            {error}
          </span>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={t("detail.close")}
          title={t("detail.close")}
          onClick={onClose}
          style={{ marginLeft: "auto" }}
        >
          <X size={15} style={{ display: "block" }} />
        </button>
      </div>
      {/* `.tt-scroll` 的内边距是给 `.tt-log` 条目的；此处装的是 `.ws-message-row`（自带 `10px 16px`），
          再叠一层会双重缩进——故只取滚动职责，内边距归零（见 globals.css 裁剪登记 ④）。 */}
      <div className="tt-scroll" style={{ padding: 0 }}>
        {anchor && (
          <MessageRow
            message={anchor}
            isAnchor
            currentMemberId={currentMemberId}
            canConvertToTask={!taskMessageIds.has(anchor.id)}
            mentionMembers={mentionMembers}
            onOpenMention={openMention}
            onOpenMember={(memberId) => onOpenPanel(memberPanel(memberId, false))}
            onQuote={setQuoting}
            onCopyLink={(target) => void handleCopyLink(target)}
            onConvertToTask={(target) => void convertAnchorToTask(target)}
            onSetReminder={joined ? openAnchorReminder : undefined}
            onToggleReaction={joined ? toggleReaction : undefined}
          />
        )}
        {loading ? (
          <div className="tt-empty">{t("message.threadLoading")}</div>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              currentMemberId={currentMemberId}
              canConvertToTask={false}
              mentionMembers={mentionMembers}
              onOpenMention={openMention}
              onOpenMember={(memberId) => onOpenPanel(memberPanel(memberId, false))}
              onQuote={setQuoting}
              onCopyLink={(target) => void handleCopyLink(target)}
              onToggleReaction={joined ? toggleReaction : undefined}
            />
          ))
        )}
      </div>
      <div className="tt-reply">
        <Composer
          targetId={anchor?.id ?? anchorId}
          disabled={composerDisabled}
          disabledHint={composerDisabledHint}
          quoting={quoting}
          onClearQuote={() => setQuoting(null)}
          onSend={handleSend}
          members={mentionable}
        />
      </div>
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
    </>
  );
}
