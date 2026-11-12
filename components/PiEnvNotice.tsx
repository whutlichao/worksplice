"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, KeyRound } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { PiEnvStatus } from "@/lib/pi-env-status";

/**
 * pi 配置根两档故障的**提示面**（issue #226）：侧栏配置区常驻状态条 + `ModelsConfig` 顶部入口。
 *
 * 两处共用同一个判定结论（`GET /api/pi-env/status`），组件自己不判定 —— 否则「判定」会分裂成两份。
 * 无结论时渲染 `null`（存量用户零感知），也不是模态：不拦路、不抢焦点。
 *
 * `PiEnvNotice` 是取数外壳，`PiEnvNoticeBar` 是纯呈现（SSR 可直接渲染三态做断言）。
 */

export type PiEnvNoticeVariant = "rail" | "modal";

export interface PiEnvNoticeBarProps {
  variant: PiEnvNoticeVariant;
  /** `null` = 还没拿到结论（加载中 / 查询失败）：一律不渲染。 */
  status: PiEnvStatus | null;
  initializing?: boolean;
  /** 初始化动作的可读失败原因（服务端映射后的正文）。 */
  error?: string | null;
  /** 初始化动作的改动清单；`null` = 还没跑过。 */
  created?: string[] | null;
  onInitialize?: () => void;
  /** 只给侧栏：把用户送到既有的 provider 面（ModelsConfig）。 */
  onOpenModels?: () => void;
}

const CONTAINER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "var(--sp-2)",
  margin: "0",
  padding: "var(--sp-2) var(--sp-3)",
  borderTop: "1px solid var(--border)",
  background: "var(--warn-soft)",
  color: "var(--fg)",
  fontSize: "var(--fs-sm)",
  lineHeight: "var(--lh-tight, 1.35)",
};

const TITLE_STYLE: React.CSSProperties = {
  fontWeight: 600,
  color: "var(--warn-deep)",
};

const LINE_STYLE: React.CSSProperties = {
  marginTop: 2,
  color: "var(--muted)",
};

const ERROR_STYLE: React.CSSProperties = {
  marginTop: 2,
  color: "var(--error-deep)",
  overflowWrap: "anywhere",
};

const ACTIONS_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  flexShrink: 0,
};

/** P1 的分支文案：不同成因给不同的一句，别让「点了没变化」无从解释。 */
const REASON_DETAIL_KEY: Record<string, string> = {
  "agent-dir-missing": "piEnv.uninitialized.dirMissing",
  "agent-dir-unreadable": "piEnv.uninitialized.dirUnreadable",
  "settings-unreadable": "piEnv.uninitialized.settingsUnreadable",
  "settings-unwritten": "piEnv.uninitialized.body",
};

/** 侧欄只有 ~240px：同一句话在侧欄用短版、在弹框顶部用长版。 */
const RAIL_BODY_KEY: Record<string, string> = {
  "agent-dir-missing": "piEnv.uninitialized.dirMissing",
  "agent-dir-unreadable": "piEnv.uninitialized.dirUnreadable",
  "settings-unreadable": "piEnv.uninitialized.settingsUnreadable",
  "settings-unwritten": "piEnv.uninitialized.bodyRail",
};

export function PiEnvNoticeBar({
  variant,
  status,
  initializing = false,
  error = null,
  created = null,
  onInitialize,
  onOpenModels,
}: PiEnvNoticeBarProps) {
  const { t } = useI18n();
  const finding = status?.finding ?? null;
  const reason = status?.reason ?? null;
  const doneLine =
    created !== null && created.length > 0
      ? t("piEnv.init.done", { count: created.length })
      : null;
  const noopLine =
    created !== null && created.length === 0 && finding === "uninitialized"
      ? t("piEnv.init.noop")
      : null;

  // 无结论且这次动作也没留下可看的反馈 ⇒ 渲染 null（存量用户零感知）。
  if (finding === null && doneLine === null && !error) return null;

  const rail = variant === "rail";
  const detailKey = (rail ? RAIL_BODY_KEY : REASON_DETAIL_KEY)[reason ?? ""]
    ?? "piEnv.uninitialized.body";
  const noCredentialsKey = rail ? "piEnv.noCredentials.bodyRail" : "piEnv.noCredentials.bodyModal";
  const lineStyle: React.CSSProperties = rail
    ? { ...LINE_STYLE, fontSize: "var(--fs-caption)" }
    : LINE_STYLE;
  const title = error
    ? t("piEnv.failed")
    : finding === "no-credentials"
      ? t("piEnv.noCredentials.title")
      : t("piEnv.uninitialized.title");

  // 正文行按顺序摊开再渲染：一行一个成因，分支多但每条只有一句。
  const lines: string[] = [];
  if (error) {
    lines.push(`${t("piEnv.failed")}: ${error}`);
  } else {
    if (finding === "uninitialized") lines.push(t(detailKey));
    if (finding === "no-credentials") lines.push(t(noCredentialsKey));
    if (reason === "settings-unwritten") {
      lines.push(rail ? t("piEnv.uninitialized.envKeyHintRail") : t("piEnv.uninitialized.envKeyHint"));
    }
    if (doneLine) lines.push(doneLine);
    if (noopLine) lines.push(noopLine);
  }

  return (
    <div
      role={error ? "alert" : "status"}
      data-pi-env-notice={finding ?? "initialized"}
      style={CONTAINER_STYLE}
    >
      {finding === "no-credentials" && !error ? (
        <KeyRound size={14} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
      ) : (
        <AlertTriangle size={14} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={TITLE_STYLE}>{title}</div>
        {lines.map((line, index) => (
          <div key={index} style={error ? ERROR_STYLE : lineStyle}>{line}</div>
        ))}
      </div>
      <div style={ACTIONS_STYLE}>
        {finding === "uninitialized" && onInitialize && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={onInitialize}
            disabled={initializing}
          >
            {initializing ? t("piEnv.uninitialized.running") : t("piEnv.uninitialized.action")}
          </button>
        )}
        {finding !== "uninitialized" && onOpenModels && (
          <button type="button" className="btn btn-sm" onClick={onOpenModels}>
            {t("piEnv.noCredentials.action")}
          </button>
        )}
      </div>
    </div>
  );
}

/** 取数外壳：只在挂载后查一次结论（不轮询 —— 环境变化由用户的动作触发重判）。 */
export function PiEnvNotice({
  variant = "rail",
  onOpenModels,
}: {
  variant?: PiEnvNoticeVariant;
  onOpenModels?: () => void;
}) {
  const [status, setStatus] = useState<PiEnvStatus | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/pi-env/status");
      if (!response.ok) return; // 查询失败：保持静默，提示面不拦路
      setStatus((await response.json()) as PiEnvStatus);
    } catch {
      // 同上：拿不到结论就不显示结论
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 动作之后按新状态重判：初始化成功通常直接落到 P2（去配凭证），文案因此不是无声消失。
  const initialize = useCallback(async () => {
    setInitializing(true);
    setError(null);
    try {
      const response = await fetch("/api/pi-env/init", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        created?: string[];
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? `HTTP ${response.status}`);
        return;
      }
      setCreated(payload.created ?? []);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setInitializing(false);
    }
  }, [load]);

  return (
    <PiEnvNoticeBar
      variant={variant}
      status={status}
      initializing={initializing}
      error={error}
      created={created}
      onInitialize={initialize}
      onOpenModels={onOpenModels}
    />
  );
}
