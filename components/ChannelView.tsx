"use client";

import { useI18n } from "@/hooks/useI18n";
import type { ChannelRow } from "@/lib/data/db";

export type CenterTab = "messages" | "tasks";

const INK = "#141111";

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-space-mono)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "2px 7px",
        border: `2px solid ${INK}`,
        background: "#ffffff",
        color: "var(--text-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function EmptyState({
  glyph,
  title,
  hint,
  children,
}: {
  glyph: string;
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          display: "grid",
          placeItems: "center",
          background: "#ffffff",
          border: `2px solid ${INK}`,
          boxShadow: "var(--shadow-md)",
          fontFamily: "var(--font-space-mono)",
          fontSize: 36,
          fontWeight: 700,
          color: "var(--text)",
        }}
      >
        {glyph}
      </div>
      <div
        style={{
          fontFamily: "var(--font-hanken)",
          fontWeight: 700,
          fontSize: 17,
          marginTop: 6,
        }}
      >
        {title}
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 340, lineHeight: 1.6 }}>
        {hint}
      </div>
      {children}
    </div>
  );
}

/** 中央：channel 消息流 / Tasks tab（§3.1）。消息与任务数据随后续里程碑接入，当前为空态。 */
export function ChannelView({
  channel,
  tab,
  onTabChange,
}: {
  channel: ChannelRow | null;
  tab: CenterTab;
  onTabChange: (tab: CenterTab) => void;
}) {
  const { t } = useI18n();

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: "var(--font-hanken)",
    fontWeight: 700,
    fontSize: 13,
    padding: "9px 16px",
    cursor: "pointer",
    background: active ? "var(--yellow)" : "transparent",
    color: "var(--text)",
    border: `2px solid ${INK}`,
    borderBottom: "none",
    marginBottom: -2,
    boxShadow: active ? "2px 2px 0 0 rgba(20, 17, 17, 0.45)" : "none",
    position: "relative",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* channel 头部：名称 + 类型/归档 badge + 描述（§3.1） */}
      <header
        className="ws-center-header"
        style={{
          flexShrink: 0,
          padding: "14px 16px 10px",
          borderBottom: `2px solid ${INK}`,
          background: "var(--bg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: "-0.01em",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontFamily: "var(--font-space-mono)", color: "var(--text-muted)" }}>
              #
            </span>
            {channel?.name ?? t("shell.selectChannel")}
          </h1>
          {channel && (
            <>
              <Badge>{channel.type === "private" ? t("channel.private") : t("channel.public")}</Badge>
              {channel.archived === 1 && <Badge>{t("channel.archived")}</Badge>}
            </>
          )}
        </div>
        {channel?.description ? (
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            {channel.description}
          </p>
        ) : null}
      </header>

      {/* Messages / Tasks tab（§3.1） */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "0 16px",
          borderBottom: `2px solid ${INK}`,
          flexShrink: 0,
        }}
        role="tablist"
      >
        {(["messages", "tasks"] as const).map((tabId) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={tab === tabId}
            onClick={() => onTabChange(tabId)}
            style={tabButtonStyle(tab === tabId)}
          >
            {tabId === "messages" ? t("center.messages") : t("center.tasks")}
          </button>
        ))}
      </div>

      {/* 主体 */}
      <main
        className="overflow-x-hidden overflow-y-auto"
        style={{
          flex: 1,
          minHeight: 0,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {tab === "messages" ? (
          <EmptyState glyph="#" title={t("messages.empty")} hint={t("messages.emptyHint")} />
        ) : (
          <EmptyState
            glyph="✓"
            title={t("tasks.empty")}
            hint={t("tasks.emptyHint")}
          >
            <button
              type="button"
              disabled
              title={t("agent.pending")}
              style={{
                marginTop: 10,
                padding: "7px 14px",
                fontFamily: "var(--font-hanken)",
                fontWeight: 700,
                fontSize: 13,
                background: "#ffffff",
                color: "var(--text-dim)",
                border: `2px solid ${INK}`,
                cursor: "not-allowed",
                opacity: 0.55,
              }}
            >
              + {t("tasks.new")}
            </button>
          </EmptyState>
        )}
      </main>
    </div>
  );
}
