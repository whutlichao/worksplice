"use client";

import { useState } from "react";
import { AlarmClock, List, MessageSquare, Plus, Search, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Avatar } from "./Avatar";
import { StatusDot } from "./StatusDot";
import type { ChannelWithMeta } from "./ChannelView";
import type { MemberRow } from "@/lib/data/types";
import { DM_ID_PREFIX } from "@/lib/data/schema";

/** 分组空态提示（`.group-label` 之下的说明行；上游没有这一档，按 ED-5/ED-7 外推）。 */
const EMPTY_NOTE_STYLE: React.CSSProperties = {
  padding: "var(--sp-2) var(--sp-5) var(--sp-4)",
  fontSize: "var(--fs-sm)",
  color: "var(--faint)",
};

/** DM 频道显示名 = 剥离 `dm:owner↔` 前缀后的 agent 名（DM id == name，见 schema DM_ID_PREFIX）。 */
function dmAgentName(name: string): string {
  return name.startsWith(DM_ID_PREFIX) ? name.slice(DM_ID_PREFIX.length) : name;
}

/** 环境无关的名字比较（UTF-16 码元序）：localeCompare 依赖宿主 ICU locale，服务端 Node 与
 *  浏览器不同 locale（如 en-US vs zh-CN）会排出不同顺序 → DM 分组首帧渲染不一致（hydration mismatch）。 */
function compareAgentNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 频道行（§03 起普通频道 / 私信两组复用）：DM 显示 agent 名 + MessageSquare 图标，其余同普通频道。
 *  形态 = 上游 `.nav-row`：激活走 `.is-active`（`--surface` 填充 + inset 发丝 + accent 竖条 + accent `#`）。
 *  DM 行的图标是 ticket 13 既有形态，不在票 04 的 7 个 `Avatar` 调用点里，本票不动它。 */
function ChannelRow({
  channel,
  isDM,
  isSelected,
  onSelect,
}: {
  channel: ChannelWithMeta;
  isDM: boolean;
  isSelected: boolean;
  onSelect: (channelId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => onSelect(channel.id)}
      className={`nav-row${isSelected ? " is-active" : ""}`}
    >
      {isDM ? (
        <MessageSquare size={13} style={{ flexShrink: 0 }} />
      ) : (
        <span className="hash">#</span>
      )}
      <span className="grow">
        {isDM ? dmAgentName(channel.name) : channel.name}
      </span>
      {channel.unread > 0 && !isSelected ? (
        <span
          className="badge"
          title={t("shell.unread", { count: String(channel.unread) })}
        >
          {channel.unread > 99 ? "99+" : channel.unread}
        </span>
      ) : (
        channel.archived === 1 && (
          <span className="badge soft">{t("channel.archived")}</span>
        )
      )}
    </button>
  );
}

/**
 * 左栏（ticket 13）：只高亮频道行（中央 = 当前频道）；agent 行点击 = 打开右栏面板，无选中态。
 * 中央与面板状态解耦：选中 agent 不再触碰中央频道。
 *
 * 形态（票 03）= 上游 `ui_kits/app/app.css` 的 rail 块：`.rail-head` / `.brand*` / `.search*` /
 * `.rail-actions` / `.rail-scroll` / `.group*` / `.nav-row` / `.rail-foot`。容器本身仍是骨架钩子
 * `.ws-left`（`--panel` 底 + 右发丝 + inline `var(--rail-w)` 宽度），不重复加一层 `.rail`。
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
  channels: ChannelWithMeta[];
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

  // §03 私信分组：type='dm' 且「有消息」（懒创建：发送了消息才出现）过滤，按 agent 名排序。
  const dmChannels = channels
    .filter((channel) => channel.type === "dm")
    .filter((channel) => channel.messageCount > 0)
    .sort((a, b) =>
      compareAgentNames(dmAgentName(a.name), dmAgentName(b.name)),
    );
  const regularChannels = channels.filter((channel) => channel.type !== "dm");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* 品牌头（上游 .rail-head / .brand：mark + name + mono postmark） */}
      <div className="rail-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <List size={15} strokeWidth={2.2} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">{t("shell.brand")}</div>
            <div className="brand-sub">{t("shell.brandSub")}</div>
          </div>
        </div>
        <button
          type="button"
          aria-label={t("detail.close")}
          title={t("detail.close")}
          onClick={onCloseMenu}
          className="icon-btn ws-sidebar-close"
        >
          <X size={14} />
        </button>
      </div>

      {/* §6.4 全文搜索入口：Enter 提交，Escape 清空（行为不动；形态取上游 .search-btn）
          上游这里是打开命令面板的按钮（名字就叫 `.search-btn`），本仓是真实输入框 + 提交按钮——
          输入框取上游 `span` 的位置，焦点环落在 shell 上（ED-8 的字段环）。名字的字面语义与本仓
          形态不符是**故意的**：D7 要求 class 名与上游逐字对照，改名会让「搬自上游哪一块」失去锚点。 */}
      <div className="search-shell">
        <div className="search-btn">
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
          />
          <button
            type="button"
            aria-label={t("search.title")}
            title={t("search.title")}
            onClick={() => searchDraft.trim() && onSearch(searchDraft.trim())}
          >
            <Search size={14} />
          </button>
        </div>
      </div>

      {/* 创建入口（左栏顶部，§3.1）：上游 .rail-actions（primary 占满 + 常规按钮） */}
      <div className="rail-actions">
        <button
          type="button"
          onClick={onNewChannel}
          className="btn btn-primary"
          style={{ flex: 1 }}
        >
          <Plus size={13} strokeWidth={2.4} />
          {t("shell.createChannel")}
        </button>
        <button type="button" onClick={onNewAgent} className="btn">
          <Plus size={14} />
          {t("shell.createAgent")}
        </button>
      </div>

      {/* 滚动区 */}
      <div className="rail-scroll">
        {error && (
          <div
            style={{
              padding: "var(--sp-4) var(--sp-5)",
              color: "var(--error)",
              fontSize: "var(--fs-sm)",
            }}
          >
            {error}
          </div>
        )}

        <div className="group">
          <div className="group-label">{t("shell.channels")}</div>
          {regularChannels.length === 0 && (
            <div style={EMPTY_NOTE_STYLE}>{t("shell.noChannels")}</div>
          )}
          {regularChannels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              isDM={false}
              isSelected={selectedChannelId === channel.id}
              onSelect={onSelectChannel}
            />
          ))}
        </div>

        <div className="group">
          <div className="group-label">{t("shell.dm")}</div>
          {dmChannels.length === 0 && (
            <div style={EMPTY_NOTE_STYLE}>{t("shell.noDm")}</div>
          )}
          {dmChannels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              isDM
              isSelected={selectedChannelId === channel.id}
              onSelect={onSelectChannel}
            />
          ))}
        </div>

        <div className="group">
          <div className="group-label">{t("shell.agents")}</div>
          {agents.length === 0 && (
            <div style={EMPTY_NOTE_STYLE}>{t("shell.noAgents")}</div>
          )}
          {agents.map((agent) => {
            // ticket 13：agent 行无选中态——点击打开右栏面板，中央频道不动
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => onOpenAgent(agent.id)}
                className="nav-row"
              >
                <Avatar name={agent.name} size="sm" colorKey={agent.id} />
                <span className="grow">{agent.name}</span>
                <StatusDot status={agent.status} />
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部设置：提醒 + 模型 + 技能 + 语言（§3.10 全局设置保留；提醒入口 §5.6） */}
      <div className="rail-foot">
        <button
          type="button"
          onClick={onOpenReminders}
          title={t("reminders.all")}
          aria-label={t("reminders.all")}
          className={`icon-btn${scheduledReminderCount > 0 ? " is-on" : ""}`}
        >
          <AlarmClock size={18} strokeWidth={2.2} />
          {scheduledReminderCount > 0 && (
            <span
              className="badge"
              style={{ position: "absolute", top: -6, right: -6 }}
            >
              {scheduledReminderCount > 99 ? "99+" : scheduledReminderCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenModels}
          className="btn btn-sm"
          style={{ flex: 1 }}
        >
          {t("common.models")}
        </button>
        <button
          type="button"
          onClick={onOpenSkills}
          className="btn btn-sm"
          style={{ flex: 1 }}
        >
          {t("common.skills")}
        </button>
        <select
          aria-label={t("shell.language")}
          value={locale}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
          className="select"
          style={{
            width: "auto",
            height: "var(--control-h-sm)",
            padding: "0 var(--sp-2)",
            fontSize: "var(--fs-sm)",
            fontWeight: 600,
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
