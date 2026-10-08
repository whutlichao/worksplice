"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";
import { ModelPicker } from "./ModelPicker";
import type { ModelsData } from "@/lib/models-cache";
import type { MemberRow } from "@/lib/data/types";
import { hasLiveSusan, resolveBootstrapModel } from "@/lib/secretary-bootstrap";

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: `1px solid var(--border)`,
  background: "#ffffff",
  color: "var(--fg)",
  fontFamily: "var(--font)",
  fontSize: 13,
  outline: "none",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
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

/** 渲染面完整 ModelsData 骨架（各字段缺省值）。 */
const EMPTY_MODELS_BODY: Pick<
  ModelsData,
  "models" | "modelList" | "defaultModel" | "thinkingLevels" | "thinkingLevelMaps" | "thinkingLevelPins"
> = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
};

/**
 * 归一化 `/api/models` 的 body → 完整 ModelsData。
 *
 * 该路由在 cwd 校验失败时返回 `{ error }`（400/403，无 modelList 字段，见
 * app/api/models/route.ts）；客户端只判 JSON 解析成败、不看 HTTP status，所以
 * `res.json()` 会把 `{ error }` 原样交给 setModels；`.catch(() => ({}))` 还会兜出 `{}`。
 * 直接 setModels(body) 会让渲染侧读到缺字段的对象——这条曾打穿整页（渲染抛错且
 * 全仓无 error boundary），故在此收口：state 里永远只放结构完整的 ModelsData。
 * 合法 body 原样透传，不改服务端契约。
 */
export function normalizeModelsBody(body: unknown): ModelsData {
  const raw = (body ?? {}) as Partial<ModelsData>;
  return {
    models: raw.models ?? EMPTY_MODELS_BODY.models,
    modelList: raw.modelList ?? EMPTY_MODELS_BODY.modelList,
    defaultModel: raw.defaultModel ?? EMPTY_MODELS_BODY.defaultModel,
    thinkingLevels: raw.thinkingLevels ?? EMPTY_MODELS_BODY.thinkingLevels,
    thinkingLevelMaps: raw.thinkingLevelMaps ?? EMPTY_MODELS_BODY.thinkingLevelMaps,
    thinkingLevelPins: raw.thinkingLevelPins ?? EMPTY_MODELS_BODY.thinkingLevelPins,
    ...(raw.modelError ? { modelError: raw.modelError } : {}),
    ...(raw.modelScopeWarnings ? { modelScopeWarnings: raw.modelScopeWarnings } : {}),
  };
}

/**
 * 模型列表为空提示（ADR-0001）。承载 `models` 的空值收口，与 ModelPicker 同形。
 * 单独成组件：`renderToStaticMarkup` 不跑 useEffect，渲染面回归测试只能从这里进入
 * 「models 拿到的 body 不含 modelList」这条真实路径（见 CreateAgentModal.test.mjs）。
 */
export function ModelsEmptyHint({
  models,
  loading,
}: {
  models: ModelsData | null;
  loading: boolean;
}) {
  const { t } = useI18n();
  if (loading) return null;
  if ((models?.modelList?.length ?? 0) !== 0) return null;
  return (
    <div style={{ marginTop: 6, fontSize: 11, color: "var(--faint)" }}>
      {t("agent.modelsEmpty")}
    </div>
  );
}

/**
 * 创建 agent（ADR-0001）：不选目录——家目录自动生成；模型/推理强度必选（预选全局默认）。
 * 启动助手入口（spec §6.3）：成员列表无存活 Susan 时显示「创建启动助手」按钮——模型已配置
 * → 直接创建并走 04 完整初始化流程（POST /api/secretary/init）；未配置 → 引导打开模型配置。
 * 与普通表单并列互不干扰（表单可建任意 agent，含与 Susan 同名的手动边角，spec §6.4）。
 */
export function CreateAgentModal({
  onClose,
  onCreated,
  agents,
  onOpenModelsConfig,
}: {
  onClose: () => void;
  onCreated: () => void;
  agents: MemberRow[];
  onOpenModelsConfig: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [models, setModels] = useState<ModelsData | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 模型列表（全局默认 scope——创建时还没有项目目录）；预选全局默认模型
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const res = await fetch("/api/models");
        const body = await res.json().catch(() => ({}));
        if (disposed) return;
        const modelsData = normalizeModelsBody(body);
        setModels(modelsData);
        const options = modelsData.modelList;
        const defaultKey = modelsData.defaultModel
          ? `${modelsData.defaultModel.provider}:${modelsData.defaultModel.modelId}`
          : null;
        const initial = defaultKey
          ? options.find((o) => `${o.provider}:${o.id}` === defaultKey)
          : undefined;
        const chosen = initial ?? options[0];
        if (chosen) {
          setModel({ provider: chosen.provider, modelId: chosen.id });
          setThinkingLevel(defaultThinkingLevel(modelsData, chosen.provider, chosen.id));
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

  // 启动助手（spec §6.3）：无存活 Susan 时显示；点击——模型已配置 → 直接创建走 04 初始化，
  // 未配置 → 引导打开模型配置（配置完成后再点即可创建）
  const showBootstrap = !hasLiveSusan(agents);

  const bootstrap = async () => {
    if (bootstrapBusy) return;
    const configured = resolveBootstrapModel(models);
    if (!configured) {
      onOpenModelsConfig();
      return;
    }
    setBootstrapBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/secretary/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: configured.provider,
          modelId: configured.modelId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to create secretary");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBootstrapBusy(false);
    }
  };

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
        {showBootstrap && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 12px 10px",
              border: `1px dashed var(--border-strong)`,
              background: "#fffdf5",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <button
              type="button"
              disabled={bootstrapBusy || modelsLoading}
              onClick={() => void bootstrap()}
              style={{
                flexShrink: 0,
                padding: "8px 12px",
                fontFamily: "var(--font)",
                fontWeight: 700,
                fontSize: 13,
                background: "var(--accent)",
                color: "oklch(99% 0.01 256)",
                border: `1px solid var(--border)`,
                boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
                cursor: bootstrapBusy || modelsLoading ? "wait" : "pointer",
                opacity: bootstrapBusy || modelsLoading ? 0.7 : 1,
              }}
            >
              {bootstrapBusy ? "…" : t("agent.bootstrap")}
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
              {t("agent.bootstrapHint")}
            </span>
          </div>
        )}

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
        <ModelsEmptyHint models={models} loading={modelsLoading} />
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--faint)" }}>
          {t("agent.homeHint")}
        </div>

        {error && (
          <div style={{ marginTop: 10, color: "var(--error)", fontSize: 12 }}>{error}</div>
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
              fontFamily: "var(--font)",
              fontWeight: 700,
              fontSize: 13,
              background: "#ffffff",
              color: "var(--fg)",
              border: `1px solid var(--border)`,
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
              fontFamily: "var(--font)",
              fontWeight: 700,
              fontSize: 13,
              background: "var(--accent)",
              color: "oklch(99% 0.01 256)",
              border: `1px solid var(--border)`,
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
