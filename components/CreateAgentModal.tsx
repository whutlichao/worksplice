"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";
import { ModelPicker } from "./ModelPicker";
import type { ModelsData } from "@/lib/models-cache";

const INK = "#141111";

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: `2px solid ${INK}`,
  background: "#ffffff",
  color: "var(--text)",
  fontFamily: "var(--font-space-grotesk)",
  fontSize: 13,
  outline: "none",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-space-mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: "12px 0 5px",
};

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** 创建默认推理强度：模型 pin 优先，否则 medium（ADR-0001 创建时必选但预选默认）。 */
function defaultThinkingLevel(
  models: ModelsData | null,
  provider: string,
  modelId: string,
): string {
  const pinned = models?.thinkingLevelPins?.[`${provider}:${modelId}`];
  return pinned && THINKING_LEVELS.includes(pinned) ? pinned : "medium";
}

/**
 * 创建 agent（ADR-0001）：不选目录——家目录自动生成；模型/推理强度必选（预选全局默认）。
 */
export function CreateAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [models, setModels] = useState<ModelsData | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 模型列表（全局默认 scope——创建时还没有项目目录）；预选全局默认模型
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const res = await fetch("/api/models");
        const body = (await res.json().catch(() => ({}))) as ModelsData;
        if (disposed) return;
        setModels(body);
        const options = body.modelList ?? [];
        const defaultKey = body.defaultModel
          ? `${body.defaultModel.provider}:${body.defaultModel.modelId}`
          : null;
        const initial = defaultKey
          ? options.find((o) => `${o.provider}:${o.id}` === defaultKey)
          : undefined;
        const chosen = initial ?? options[0];
        if (chosen) {
          setModel({ provider: chosen.provider, modelId: chosen.id });
          setThinkingLevel(defaultThinkingLevel(body, chosen.provider, chosen.id));
        }
      } finally {
        if (!disposed) setModelsLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const canSubmit =
    name.trim().length > 0 && model !== null && thinkingLevel !== null && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          provider: model!.provider,
          modelId: model!.modelId,
          thinkingLevel,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to create agent");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <BrutalModal title={t("agent.create")} onClose={onClose}>
      <div style={{ padding: "4px 16px 16px" }}>
        <label style={LABEL_STYLE} htmlFor="agent-name">
          {t("agent.name")}
        </label>
        <input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="bob"
          style={FIELD_STYLE}
          autoFocus
        />

        <label style={LABEL_STYLE} htmlFor="agent-description">
          {t("agent.description")}
        </label>
        <textarea
          id="agent-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ ...FIELD_STYLE, resize: "vertical" }}
        />

        <label style={LABEL_STYLE}>{t("agent.modelAndThinking")}</label>
        <ModelPicker
          models={models}
          loading={modelsLoading}
          model={model}
          thinkingLevel={thinkingLevel}
          onModelChange={(provider, modelId) => {
            setModel({ provider, modelId });
            setThinkingLevel(defaultThinkingLevel(models, provider, modelId));
          }}
          onClearModel={() => setModel(null)}
          onThinkingChange={setThinkingLevel}
          onClearThinking={() => setThinkingLevel(null)}
        />
        {!modelsLoading && (models?.modelList.length ?? 0) === 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
            {t("agent.modelsEmpty")}
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
          {t("agent.homeHint")}
        </div>

        {error && (
          <div style={{ marginTop: 10, color: "var(--coral)", fontSize: 12 }}>{error}</div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 13,
              background: "#ffffff",
              color: "var(--text)",
              border: `2px solid ${INK}`,
              cursor: "pointer",
            }}
          >
            {t("agent.cancel")}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 13,
              background: "var(--pink)",
              color: "var(--ink)",
              border: `2px solid ${INK}`,
              boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.55,
            }}
          >
            {t("agent.create")}
          </button>
        </div>
      </div>
    </BrutalModal>
  );
}
