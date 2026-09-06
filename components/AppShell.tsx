"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { MemberRow } from "@/lib/data/types";
import { DM_ID_PREFIX, OWNER_MEMBER_ID } from "@/lib/data/schema";
import { reconcileAgents, shallowEqualAgent } from "@/lib/agent-reconcile";
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

/** 列表合并用的浅比较：字段全等时复用旧对象引用，避免下游 useCallback/useEffect 连锁重建。
 *  messageCount（DM 懒创建「有消息」信号）纳入比较——新消息入流后侧栏 DM 分组与按钮文案需随它更新。 */
function shallowEqualChannel(a: ChannelWithMeta, b: ChannelWithMeta): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.type === b.type &&
    a.description === b.description &&
    a.archived === b.archived &&
    a.created_at === b.created_at &&
    a.joined === b.joined &&
    a.memberCount === b.memberCount &&
    a.unread === b.unread &&
    a.messageCount === b.messageCount
  );
}

export function AppShell() {
  const { t } = useI18n();
  useViewportHeight();

  const [channels, setChannels] = useState<ChannelWithMeta[]>([]);
  const [agents, setAgents] = useState<MemberRow[]>([]);
  const [owner, setOwner] = useState<MemberRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  /** 成员集合显式失效计数：创建 agent 后 load() 已刷新 agents，中央成员附属区
   * （人数/成员面板/@ 候选）经 membersVersion 递增重拉收敛——不依赖切频道。 */
  const [membersVersion, setMembersVersion] = useState(0);
  /** agent 列表轮询读最新快照的 ref（interval 回调里避开闭包旧值，也不在 setState updater 里做副作用）。 */
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // ticket 13 状态解耦：中央（当前频道）与面板（agent | human | thread | null）两个独立状态。
  // 选中 agent/人类/线程只在右栏展示，中央频道消息流不再被清空；切换频道清空面板。
  const [centerSelection, setCenterSelection] = useState<string | null>(null);
  const [panelContent, setPanelContent] = useState<PanelContent>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>("messages");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  /** DM 懒创建入口：导航后聚焦 composer 的一次性信号（每次点“发送消息/打开私信”递增）。 */
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);

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
        setOwner((prev) => {
          const next = body.owner ?? null;
          if (!prev && !next) return prev;
          if (prev && next && shallowEqualAgent(prev, next)) return prev;
          return next;
        });
        return body.agents ?? [];
      }),
    ])
      .then(([channelRows, agentRows]) => {
        // 合并而非整体替换：保持未变更行的对象引用，避免 ChannelView 因
        // channel prop 引用变化而重建全部 loader（切换频道闪动两轮请求）。
        setChannels((prev) => {
          if (prev.length === 0) return channelRows;
          const byId = new Map(prev.map((c) => [c.id, c]));
          let changed = channelRows.length !== prev.length;
          const next = channelRows.map((row) => {
            const old = byId.get(row.id);
            if (old && shallowEqualChannel(old, row)) return old;
            changed = true;
            return row;
          });
          return changed ? next : prev;
        });
        setAgents((prev) => reconcileAgents(prev, agentRows).agents);
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

  // BAI-6 未读角标：15s 轮询频道列表刷新未读数（agent 回复/新消息入流后侧栏角标保持新鲜）。
  // 注意：只在 unread 真的变化时替换行对象，保持 channel 引用稳定，
  // 否则每次轮询都产生新 channel 对象 → ChannelView loader 重建 → 切换闪动两轮请求。
  useEffect(() => {
    const timer = setInterval(() => {
      void fetch("/api/channels")
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json()) as { channels?: ChannelWithMeta[] };
          if (!body.channels) return;
          setChannels((prev) => {
            const byId = new Map(body.channels!.map((c) => [c.id, c]));
            let changed = false;
            const next = prev.map((c) => {
              const fresh = byId.get(c.id);
              if (!fresh) return c;
              if (c.unread === fresh.unread && shallowEqualChannel(c, fresh)) return c;
              changed = true;
              // 同步 unread 与 messageCount（DM 懒创建「有消息」信号随新消息入流更新）。
              return { ...c, unread: fresh.unread, messageCount: fresh.messageCount };
            });
            return changed ? next : prev;
          });
        })
        .catch(() => undefined);
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  // agent 列表 15s 轮询：Susan 走 HTTP API 代办创建 agent 后（不经 CreateAgentModal
  // onCreated，独立进程路径），前端无刷新时也应在 15s 内看到新 agent；成员 id 集合变化
  // 时递增 membersVersion → useChannelData 重拉成员集合 → 频道成员列表/成员面板/@ 候选收敛。
  // 引用稳定：reconcileAgents 复用未变更行对象，避免 agent 行无谓重渲染。
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void fetch("/api/members")
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json()) as { agents?: MemberRow[] };
          if (!body.agents || cancelled) return;
          const { agents: next, membersChanged } = reconcileAgents(
            agentsRef.current,
            body.agents,
          );
          setAgents(next);
          if (membersChanged) setMembersVersion((v) => v + 1);
        })
        .catch(() => undefined);
    };
    const timer = setInterval(poll, 15_000);
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

  const selectedChannel = useMemo(
    () =>
      centerSelection
        ? (channels.find((c) => c.id === centerSelection) ?? null)
        : null,
    [channels, centerSelection],
  );

  /** 选中频道：清空面板（切换频道不被上一频道残留详情误导），中央切到消息 tab。
   *  注意：不要在这里 setRefreshKey——那会触发 load() 重拉 channels/members，
   *  产生全新 channel 对象 → ChannelView 全部 loader 重建 → 切换闪动两轮请求。 */
  const handleSelectChannel = useCallback((id: string) => {
    setCenterSelection(id);
    setPanelContent((prev) => onChannelSwitched(prev));
    setFocusMessageId(null);
    setSearchOpen(false);
    setCenterTab("messages");
    setSidebarOpen(false);
    // BAI-6 未读角标：打开频道即推进已读游标（服务端幂等），本地立即清零。
    void fetch(`/api/channels/${encodeURIComponent(id)}/read`, { method: "POST" }).catch(() => undefined);
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  }, []);

  /** 打开面板：单槽替换（任何内容互斥，id 透传）；紧凑端滑入覆盖。 */
  const handleOpenPanel = (content: PanelContent) => {
    if (!content) return;
    setPanelContent((prev) => openPanel(prev, content));
    setSearchOpen(false);
    setSidebarOpen(false);
  };

  /** DM 懒创建入口（03 票）：幂等建/取 DM → 合并进 channels → 导航中央 + 聚焦 composer + 关闭右栏面板。
   *  不改 handleSelectChannel 本身（它被普通频道行点击共用）；关面板在本路径额外做。 */
  const handleOpenDM = useCallback(
    async (agentId: string) => {
      try {
        const res = await fetch(`/api/members/${encodeURIComponent(agentId)}/dm`, {
          method: "POST",
        });
        const body = (await res.json().catch(() => ({}))) as {
          channel?: ChannelWithMeta;
          error?: string;
        };
        if (!res.ok || !body.channel) {
          setLoadError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        // 合并而非整体替换：新 DM 行并入，保持既有行引用稳定（避免 ChannelView loader 重建）。
        setChannels((prev) => {
          const idx = prev.findIndex((c) => c.id === body.channel!.id);
          if (idx === -1) return [...prev, body.channel!];
          if (shallowEqualChannel(prev[idx], body.channel!)) return prev;
          const next = prev.slice();
          next[idx] = body.channel!;
          return next;
        });
        handleSelectChannel(body.channel.id);
        setPanelContent(null); // 发送消息路径上额外关闭右栏面板（handleSelectChannel 为普通行共用，不改它）
        setComposerFocusSignal((n) => n + 1);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    },
    [handleSelectChannel],
  );

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

  /** 当前 agent 面板的 DM 是否已有消息（复用 02 的信号：channels 附 messageCount；
   *  确定性 id `dm:owner↔<agent名>` 推导，无 DM 行或 0 消息 = 无消息）。 */
  const dmHasMessages = useMemo(() => {
    if (!resolvablePanel || resolvablePanel.kind !== "agent") return false;
    const agent = agents.find((a) => a.id === resolvablePanel.id);
    if (!agent) return false;
    const dmId = `${DM_ID_PREFIX}${agent.name}`;
    const dm = channels.find((c) => c.id === dmId);
    return (dm?.messageCount ?? 0) > 0;
  }, [resolvablePanel, agents, channels]);

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
            composerFocusSignal={composerFocusSignal}
            agents={agents}
            owner={owner}
            onOpenPanel={handleOpenPanel}
            membersVersion={membersVersion}
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
            onOpenDM={handleOpenDM}
            dmHasMessages={dmHasMessages}
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
            setMembersVersion((v) => v + 1);
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
