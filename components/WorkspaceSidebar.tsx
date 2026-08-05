"use client";

import { useState } from "react";
import { AlarmClock, Search, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { PixelAvatar } from "./PixelAvatar";
import { StatusDot } from "./StatusDot";
import type { ChannelRow, MemberRow } from "@/lib/data/db";

const INK = "#141111";
const LABEL_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-space-mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  padding: "10px 12px 4px",
};

const PRESS_STYLE = {
  boxShadow: "1px 1px 0 0 rgba(20, 17, 17, 0.55)",
  transform: "translate(2px, 2px)",
} as const;

const REST_STYLE = {
  boxShadow: "3px 3px 0 0 rgba(20, 17, 17, 0.55)",
  transform: "none",
} as const;

/**
 * 左栏（ticket 13）：只高亮频道行（中央 = 当前频道）；agent 行点击 = 打开右栏面板，无选中态。
 * 中央与面板状态解耦：选中 agent 不再触碰中央频道。
 */
export function WorkspaceSidebar({
  channels,
  agents,
  error,
  selectedChannelId,
  onSelectChannel,
  onOpenAgent,
  onNewChannel,
  onNewAgent,
  onOpenModels,
  onOpenSkills,
  onOpenReminders,
  scheduledReminderCount,
  onCloseMenu,
  onSearch,
}: {
  channels: ChannelRow[];
  agents: MemberRow[];
  error: string | null;
  selectedChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  onOpenAgent: (agentId: string) => void;
  onNewChannel: () => void;
  onNewAgent: () => void;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenReminders: () => void;
  scheduledReminderCount: number;
  onCloseMenu: () => void;
  onSearch: (query: string) => void;
}) {
  const { t, locale, setLocale, supportedLocales } = useI18n();
  // §6.4 搜索入口：Enter 发起全文搜索（结果在中央 SearchView，打开动作深链定位）
  const [searchDraft, setSearchDraft] = useState("");

  const rowStyle = (isSelected: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 10px",
    marginBottom: 4,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "var(--font-space-grotesk)",
    fontSize: 13,
    fontWeight: isSelected ? 700 : 500,
    color: "var(--text)",
    background: isSelected ? "var(--yellow)" : "transparent",
    border: `2px solid ${INK}`,
    borderColor: isSelected ? INK : "transparent",
    boxShadow: isSelected ? "2px 2px 0 0 rgba(20, 17, 17, 0.45)" : "none",
    transition: "background 0.08s, box-shadow 0.08s, transform 0.08s",
  });

  const actionButton = (pink: boolean): React.CSSProperties => ({
    flex: 1,
    height: 30,
    background: pink ? "var(--pink)" : "#ffffff",
    color: INK,
    border: `2px solid ${INK}`,
    boxShadow: pink ? "3px 3px 0 0 rgba(20, 17, 17, 0.55)" : "2px 2px 0 0 rgba(20, 17, 17, 0.35)",
    cursor: "pointer",
    fontFamily: "var(--font-hanken)",
    fontWeight: 700,
    fontSize: 12,
    transition: "box-shadow 0.08s, transform 0.08s",
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
      }}
    >
      {/* 品牌头 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 12px 10px",
          borderBottom: `2px solid ${INK}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            display: "inline-block",
            background: "var(--yellow)",
            border: `2px solid ${INK}`,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-hanken)",
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: "-0.02em",
            color: "var(--text)",
            flex: 1,
          }}
        >
          {t("shell.brand")}
        </span>
        <button
          type="button"
          aria-label={t("detail.close")}
          title={t("detail.close")}
          onClick={onCloseMenu}
          className="ws-sidebar-close"
          style={{
            width: 24,
            height: 24,
            background: "#ffffff",
            border: `2px solid ${INK}`,
            cursor: "pointer",
            color: "var(--text)",
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          <X size={12} style={{ display: "block", margin: "auto" }} />
        </button>
      </div>

      {/* §6.4 全文搜索入口：Enter 提交，Escape 清空 */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: 10,
          borderBottom: `2px solid ${INK}`,
          flexShrink: 0,
        }}
      >
        <input
          type="search"
          value={searchDraft}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && searchDraft.trim()) {
              onSearch(searchDraft.trim());
            } else if (e.key === "Escape") {
              setSearchDraft("");
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            padding: "0 8px",
            background: "#ffffff",
            color: "var(--text)",
            border: `2px solid ${INK}`,
            boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.35)",
            outline: "none",
            fontFamily: "var(--font-space-grotesk)",
            fontSize: 12,
          }}
        />
        <button
          type="button"
          aria-label={t("search.title")}
          title={t("search.title")}
          onClick={() => searchDraft.trim() && onSearch(searchDraft.trim())}
          style={{
            width: 30,
            height: 28,
            background: "var(--lime)",
            color: INK,
            border: `2px solid ${INK}`,
            boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.35)",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          <Search size={15} style={{ display: "block", margin: "auto" }} />
        </button>
      </div>

      {/* 创建入口（左栏顶部，§3.1） */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 10,
          borderBottom: `2px solid ${INK}`,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onNewChannel}
          style={actionButton(true)}
          onMouseDown={(e) => {
            e.currentTarget.style.boxShadow = PRESS_STYLE.boxShadow;
            e.currentTarget.style.transform = PRESS_STYLE.transform;
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.boxShadow = REST_STYLE.boxShadow;
            e.currentTarget.style.transform = REST_STYLE.transform;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = REST_STYLE.boxShadow;
            e.currentTarget.style.transform = REST_STYLE.transform;
          }}
        >
          + {t("shell.createChannel")}
        </button>
        <button
          type="button"
          onClick={onNewAgent}
          style={actionButton(false)}
          onMouseDown={(e) => {
            e.currentTarget.style.boxShadow = "1px 1px 0 0 rgba(20, 17, 17, 0.35)";
            e.currentTarget.style.transform = "translate(1px, 1px)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.boxShadow = "2px 2px 0 0 rgba(20, 17, 17, 0.35)";
            e.currentTarget.style.transform = "none";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "2px 2px 0 0 rgba(20, 17, 17, 0.35)";
            e.currentTarget.style.transform = "none";
          }}
        >
          + {t("shell.createAgent")}
        </button>
      </div>

      {/* 滚动区 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px 12px" }}>
        {error && (
          <div style={{ padding: "8px 12px", color: "var(--coral)", fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={LABEL_STYLE}>{t("shell.channels")}</div>
        {channels.length === 0 && (
          <div style={{ padding: "4px 12px 8px", fontSize: 12, color: "var(--text-dim)" }}>
            {t("shell.noChannels")}
          </div>
        )}
        {channels.map((channel) => {
          const isSelected = selectedChannelId === channel.id;
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => onSelectChannel(channel.id)}
              style={rowStyle(isSelected)}
            >
              <span
                style={{
                  fontFamily: "var(--font-space-mono)",
                  fontSize: 13,
                  fontWeight: 700,
                  color: isSelected ? INK : "var(--text-muted)",
                  flexShrink: 0,
                }}
              >
                #
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {channel.name}
              </span>
              {channel.archived === 1 && (
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-dim)" }}>
                  {t("channel.archived")}
                </span>
              )}
            </button>
          );
        })}

        <div style={{ ...LABEL_STYLE, paddingTop: 14 }}>{t("shell.agents")}</div>
        {agents.length === 0 && (
          <div style={{ padding: "4px 12px 8px", fontSize: 12, color: "var(--text-dim)" }}>
            {t("shell.noAgents")}
          </div>
        )}
        {agents.map((agent) => {
          // ticket 13：agent 行无选中态——点击打开右栏面板，中央频道不动
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => onOpenAgent(agent.id)}
              style={rowStyle(false)}
            >
              <PixelAvatar seed={agent.id} name={agent.name} size={28} />
              <span
                style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {agent.name}
              </span>
              <StatusDot status={agent.status} />
            </button>
          );
        })}
      </div>

      {/* 底部设置：提醒 + 模型 + 技能 + 语言（§3.10 全局设置保留；提醒入口 §5.6） */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: 8,
          borderTop: `2px solid ${INK}`,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onOpenReminders}
          title={t("reminders.all")}
          style={{
            flex: 1,
            height: 28,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            background: scheduledReminderCount > 0 ? "var(--yellow)" : "#ffffff",
            color: INK,
            border: `2px solid ${INK}`,
            cursor: "pointer",
            fontFamily: "var(--font-hanken)",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          <AlarmClock size={13} />
          {scheduledReminderCount > 0 ? scheduledReminderCount : t("reminders.all")}
        </button>
        <button
          type="button"
          onClick={onOpenModels}
          style={{
            flex: 1,
            height: 28,
            background: "#ffffff",
            color: INK,
            border: `2px solid ${INK}`,
            cursor: "pointer",
            fontFamily: "var(--font-hanken)",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          {t("common.models")}
        </button>
        <button
          type="button"
          onClick={onOpenSkills}
          style={{
            flex: 1,
            height: 28,
            background: "#ffffff",
            color: INK,
            border: `2px solid ${INK}`,
            cursor: "pointer",
            fontFamily: "var(--font-hanken)",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          {t("common.skills")}
        </button>
        <select
          aria-label={t("shell.language")}
          value={locale}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
          style={{
            height: 28,
            background: "#ffffff",
            color: INK,
            border: `2px solid ${INK}`,
            cursor: "pointer",
            fontFamily: "var(--font-space-grotesk)",
            fontSize: 12,
            fontWeight: 600,
            padding: "0 4px",
          }}
        >
          {supportedLocales.map((plugin) => (
            <option key={plugin.id} value={plugin.id}>
              {plugin.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
