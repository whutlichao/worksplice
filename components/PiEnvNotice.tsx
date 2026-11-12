"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, KeyRound } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationParams } from "@/lib/i18n/types";
import type { PiEnvFinding, PiEnvReason, PiEnvStatus } from "@/lib/pi-env-status";

/**
 * pi 配置根两档故障的**提示面**（issue #226）：侧栏配置区常驻状态条 + `ModelsConfig` 顶部入口。
 *
 * 两处共用同一个判定结论（`GET /api/pi-env/status`），组件自己不判定 —— 否则「判定」会分裂成两份。
 * 无结论时渲染 `null`（存量用户零感知），也不是模态：不拦路、不抢焦点。
 *
 * `PiEnvNotice` 是取数外壳，`PiEnvNoticeBar` 是纯呈现（SSR 可直接渲染三态做断言）。
 */

export type PiEnvNoticeVariant = "rail" | "modal";

/** 两种落点：侧栏状态条（~240px，短句）与弹框顶部（宽，完整句）。 */
type Shape = PiEnvNoticeVariant;

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
  lineHeight: "var(--lh-tight)",
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
  color: "var(--error)",
  overflowWrap: "anywhere",
};

const ACTIONS_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  flexShrink: 0,
};

const ICON_STYLE: React.CSSProperties = { flexShrink: 0, marginTop: 1 };

/** P1 的成因 → 文案键（rail = 侧栏短句，modal = 弹框完整句）。 */
type P1Reason = Exclude<PiEnvReason, "no-credentials">;

/**
 * 键型是全量 `Record` —— 判定层新增一种成因时这里必须补，不会静默回落到默认句。
 * 侧栏只有 ~240px，所以 `settings-unwritten` 在两种落点取不同长度的一句。
 */
const REASON_COPY: Record<P1Reason, Record<Shape, string>> = {
  "agent-dir-missing": {
    rail: "piEnv.uninitialized.dirMissing",
    modal: "piEnv.uninitialized.dirMissing",
  },
  "agent-dir-unreadable": {
    rail: "piEnv.uninitialized.dirUnreadable",
    modal: "piEnv.uninitialized.dirUnreadable",
  },
  "settings-unreadable": {
    rail: "piEnv.uninitialized.settingsUnreadable",
    modal: "piEnv.uninitialized.settingsUnreadable",
  },
  "settings-unwritten": {
    rail: "piEnv.uninitialized.bodyRail",
    modal: "piEnv.uninitialized.body",
  },
};

function isP1Reason(reason: PiEnvReason | null): reason is P1Reason {
  return reason !== null && reason !== "no-credentials";
}

function titleKey(finding: PiEnvFinding | null): string {
  if (finding === "no-credentials") return "piEnv.noCredentials.title";
  return "piEnv.uninitialized.title";
}

interface NoticeLineInput {
  shape: Shape;
  finding: PiEnvFinding | null;
  reason: PiEnvReason | null;
  error: string | null;
  doneLine: string | null;
  noopLine: string | null;
  t: (key: string, params?: TranslationParams) => string;
}

/** 正文行：一行一个事实（成因 / 逃生口 / 动作结果），按出现顺序摊开。 */
function buildNoticeLines(input: NoticeLineInput): string[] {
  const { shape, finding, reason, error, doneLine, noopLine, t } = input;
  if (error) return [`${t("piEnv.failed")}: ${error}`];

  const lines: string[] = [];
  if (finding === "uninitialized") {
    lines.push(t(REASON_COPY[isP1Reason(reason) ? reason : "settings-unwritten"][shape]));
  }
  if (finding === "no-credentials") {
    lines.push(t(shape === "rail" ? "piEnv.noCredentials.bodyRail" : "piEnv.noCredentials.bodyModal"));
  }
  if (reason === "settings-unwritten") {
    // 误报逃生口：凭证齐全（含环境变量）但没写过 settings.json 的人可以不理这一步。
    lines.push(t(shape === "rail" ? "piEnv.uninitialized.envKeyHintRail" : "piEnv.uninitialized.envKeyHint"));
  }
  if (doneLine) lines.push(doneLine);
  if (noopLine) lines.push(noopLine);
  return lines;
}

function NoticeActions({
  finding,
  initializing,
  onInitialize,
  onOpenModels,
}: {
  finding: PiEnvFinding | null;
  initializing: boolean;
  onInitialize?: () => void;
  onOpenModels?: () => void;
}) {
  const { t } = useI18n();
  const canInitialize = finding === "uninitialized" && Boolean(onInitialize);
  const canOpenModels = finding !== "uninitialized" && Boolean(onOpenModels);

  return (
    <div style={ACTIONS_STYLE}>
      {canInitialize && (
        <button type="button" className="btn btn-sm" onClick={onInitialize} disabled={initializing}>
          {initializing ? t("piEnv.uninitialized.running") : t("piEnv.uninitialized.action")}
        </button>
      )}
      {canOpenModels && (
        <button type="button" className="btn btn-sm" onClick={onOpenModels}>
          {t("piEnv.noCredentials.action")}
        </button>
      )}
    </div>
  );
}

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

  const lines = buildNoticeLines({
    shape: variant,
    finding,
    reason,
    error,
    doneLine,
    noopLine,
    t,
  });
  const lineStyle: React.CSSProperties =
    variant === "rail" ? { ...LINE_STYLE, fontSize: "var(--fs-caption)" } : LINE_STYLE;

  return (
    <div
      role={error ? "alert" : "status"}
      data-pi-env-notice={finding ?? "initialized"}
      style={CONTAINER_STYLE}
    >
      {finding === "no-credentials" && !error ? (
        <KeyRound size={14} strokeWidth={2.2} style={ICON_STYLE} />
      ) : (
        <AlertTriangle size={14} strokeWidth={2.2} style={ICON_STYLE} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={TITLE_STYLE}>{error ? t("piEnv.failed") : t(titleKey(finding))}</div>
        {lines.map((line, index) => (
          <div key={index} style={error ? ERROR_STYLE : lineStyle}>
            {line}
          </div>
        ))}
      </div>
      <NoticeActions
        finding={finding}
        initializing={initializing}
        onInitialize={onInitialize}
        onOpenModels={onOpenModels}
      />
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
      let payload: { created?: string[]; error?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // 非 JSON 正文：保留 HTTP 状态码作为可读原因
      }
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
