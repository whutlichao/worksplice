"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PixelAvatar } from "./PixelAvatar";
import { StatusDot } from "./StatusDot";
import { BrutalModal } from "./BrutalModal";
import { DirectoryPicker } from "./DirectoryPicker";
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

const ACTION_BUTTON: React.CSSProperties = {
  flex: 1,
  padding: "7px 6px",
  fontFamily: "var(--font-hanken)",
  fontWeight: 700,
  fontSize: 12,
  background: "#ffffff",
  color: "var(--text)",
  border: `2px solid ${INK}`,
  cursor: "pointer",
};

const DANGER_BUTTON: React.CSSProperties = {
  ...ACTION_BUTTON,
  background: "var(--coral)",
  color: "var(--ink)",
  boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
};

type ConfirmKind = "sessionReset" | "fullReset" | "delete";
type BusyOp = "restart" | "sessionReset" | "fullReset" | "delete" | "workspace";

const CONFIRM_TITLE: Record<ConfirmKind, string> = {
  sessionReset: "agent.confirmSessionReset",
  fullReset: "agent.confirmFullReset",
  delete: "agent.confirmDelete",
};

/** 右栏：agent 详情面板（§3.6）。重置粒度 / workspace 更换 / 删除身份（ticket 05）。 */
export function AgentDetailPanel({
  agent,
  onClose,
  onChanged,
}: {
  agent: MemberRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [busyOp, setBusyOp] = useState<BusyOp | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBusy = busyOp !== null;

  const run = async (op: BusyOp, request: () => Promise<Response>) => {
    if (isBusy) return;
    setBusyOp(op);
    setError(null);
    try {
      const res = await request();
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const message = body.error ?? `HTTP ${res.status}`;
        throw new Error(message);
      }
      if (op === "sessionReset" || op === "fullReset" || op === "delete") setConfirming(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyOp(null);
    }
  };

  const confirmLabels: Record<ConfirmKind, string> = {
    sessionReset: t("agent.sessionReset"),
    fullReset: t("agent.fullReset"),
    delete: t("agent.delete"),
  };

  const confirmRequest = (kind: ConfirmKind) => {
    const base = `/api/members/${encodeURIComponent(agent.id)}`;
    if (kind === "delete") return () => fetch(base, { method: "DELETE" });
    const suffix = kind === "sessionReset" ? "session-reset" : "full-reset";
    return () => fetch(`${base}/${suffix}`, { method: "POST" });
  };

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
            {agent.status === "offline" ? t("agent.stoppedHint") : t("agent.workspaceHint")}
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
              disabled={isBusy}
              onClick={() => setPickerOpen(true)}
              style={{ ...ACTION_BUTTON, flex: 0, padding: "6px 14px" }}
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
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void run("restart", () =>
                fetch(`/api/members/${encodeURIComponent(agent.id)}/restart`, { method: "POST" }))}
              style={ACTION_BUTTON}
            >
              {busyOp === "restart" ? t("agent.restarting") : t("agent.restart")}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirming("sessionReset")}
              style={ACTION_BUTTON}
            >
              {t("agent.sessionReset")}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirming("fullReset")}
              style={ACTION_BUTTON}
            >
              {t("agent.fullReset")}
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirming("delete")}
              style={DANGER_BUTTON}
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

        {error && (
          <div style={{ marginTop: 12, color: "var(--coral)", fontSize: 12 }}>
            {t("agent.opError", { message: error })}
          </div>
        )}
      </div>

      {/* 危险操作确认 */}
      {confirming && (
        <BrutalModal title={confirmLabels[confirming]} onClose={() => setConfirming(null)}>
          <div style={{ padding: "16px" }}>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>
              {t(CONFIRM_TITLE[confirming])}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setConfirming(null)}
                style={{
                  padding: "8px 16px",
                  fontFamily: "var(--font-hanken)",
                  fontWeight: 700,
                  fontSize: 13,
                  background: "#ffffff",
                  color: "var(--text)",
                  border: `2px solid ${INK}`,
                  cursor: isBusy ? "not-allowed" : "pointer",
                }}
              >
                {t("agent.cancelOp")}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void run(confirming, confirmRequest(confirming))}
                style={{
                  padding: "8px 16px",
                  fontFamily: "var(--font-hanken)",
                  fontWeight: 700,
                  fontSize: 13,
                  background: "var(--coral)",
                  color: "var(--ink)",
                  border: `2px solid ${INK}`,
                  boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
                  cursor: isBusy ? "not-allowed" : "pointer",
                }}
              >
                {t("agent.confirm")}
              </button>
            </div>
          </div>
        </BrutalModal>
      )}

      {/* workspace 更换（DirectoryPicker） */}
      {pickerOpen && (
        <DirectoryPicker
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            setPickerOpen(false);
            void run("workspace", () =>
              fetch(`/api/members/${encodeURIComponent(agent.id)}/workspace`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspacePath: path }),
              }));
          }}
        />
      )}
    </div>
  );
}
