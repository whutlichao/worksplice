"use client";

import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { AgentDetailPanel } from "./AgentDetailPanel";
import { ThreadPanel } from "./ThreadPanel";
import { Avatar } from "./Avatar";
import { StatusDot } from "./StatusDot";
import type { ChannelWithMeta } from "./ChannelView";
import type { MemberRow } from "@/lib/data/types";
import type { PanelContent } from "@/lib/panel-state";

/** 单槽容器的入参（AppShell 侧接线；ticket 13 起不变）。 */
export type DetailPanelProps = {
  content: NonNullable<PanelContent>;
  channel: ChannelWithMeta | null;
  agents: MemberRow[];
  owner: MemberRow | null;
  currentMemberId: string;
  onClose: () => void;
  onChanged: () => void;
  /** agent 删除乐观更新（上抛至 AppShell）：确认即从列表移除/关面板，不等 DELETE 返回。 */
  onDeleteOptimistic?: (agentId: string) => void;
  /** agent 删除失败回滚（上抛至 AppShell）：恢复列表 + 错误提示。 */
  onDeleteFailed?: (agentId: string, message: string) => void;
  /** 面板内跳转（线程内 mention 点击）：单槽替换面板内容（AppShell.openPanel）。 */
  onOpenPanel: (content: PanelContent) => void;
  /** DM 懒创建入口（上抛至 AppShell）：幂等建/取 DM → 导航中央 + 聚焦 composer + 关面板。 */
  onOpenDM: (agentId: string) => void;
  /** 当前 agent 面板的 DM 是否已有消息（文案动态：发送消息 / 打开私信）。 */
  dmHasMessages?: boolean;
};

/**
 * 单槽分派（ticket 13，逻辑一字未动）：agent → AgentDetailPanel（内容原样），
 * human → 薄资料卡，thread → 线程面板。找不到对应成员时返回 null（整体空渲染）。
 */
function renderPanelSlot({
  content,
  channel,
  agents,
  owner,
  currentMemberId,
  onClose,
  onChanged,
  onDeleteOptimistic,
  onDeleteFailed,
  onOpenPanel,
  onOpenDM,
  dmHasMessages,
}: DetailPanelProps): React.ReactNode {
  switch (content.kind) {
    case "agent": {
      const agent = agents.find((a) => a.id === content.id);
      if (!agent) return null;
      return (
        <AgentDetailPanel
          agent={agent}
          onClose={onClose}
          onChanged={onChanged}
          onDeleteOptimistic={onDeleteOptimistic}
          onDeleteFailed={onDeleteFailed}
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
          taskId={content.taskId}
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

/**
 * 右栏单槽容器（ticket 13）：按 kind 分派——agent → AgentDetailPanel（内容原样），
 * human → 薄资料卡，thread → 线程面板。非长驻：panelContent 为 null 时整栏不渲染（AppShell 侧）。
 * 打开任意内容即替换（单槽互斥，无栈/无回退）。
 *
 * 形态（票 07）：`.dock` = `--surface` 底 + flex 列，容器自身不吃圆角；**左发丝归骨架钩子
 * `.ws-right`**（票 03）——两处都声明会叠成双线。三个 kind 共用这一个外壳。
 */
export function DetailPanel(props: DetailPanelProps) {
  const slot = renderPanelSlot(props);
  // 保持既有「找不到成员就整体空渲染」语义（AppShell 侧另有 resolvablePanel 预校验）。
  if (slot === null) return null;
  return <div className="dock">{slot}</div>;
}

/** 人类成员薄资料卡：avatar / name / role / status / description（非阻塞，与 agent 同一容器同一生命周期）。 */
function HumanProfileCard({
  member,
  onClose,
}: {
  member: MemberRow;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <header className="dock-head">
        <div className="dock-id">
          <Avatar name={member.name} type={member.type} size="lg" colorKey={member.id} />
          <div className="meta">
            <div className="dock-name">
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {member.name}
              </span>
              <span className="badge soft">
                {member.role === "owner" ? t("role.owner") : t("role.member")}
              </span>
            </div>
            <div className="dock-role">
              <StatusDot status={member.status} />
              <span>{t("status." + member.status)}</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("detail.close")}
            title={t("detail.close")}
            onClick={onClose}
          >
            <X size={15} style={{ display: "block" }} />
          </button>
        </div>
      </header>

      <div className="dock-scroll">
        <section className="d-sec">
          <div className="d-sec-title">{t("memberProfile.description")}</div>
          <div
            style={{
              fontSize: "var(--fs-body)",
              lineHeight: "var(--lh-text)",
              color: member.description?.trim() ? "var(--fg)" : "var(--faint)",
            }}
          >
            {member.description?.trim()
              ? member.description.trim()
              : t("memberProfile.noDescription")}
          </div>
        </section>
      </div>
    </>
  );
}
