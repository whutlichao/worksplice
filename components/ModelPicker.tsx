"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Brain, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { collectTabbables } from "@/lib/modal-focus";
import type { ModelsData } from "@/lib/models-cache";

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
 * 交互与 ChatInput 模型选择器一致（过滤框 + provider 分组），视觉走现代极简（modern-minimal）契约。
 * value 为 null 表示"继承全局默认"。
 *
 * 两个下拉是**非模态 popover**（票 04，T2）：触发按钮声明 `aria-expanded` /
 * `aria-haspopup="dialog"`，面板是带可访问名的 `role="dialog"`；打开时焦点移进面板
 * 首个可聚焦项，Escape 由本组件关闭并把焦点还给触发按钮。面板**不**声明 `aria-modal`、
 * 也不装焦点陷阱——它不拦整页 Tab，键盘模型就是真实的 Tab 序（Tab 一圈后会自然走出去）。
 * 选 `dialog` 而不是 `listbox`：面板里有过滤输入框与 provider 分组标题，`listbox`
 * 会承诺一套本组件没有实现的方向键 / type-ahead（界面评审 A5 的同类教训）。
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
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const thinkingTriggerRef = useRef<HTMLButtonElement>(null);
  /**
   * 两个面板的 id 用 `useId`：本组件在 `AgentDetailPanel` 与 `CreateAgentModal`
   * 里各挂一份，固定 id 在两者同时存在时会重复，`aria-controls` 就指错面板。
   */
  const baseId = useId();
  const modelPanelId = `${baseId}-model-panel`;
  const thinkingPanelId = `${baseId}-thinking-panel`;

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

  /**
   * 打开后把焦点移进面板（票 04，T2）。面板本体用 `display: none / block` 切换，
   * 元素从不重新挂载，所以 React 的 `autoFocus` 永远不会生效——移焦必须由这次
   * 状态切换驱动。判定复用 `lib/modal-focus.ts` 的 `collectTabbables`，
   * 不在这里另写一份「哪些元素可聚焦」。
   */
  const focusIntoPanel = useCallback((panel: HTMLDivElement | null) => {
    if (!panel || panel.contains(document.activeElement)) return;
    const [first] = collectTabbables(panel);
    (first ?? panel).focus();
  }, []);

  useEffect(() => {
    if (modelOpen) focusIntoPanel(panelRef.current);
  }, [modelOpen, focusIntoPanel]);

  useEffect(() => {
    if (thinkingOpen) focusIntoPanel(thinkingPanelRef.current);
  }, [thinkingOpen, focusIntoPanel]);

  /**
   * 关闭并（可选）把焦点还给触发按钮。Escape 与「选中一项」都走这条路：
   * 否则面板收起后 `document.activeElement` 落到已隐藏的按钮上，焦点丢到页面根。
   */
  const closeModel = useCallback((restoreFocus: boolean) => {
    setModelOpen(false);
    if (restoreFocus) modelTriggerRef.current?.focus();
  }, []);
  const closeThinking = useCallback((restoreFocus: boolean) => {
    setThinkingOpen(false);
    if (restoreFocus) thinkingTriggerRef.current?.focus();
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
    background: "var(--surface)",
    color: "var(--fg)",
    border: `1px solid var(--border-strong)`,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "var(--font)",
    fontSize: "var(--fs-sm)",
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
    background: "var(--panel)",
    border: `1px solid var(--border)`,
    boxShadow: "var(--shadow-pop)",
    display: open ? "block" : "none",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 模型 */}
      <div
        ref={modelRef}
        style={{ position: "relative" }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !modelOpen) return;
          // 面板常驻 DOM，收起不影响焦点；先截断 React 树（`BrutalModal` 里它被包在
          // 模态中，Esc 会顺树冒泡去关整个模态），再关闭自己并把焦点还给触发按钮。
          event.stopPropagation();
          event.preventDefault();
          closeModel(true);
        }}
      >
        <button
          ref={modelTriggerRef}
          type="button"
          disabled={disabled || (modelOptions.length === 0 && !loading)}
          title={t("runtime.model")}
          // 非模态 popover 的最小契约（票 04，T2）：`aria-haspopup="dialog"` 与面板的
          // `role="dialog"` 一致；不写 `aria-modal`——它不拦整页 Tab，键盘模型就是真实 Tab 序。
          aria-haspopup="dialog"
          aria-expanded={modelOpen}
          aria-controls={modelPanelId}
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
        <div
          ref={panelRef}
          id={modelPanelId}
          // 非模态 dialog：面板里除选项还有过滤输入框与 provider 分组标题，`listbox`
          // 会承诺一套本组件没有实现的方向键 / type-ahead；dialog + 真实 Tab 序才是
          // 与实现相符的声明（界面评审 A5 的同类教训：声明了什么就要真实现什么）。
          role="dialog"
          aria-label={t("runtime.model")}
          tabIndex={-1}
          style={panelStyle(modelOpen)}
        >
          {modelOptions.length > 6 && (
            <div style={{ padding: 6, borderBottom: `1px solid var(--border)` }}>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("chat.filterModels")}
                // 不再写 `autoFocus`：面板是常驻 DOM + `display: none` 切换的，元素从不在
                // 打开时重新挂载，`autoFocus` 永远落在「面板还隐藏」的那一帧上——是死代码，
                // 而且它会让人误以为焦点由它负责。移焦现在由上面的 effect 显式做。
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontSize: "var(--fs-caption)",
                  fontFamily: "var(--font-mono)",
                  padding: "5px 8px",
                  border: `1px solid var(--border-strong)`,
                  outline: "none",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface)",
                  color: "var(--fg)",
                }}
              />
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {groups.size === 0 ? (
              <div style={{ padding: "10px 12px", color: "var(--faint)", fontSize: "var(--fs-sm)" }}>
                {loading ? t("runtime.loading") : t("chat.noMatchingModels")}
              </div>
            ) : (
              [...groups.entries()].map(([provider, options]) => (
                <div key={provider}>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "var(--fs-mono-xs)",
                      fontWeight: 700,
                      letterSpacing: "var(--ls-wider)",
                      textTransform: "uppercase",
                      color: "var(--faint)",
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
                          // 选完把焦点还给触发按钮：面板是 `display: none` 收起的，
                          // 焦点留在面板里等于丢到页面根（票 04，T2 实测的 before）。
                          closeModel(true);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "6px 10px",
                          background: active ? "var(--accent-soft)" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "var(--font)",
                          fontSize: "var(--fs-sm)",
                          color: "var(--fg)",
                        }}
                        onMouseEnter={(e) => {
                          if (!active) e.currentTarget.style.background = "var(--fg-soft)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = active ? "var(--accent-soft)" : "transparent";
                        }}
                      >
                        <span style={{ fontWeight: active ? 700 : 500 }}>{opt.name || opt.id}</span>
                        <span style={{ color: "var(--faint)", fontSize: "var(--fs-mono-xs)", marginLeft: 6 }}>
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
                closeModel(true);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                background: "var(--surface)",
                border: "none",
                borderTop: `1px solid var(--border)`,
                cursor: "pointer",
                fontFamily: "var(--mono)",
                fontSize: "var(--fs-caption)",
                fontWeight: 700,
                color: "var(--muted)",
              }}
            >
              <X size={12} style={{ verticalAlign: "-2px" }} /> {t("runtime.inheritGlobal")}
            </button>
          )}
        </div>
      </div>

      {/* 思考级别 */}
      <div
        ref={thinkingRef}
        style={{ position: "relative" }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !thinkingOpen) return;
          event.stopPropagation();
          event.preventDefault();
          closeThinking(true);
        }}
      >
        <button
          ref={thinkingTriggerRef}
          type="button"
          disabled={disabled}
          title={t("runtime.thinking")}
          aria-haspopup="dialog"
          aria-expanded={thinkingOpen}
          aria-controls={thinkingPanelId}
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
          id={thinkingPanelId}
          role="dialog"
          aria-label={t("runtime.thinking")}
          tabIndex={-1}
          style={{
            ...panelStyle(thinkingOpen),
            minWidth: 200,
          }}
        >
          <button
            type="button"
            onClick={() => {
              onClearThinking?.();
              closeThinking(true);
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "7px 10px",
              background: !thinkingLevel ? "var(--accent-soft)" : "transparent",
              border: "none",
              borderBottom: `1px solid var(--border)`,
              cursor: "pointer",
              fontFamily: "var(--font)",
              fontSize: "var(--fs-sm)",
              fontWeight: !thinkingLevel ? 700 : 500,
              color: "var(--fg)",
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
                  closeThinking(true);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 10px",
                  background: active ? "var(--accent-soft)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font)",
                  fontSize: "var(--fs-sm)",
                  fontWeight: active ? 700 : 500,
                  color: "var(--fg)",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--fg-soft)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = active ? "var(--accent-soft)" : "transparent";
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
