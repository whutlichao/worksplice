"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { WorkspaceSidebar, type SidebarSelection } from "./WorkspaceSidebar";
import { ChannelView, type CenterTab, type ChannelWithMeta } from "./ChannelView";
import { SearchView } from "./SearchView";
import { AgentDetailPanel } from "./AgentDetailPanel";
import { CreateChannelModal } from "./CreateChannelModal";
import { CreateAgentModal } from "./CreateAgentModal";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import type { MemberRow } from "@/lib/data/db";
import { OWNER_MEMBER_ID } from "@/lib/data/schema";

const INK = "#141111";

/** 深链格式（复制链接 §3.2）：`#c/<channelId>?m=<messageId>` */
function parseDeepLink(raw: string): { channelId: string; messageId?: string } | null {
  try {
    const match = /^#c\/([^?]+)(?:\?m=(.+))?$/.exec(raw);
    if (!match) return null;
    return { channelId: decodeURIComponent(match[1]), messageId: match[2] ? decodeURIComponent(match[2]) : undefined };
  } catch {
    return null;
  }
}

/**
 * 三栏骨架（spec §3.1）：
 * 左 = channel 列表（含 #all）+ agent 成员列表；中央 = channel 消息流 / Tasks tab；
 * 右 = agent 详情面板（可选）。整体重写，不复用 pi-web 单聊天窗口骨架。
 */
export function AppShell() {
  const { t } = useI18n();
  useViewportHeight();

  const [channels, setChannels] = useState<ChannelWithMeta[]>([]);
  const [agents, setAgents] = useState<MemberRow[]>([]);
  const [owner, setOwner] = useState<MemberRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState<SidebarSelection>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>("messages");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);

  // §6.4 全文搜索：侧栏入口 → 中央 SearchView；"打开消息"经深链定位。
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);

  const load = useCallback(() => {
    void Promise.all([
      fetch("/api/channels").then(async (r) => {
        if (!r.ok) throw new Error(`GET /api/channels: ${r.status}`);
        const body = (await r.json()) as { channels?: ChannelWithMeta[] };
        return body.channels ?? [];
      }),
      fetch("/api/members").then(async (r) => {
        if (!r.ok) throw new Error(`GET /api/members: ${r.status}`);
        const body = (await r.json()) as { agents?: MemberRow[]; owner?: MemberRow | null };
        setOwner(body.owner ?? null);
        return body.agents ?? [];
      }),
    ])
      .then(([channelRows, agentRows]) => {
        setChannels(channelRows);
        setAgents(agentRows);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // agent 状态点实时流（§3.6）：SSE 推送 { memberId: status } 快照，合并进列表
  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const source = new EventSource("/api/members/events");
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { statuses?: Record<string, MemberRow["status"]> };
          if (!payload.statuses) return;
          setAgents((prev) =>
            prev.map((agent) => {
              const status = payload.statuses![agent.id];
              return status && status !== agent.status ? { ...agent, status } : agent;
            }),
          );
        } catch {
          // 忽略非 JSON 帧（心跳）
        }
      };
      source.onerror = () => {
        source.close();
        if (!disposed) retryTimer = setTimeout(connect, 5000);
      };
      return source;
    };

    const source = connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source.close();
    };
  }, []);

  // 深链（复制链接 §3.2 / 搜索"打开消息"§6.4）：`#c/<channelId>?m=<messageId>` → 选中 channel 并定位消息
  const applyDeepLink = useCallback((raw?: string) => {
    const link = parseDeepLink(raw ?? window.location.hash);
    if (!link) return;
    setSelected({ kind: "channel", id: link.channelId });
    setCenterTab("messages");
    setFocusMessageId(link.messageId ?? null);
    setSidebarOpen(false);
    setSearchOpen(false);
  }, []);

  useEffect(() => {
    const onHashChange = () => applyDeepLink();
    applyDeepLink();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [applyDeepLink]);

  /** 搜索"打开消息"（§6.4）：关闭搜索视图 + 深链定位；hash 未变时直接应用（可重复打开同一消息）。 */
  const openMessageFromSearch = useCallback(
    (channelId: string, messageId: string) => {
      setSearchOpen(false);
      const hash = `#c/${encodeURIComponent(channelId)}?m=${messageId}`;
      if (window.location.hash === hash) {
        applyDeepLink(hash);
      } else {
        window.location.hash = hash;
      }
    },
    [applyDeepLink],
  );

  // 默认选中 #all（内建频道）
  useEffect(() => {
    if (selected) return;
    const fallback = channels.find((c) => c.id === "#all") ?? channels[0];
    if (fallback) setSelected({ kind: "channel", id: fallback.id });
  }, [channels, selected]);

  const selectedChannel =
    selected?.kind === "channel"
      ? channels.find((c) => c.id === selected.id) ?? null
      : null;
  const selectedAgent =
    selected?.kind === "agent" ? agents.find((m) => m.id === selected.id) ?? null : null;

  const handleSelect = (next: SidebarSelection) => {
    setSelected(next);
    setFocusMessageId(null);
    setSearchOpen(false);
    if (next?.kind === "channel") setCenterTab("messages");
    setSidebarOpen(false);
  };

  return (
    <div
      className="ws-shell"
      style={{
        height: "var(--app-viewport-height, 100dvh)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* 左栏：channels + agents */}
      <aside className={`ws-left${sidebarOpen ? " ws-left-open" : ""}`}>
        <WorkspaceSidebar
          channels={channels}
          agents={agents}
          error={loadError}
          selected={selected}
          onSelect={handleSelect}
          onNewChannel={() => setCreateChannelOpen(true)}
          onNewAgent={() => setCreateAgentOpen(true)}
          onOpenModels={() => setModelsOpen(true)}
          onOpenSkills={() => setSkillsOpen(true)}
          onCloseMenu={() => setSidebarOpen(false)}
          onSearch={(q) => {
            setSearchQuery(q);
            setSearchOpen(true);
          }}
        />
      </aside>

      {/* 中央：channel 消息流 / Tasks tab */}
      <div className="ws-center">
        <button
          type="button"
          aria-label={t("shell.menu")}
          title={t("shell.menu")}
          className="ws-mobile-toggle"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          ☰
        </button>
        {searchOpen ? (
          <SearchView
            key={`search-${searchQuery}`}
            initialQuery={searchQuery}
            onClose={() => setSearchOpen(false)}
            onOpenMessage={openMessageFromSearch}
          />
        ) : (
          <ChannelView
            channel={selectedChannel}
            tab={centerTab}
            onTabChange={setCenterTab}
            currentMemberId={OWNER_MEMBER_ID}
            onChannelChanged={load}
            focusMessageId={focusMessageId}
            agents={agents}
            owner={owner}
            onSelectAgent={(id) => handleSelect({ kind: "agent", id })}
          />
        )}
      </div>

      {/* 右栏（可选）：agent 详情面板；桌面常驻，紧凑端滑入 */}
      <aside className={`ws-right${selectedAgent ? " ws-right-open" : ""}`}>
        {selectedAgent ? (
          <AgentDetailPanel
            agent={selectedAgent}
            onClose={() => setSelected(null)}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 24,
              textAlign: "center",
              color: "var(--text-dim)",
              fontSize: 12,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                display: "grid",
                placeItems: "center",
                background: "#ffffff",
                border: `2px solid ${INK}`,
                boxShadow: "var(--shadow-sm)",
                fontFamily: "var(--font-space-mono)",
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              ●
            </div>
            <div>{t("agent.notSelected")}</div>
          </div>
        )}
      </aside>

      {/* 紧凑端遮罩：点按关闭浮层（桌面端被 CSS 隐藏） */}
      {(sidebarOpen || selectedAgent) && (
        <div
          className="ws-backdrop"
          onClick={() => {
            if (sidebarOpen) {
              setSidebarOpen(false);
            } else if (selected?.kind === "agent") {
              setSelected(null);
            }
          }}
        />
      )}

      {createChannelOpen && (
        <CreateChannelModal
          agents={agents}
          onClose={() => setCreateChannelOpen(false)}
          onCreated={() => {
            setCreateChannelOpen(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
      {createAgentOpen && (
        <CreateAgentModal
          onClose={() => setCreateAgentOpen(false)}
          onCreated={() => {
            setCreateAgentOpen(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
      {modelsOpen && <ModelsConfig onClose={() => setModelsOpen(false)} />}
      {skillsOpen && <SkillsConfig onClose={() => setSkillsOpen(false)} />}
    </div>
  );
}
