"use client";

import { useI18n } from "@/hooks/useI18n";
import { PixelAvatar } from "./PixelAvatar";
import { StatusDot } from "./StatusDot";
import type { MemberRow } from "@/lib/data/db";

const INK = "#141111";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: `2px solid ${INK}`,
        boxShadow: "var(--shadow-sm)",
        padding: "10px 12px",
      }}
    >
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-space-mono)",
          fontSize: 12,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "62%",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const DISABLED_BUTTON: React.CSSProperties = {
  flex: 1,
  padding: "7px 6px",
  fontFamily: "var(--font-hanken)",
  fontWeight: 700,
  fontSize: 12,
  background: "#ffffff",
  color: "var(--text-dim)",
  border: `2px solid ${INK}`,
  cursor: "not-allowed",
  opacity: 0.55,
};

/** 右栏：agent 详情面板（§3.6）。重置/workspace/runtime/可观测性随 agent 生命周期接入（ticket 05）。 */
export function AgentDetailPanel({
  agent,
  onClose,
}: {
  agent: MemberRow;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 身份头 */}
      <header
        style={{
          flexShrink: 0,
          padding: "14px 16px 12px",
          borderBottom: `2px solid ${INK}`,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <PixelAvatar seed={agent.id} name={agent.name} size={44} />
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
                {agent.name}
              </span>
              <StatusDot status={agent.status} />
              <span
                style={{
                  fontFamily: "var(--font-space-mono)",
                  fontSize: 10,
                  padding: "1px 6px",
                  border: `2px solid ${INK}`,
                  background: agent.role === "owner" ? "var(--yellow)" : "#ffffff",
                  color: "var(--text)",
                }}
              >
                {agent.role === "owner" ? t("role.owner") : t("role.member")}
              </span>
            </div>
            {agent.description ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {agent.description}
              </div>
            ) : null}
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
            ✕
          </button>
        </div>
      </header>

      {/* 主体：状态 / workspace / runtime / 重置 / 可观测性 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px 20px" }}>
        <SectionLabel>{t("status." + agent.status)}</SectionLabel>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatusDot status={agent.status} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("status." + agent.status)}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            {t("agent.pending")}
          </div>
        </Card>

        <SectionLabel>{t("agent.workspace")}</SectionLabel>
        <Card>
          <Row
            label={t("agent.workspace")}
            value={agent.workspace_path ?? t("agent.workspaceNotBound")}
          />
          <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              disabled
              title={t("agent.pending")}
              style={DISABLED_BUTTON}
            >
              {t("agent.change")}
            </button>
          </div>
        </Card>

        <SectionLabel>{t("agent.runtime")}</SectionLabel>
        <Card>
          <Row label={t("runtime.model")} value={t("runtime.unset")} />
          <div style={{ height: 8 }} />
          <Row label={t("runtime.provider")} value={t("runtime.unset")} />
          <div style={{ height: 8 }} />
          <Row label={t("runtime.thinking")} value={t("runtime.unset")} />
        </Card>

        <SectionLabel>{t("agent.reset")}</SectionLabel>
        <Card>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" disabled title={t("agent.pending")} style={DISABLED_BUTTON}>
              {t("agent.restart")}
            </button>
            <button type="button" disabled title={t("agent.pending")} style={DISABLED_BUTTON}>
              {t("agent.sessionReset")}
            </button>
            <button type="button" disabled title={t("agent.pending")} style={DISABLED_BUTTON}>
              {t("agent.fullReset")}
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              disabled
              title={t("agent.pending")}
              style={{
                width: "100%",
                padding: "7px 10px",
                fontFamily: "var(--font-hanken)",
                fontWeight: 700,
                fontSize: 12,
                background: "var(--coral)",
                color: "var(--ink)",
                border: `2px solid ${INK}`,
                boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
                cursor: "not-allowed",
                opacity: 0.55,
              }}
            >
              {t("agent.delete")}
            </button>
          </div>
        </Card>

        <SectionLabel>{t("agent.observability")}</SectionLabel>
        <Card>
          <Row label={t("observability.tokensCost")} value={t("runtime.unset")} />
          <div style={{ height: 8 }} />
          <Row label={t("observability.taskHistory")} value={t("runtime.unset")} />
          <div style={{ height: 8 }} />
          <Row label={t("observability.export")} value={t("runtime.unset")} />
        </Card>

        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 14, textAlign: "center" }}>
          {t("agent.pending")}
        </div>
      </div>
    </div>
  );
}
