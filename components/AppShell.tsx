"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { ChannelView, type CenterTab, type ChannelWithMeta } from "./ChannelView";
import { SearchView } from "./SearchView";
import { DetailPanel } from "./DetailPanel";
import { CreateChannelModal } from "./CreateChannelModal";
import { CreateAgentModal } from "./CreateAgentModal";
import { MyRemindersModal } from "./MyRemindersModal";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import type { MemberRow } from "@/lib/data/db";
import { OWNER_MEMBER_ID } from "@/lib/data/schema";
import { closePanel, onChannelSwitched, openPanel, type PanelContent } from "@/lib/panel-state";

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
 * 三栏骨架（spec §3.1，ticket 13 重构）：
 * 左 = channel 列表（含 #all）+ agent 成员列表；中央 = channel 消息流 / Tasks tab；
 * 右 = 非长驻单槽面板（agent | human | thread | null）——中央与面板状态解耦，
 * 点 agent/人类/线程只在右栏展示，无选中时整栏消失、中央占满。
 */
export function AppShell() {
  const { t } = useI18n();
  useViewportHeight();

  const [channels, setChannels] = useState<ChannelWithMeta[]>([]);
  const [agents, setAgents] = useState<MemberRow[]>([]);
  const [owner, setOwner] = useState<MemberRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ticket 13 状态解耦：中央（当前频道）与面板（agent | human | thread | null）两个独立状态。
  // 选中 agent/人类/线程只在右栏展示，中央频道消息流不再被清空；切换频道清空面板。
  const [centerSelection, setCenterSelection] = useState<string | null>(null);
  const [panelContent, setPanelContent] = useState<PanelContent>(null);
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
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [scheduledReminderCount, setScheduledReminderCount] = useState(0);

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

  // 全局提醒入口角标：15s 轮询待触发提醒数（面板打开时也靠它保证计数新鲜）
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetch("/api/reminders")
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json()) as { reminders?: Array<{ status: string }> };
          if (!cancelled) {
            setScheduledReminderCount((body.reminders ?? []).filter((r) => r.status === "scheduled").length);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
    setCenterSelection(link.channelId);
    setPanelContent((prev) => onChannelSwitched(prev));
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
    if (centerSelection) return;
    const fallback = channels.find((c) => c.id === "#all") ?? channels[0];
    if (fallback) setCenterSelection(fallback.id);
  }, [channels, centerSelection]);

  const selectedChannel = centerSelection
    ? channels.find((c) => c.id === centerSelection) ?? null
    : null;

  /** 选中频道：清空面板（切换频道不被上一频道残留详情误导），中央切到消息 tab。 */
  const handleSelectChannel = (id: string) => {
    setCenterSelection(id);
    setPanelContent((prev) => onChannelSwitched(prev));
    setFocusMessageId(null);
    setSearchOpen(false);
    setCenterTab("messages");
    setSidebarOpen(false);
  };

  /** 打开面板：单槽替换（任何内容互斥，id 透传）；紧凑端滑入覆盖。 */
  const handleOpenPanel = (content: PanelContent) => {
    if (!content) return;
    setPanelContent((prev) => openPanel(prev, content));
    setSearchOpen(false);
    setSidebarOpen(false);
  };

  const handleClosePanel = () => {
    setPanelContent((prev) => closePanel(prev));
  };

  /** 面板可解析性：agent/human 找不到（删除/未加载）时视为空面板——右栏整栏消失而非空占位。 */
  const resolvablePanel = useMemo<NonNullable<PanelContent> | null>(() => {
    if (!panelContent) return null;
    if (panelContent.kind === "agent") {
      return agents.some((a) => a.id === panelContent.id) ? panelContent : null;
    }
    if (panelContent.kind === "human") {
      return owner && owner.id === panelContent.id ? panelContent : null;
    }
    return panelContent;
  }, [panelContent, agents, owner]);

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
          selectedChannelId={centerSelection}
          onSelectChannel={handleSelectChannel}
          onOpenAgent={(id) => handleOpenPanel({ kind: "agent", id })}
          onNewChannel={() => setCreateChannelOpen(true)}
          onNewAgent={() => setCreateAgentOpen(true)}
          onOpenModels={() => setModelsOpen(true)}
          onOpenSkills={() => setSkillsOpen(true)}
          onOpenReminders={() => setRemindersOpen(true)}
          scheduledReminderCount={scheduledReminderCount}
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
          <Menu size={20} style={{ display: "block", margin: "auto" }} />
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
            onOpenPanel={handleOpenPanel}
          />
        )}
      </div>

      {/* 右栏（非长驻单槽 dock，ticket 13）：无选中/不可解析时整栏消失（中央吃满宽度）；桌面 380px，紧凑端滑入覆盖 */}
      {resolvablePanel && (
        <aside className="ws-right ws-right-open">
          <DetailPanel
            content={resolvablePanel}
            channel={selectedChannel}
            agents={agents}
            owner={owner}
            currentMemberId={OWNER_MEMBER_ID}
            onClose={handleClosePanel}
            onChanged={() => setRefreshKey((k) => k + 1)}
            onOpenPanel={handleOpenPanel}
          />
        </aside>
      )}

      {/* 紧凑端遮罩：点按关闭浮层（桌面端被 CSS 隐藏） */}
      {(sidebarOpen || resolvablePanel) && (
        <div
          className="ws-backdrop"
          onClick={() => {
            if (sidebarOpen) {
              setSidebarOpen(false);
            } else if (resolvablePanel) {
              handleClosePanel();
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
          agents={agents}
          onClose={() => setCreateAgentOpen(false)}
          onCreated={() => {
            setCreateAgentOpen(false);
            setRefreshKey((k) => k + 1);
          }}
          onOpenModelsConfig={() => {
            // 启动助手：模型未配置 → 引导打开模型配置（spec §6.3），配置完成后再点即可创建
            setCreateAgentOpen(false);
            setModelsOpen(true);
          }}
        />
      )}
      {modelsOpen && <ModelsConfig onClose={() => setModelsOpen(false)} />}
      {skillsOpen && <SkillsConfig onClose={() => setSkillsOpen(false)} />}
      {remindersOpen && (
        <MyRemindersModal
          onClose={() => setRemindersOpen(false)}
          onLocate={(channelId, messageId) => {
            setRemindersOpen(false);
            const hash = messageId
              ? `#c/${encodeURIComponent(channelId)}?m=${messageId}`
              : `#c/${encodeURIComponent(channelId)}`;
            if (window.location.hash === hash) {
              applyDeepLink(hash);
            } else {
              window.location.hash = hash;
            }
          }}
        />
      )}
    </div>
  );
}
