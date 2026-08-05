"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { ModelsData } from "@/lib/models-cache";

const INK = "#141111";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const THINKING_KEY: Record<(typeof THINKING_LEVELS)[number], string> = {
  off: "chat.thinkingOff",
  minimal: "chat.thinkingMinimal",
  low: "chat.thinkingLow",
  medium: "chat.thinkingMedium",
  high: "chat.thinkingHigh",
  xhigh: "chat.thinkingXhigh",
  max: "chat.thinkingMax",
};

function filterModelOptions(
  options: ModelsData["modelList"],
  query: string,
): ModelsData["modelList"] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return options;
  return options.filter((o) =>
    `${o.name} ${o.id} ${o.provider}`.toLocaleLowerCase().includes(q),
  );
}

/**
 * §3.10 per-agent runtime 模型选择器：按 provider 分组的模型下拉 + 思考级别下拉，
 * 交互与 ChatInput 模型选择器一致（过滤框 + provider 分组），视觉走马卡龙 × brutalist。
 * value 为 null 表示"继承全局默认"。
 */
export function ModelPicker({
  models,
  loading,
  model,
  thinkingLevel,
  onModelChange,
  onClearModel,
  onThinkingChange,
  onClearThinking,
  disabled,
}: {
  models: ModelsData | null;
  loading?: boolean;
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string | null;
  onModelChange?: (provider: string, modelId: string) => void;
  onClearModel?: () => void;
  onThinkingChange?: (level: string) => void;
  onClearThinking?: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [modelOpen, setModelOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const thinkingPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) setModelOpen(false);
      }
      if (thinkingRef.current && !thinkingRef.current.contains(e.target as Node)) {
        if (thinkingPanelRef.current && !thinkingPanelRef.current.contains(e.target as Node)) {
          setThinkingOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const modelOptions = models?.modelList ?? [];
  const filtered = filterModelOptions(modelOptions, filter);
  const groups = new Map<string, ModelsData["modelList"]>();
  for (const opt of filtered) {
    const list = groups.get(opt.provider) ?? [];
    list.push(opt);
    groups.set(opt.provider, list);
  }

  const currentName = useCallback(() => {
    if (!model) return null;
    const key = `${model.provider}:${model.modelId}`;
    return models?.models?.[key] ?? model.modelId;
  }, [model, models]);

  const currentLabel = currentName();
  const thinkingLabel = thinkingLevel
    ? (THINKING_KEY[thinkingLevel as (typeof THINKING_LEVELS)[number]] ?? thinkingLevel)
    : null;

  const buttonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "7px 10px",
    background: "#ffffff",
    color: "var(--text)",
    border: `2px solid ${INK}`,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "var(--font-space-grotesk)",
    fontSize: 12,
    fontWeight: 600,
    textAlign: "left",
    opacity: disabled ? 0.6 : 1,
  };

  const panelStyle = (open: boolean): React.CSSProperties => ({
    position: "fixed",
    top: rect ? rect.top + 30 : 0,
    left: rect ? rect.left : 0,
    zIndex: 600,
    minWidth: 260,
    maxWidth: "min(340px, calc(100vw - 16px))",
    background: "var(--bg-panel)",
    border: `2px solid ${INK}`,
    boxShadow: "4px 4px 0 0 rgba(20, 17, 17, 0.45)",
    display: open ? "block" : "none",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 模型 */}
      <div ref={modelRef} style={{ position: "relative" }}>
        <button
          type="button"
          disabled={disabled || (modelOptions.length === 0 && !loading)}
          title={t("runtime.model")}
          style={buttonStyle}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setRect({ top: r.top, left: r.left, width: r.width });
            setModelOpen((v) => !v);
            setFilter("");
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
          </svg>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
            {loading ? t("runtime.loading") : currentLabel ?? t("runtime.inheritGlobal")}
          </span>
          <span style={{ opacity: 0.6 }}>▾</span>
        </button>
        <div ref={panelRef} style={panelStyle(modelOpen)}>
          {modelOptions.length > 6 && (
            <div style={{ padding: 6, borderBottom: `2px solid ${INK}` }}>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("chat.filterModels")}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  padding: "5px 8px",
                  border: `2px solid ${INK}`,
                  outline: "none",
                  background: "#ffffff",
                  color: "var(--text)",
                }}
              />
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {groups.size === 0 ? (
              <div style={{ padding: "10px 12px", color: "var(--text-dim)", fontSize: 12 }}>
                {loading ? t("runtime.loading") : t("chat.noMatchingModels")}
              </div>
            ) : (
              [...groups.entries()].map(([provider, options]) => (
                <div key={provider}>
                  <div
                    style={{
                      fontFamily: "var(--font-space-mono)",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--text-dim)",
                      padding: "6px 10px 2px",
                    }}
                  >
                    {provider}
                  </div>
                  {options.map((opt) => {
                    const active = model?.provider === opt.provider && model.modelId === opt.id;
                    return (
                      <button
                        key={`${opt.provider}:${opt.id}`}
                        type="button"
                        onClick={() => {
                          onModelChange?.(opt.provider, opt.id);
                          setModelOpen(false);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "6px 10px",
                          background: active ? "var(--yellow)" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "var(--font-space-grotesk)",
                          fontSize: 12,
                          color: "var(--text)",
                        }}
                        onMouseEnter={(e) => {
                          if (!active) e.currentTarget.style.background = "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = active ? "var(--yellow)" : "transparent";
                        }}
                      >
                        <span style={{ fontWeight: active ? 700 : 500 }}>{opt.name || opt.id}</span>
                        <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 6 }}>
                          {opt.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          {onClearModel && (
            <button
              type="button"
              onClick={() => {
                onClearModel();
                setModelOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                background: "#ffffff",
                border: "none",
                borderTop: `2px solid ${INK}`,
                cursor: "pointer",
                fontFamily: "var(--font-space-mono)",
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-muted)",
              }}
            >
              <X size={12} style={{ verticalAlign: "-2px" }} /> {t("runtime.inheritGlobal")}
            </button>
          )}
        </div>
      </div>

      {/* 思考级别 */}
      <div ref={thinkingRef} style={{ position: "relative" }}>
        <button
          type="button"
          disabled={disabled}
          style={buttonStyle}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setRect({ top: r.top, left: r.left, width: r.width });
            setThinkingOpen((v) => !v);
          }}
        >
          <Brain size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
            {thinkingLabel ? t(thinkingLabel) : t("runtime.thinkingDefault")}
          </span>
          <span style={{ opacity: 0.6 }}>▾</span>
        </button>
        <div
          ref={thinkingPanelRef}
          style={{
            ...panelStyle(thinkingOpen),
            minWidth: 200,
          }}
        >
          <button
            type="button"
            onClick={() => {
              onClearThinking?.();
              setThinkingOpen(false);
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "7px 10px",
              background: !thinkingLevel ? "var(--yellow)" : "transparent",
              border: "none",
              borderBottom: `2px solid ${INK}`,
              cursor: "pointer",
              fontFamily: "var(--font-space-grotesk)",
              fontSize: 12,
              fontWeight: !thinkingLevel ? 700 : 500,
              color: "var(--text)",
            }}
          >
            {t("runtime.thinkingDefault")}
          </button>
          {THINKING_LEVELS.map((level) => {
            const active = thinkingLevel === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => {
                  onThinkingChange?.(level);
                  setThinkingOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 10px",
                  background: active ? "var(--yellow)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-space-grotesk)",
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  color: "var(--text)",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = active ? "var(--yellow)" : "transparent";
                }}
              >
                {t(THINKING_KEY[level])}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
