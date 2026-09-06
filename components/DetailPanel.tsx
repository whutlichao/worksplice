"use client";

import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { AgentDetailPanel } from "./AgentDetailPanel";
import { ThreadPanel } from "./ThreadPanel";
import { PixelAvatar } from "./PixelAvatar";
import { StatusDot } from "./StatusDot";
import type { ChannelWithMeta } from "./ChannelView";
import type { MemberRow } from "@/lib/data/types";
import type { PanelContent } from "@/lib/panel-state";

const INK = "#141111";

/**
 * 右栏单槽容器（ticket 13）：按 kind 分派——agent → AgentDetailPanel（内容原样），
 * human → 薄资料卡，thread → 线程面板。非长驻：panelContent 为 null 时整栏不渲染（AppShell 侧）。
 * 打开任意内容即替换（单槽互斥，无栈/无回退）。
 */
export function DetailPanel({
  content,
  channel,
  agents,
  owner,
  currentMemberId,
  onClose,
  onChanged,
  onOpenPanel,
  onOpenDM,
  dmHasMessages,
}: {
  content: NonNullable<PanelContent>;
  channel: ChannelWithMeta | null;
  agents: MemberRow[];
  owner: MemberRow | null;
  currentMemberId: string;
  onClose: () => void;
  onChanged: () => void;
  /** 面板内跳转（线程内 mention 点击）：单槽替换面板内容（AppShell.openPanel）。 */
  onOpenPanel: (content: PanelContent) => void;
  /** DM 懒创建入口（上抛至 AppShell）：幂等建/取 DM → 导航中央 + 聚焦 composer + 关面板。 */
  onOpenDM: (agentId: string) => void;
  /** 当前 agent 面板的 DM 是否已有消息（文案动态：发送消息 / 打开私信）。 */
  dmHasMessages?: boolean;
}) {
  switch (content.kind) {
    case "agent": {
      const agent = agents.find((a) => a.id === content.id);
      if (!agent) return null;
      return (
        <AgentDetailPanel
          agent={agent}
          onClose={onClose}
          onChanged={onChanged}
          onOpenDM={onOpenDM}
          hasMessages={dmHasMessages}
        />
      );
    }
    case "human": {
      // 人类 = Owner（恒为唯一 human 成员）；找不到（删除/未加载）时面板空渲染
      const human = owner && owner.id === content.id ? owner : null;
      if (!human) return null;
      return <HumanProfileCard member={human} onClose={onClose} />;
    }
    case "thread": {
      return (
        <ThreadPanel
          anchorId={content.id}
          channel={channel}
          currentMemberId={currentMemberId}
          agents={agents}
          owner={owner}
          onOpenPanel={onOpenPanel}
          onClose={onClose}
        />
      );
    }
  }
}

/** 人类成员薄资料卡：avatar / name / role / description / status（非阻塞，与 agent 同一容器同一生命周期）。 */
function HumanProfileCard({
  member,
  onClose,
}: {
  member: MemberRow;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <header
        style={{
          flexShrink: 0,
          padding: "14px 16px 12px",
          borderBottom: `2px solid ${INK}`,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <PixelAvatar seed={member.id} name={member.name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontFamily: "var(--font-hanken)",
                  fontWeight: 700,
                  fontSize: 17,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {member.name}
              </span>
              <StatusDot status={member.status} />
              <span
                style={{
                  fontFamily: "var(--font-space-mono)",
                  fontSize: 10,
                  padding: "1px 6px",
                  border: `2px solid ${INK}`,
                  background:
                    member.role === "owner" ? "var(--yellow)" : "#ffffff",
                  color: "var(--text)",
                }}
              >
                {member.role === "owner" ? t("role.owner") : t("role.member")}
              </span>
            </div>
            <div
              style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}
            >
              {t("status." + member.status)}
            </div>
          </div>
          <button
            type="button"
            aria-label={t("detail.close")}
            title={t("detail.close")}
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              background: "#ffffff",
              border: `2px solid ${INK}`,
              boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
              cursor: "pointer",
              color: "var(--text)",
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            <X size={13} style={{ display: "block", margin: "auto" }} />
          </button>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 12px 20px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-space-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
            margin: "16px 2px 6px",
          }}
        >
          {t("memberProfile.description")}
        </div>
        <div
          style={{
            background: "#ffffff",
            border: `2px solid ${INK}`,
            boxShadow: "var(--shadow-sm)",
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--text)",
          }}
        >
          {member.description?.trim() ? (
            member.description.trim()
          ) : (
            <span style={{ color: "var(--text-dim)" }}>
              {t("memberProfile.noDescription")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
