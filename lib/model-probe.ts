import {
  completeSimple,
  type AssistantMessage,
  type Model,
  type Api,
} from "@earendil-works/pi-ai/compat";

/**
 * 模型探测内核（票据 02 决策 9）：把「最小连通性调用 → 结论映射」抽成可复用的一份实现，
 * 两个调用点共用同一份常量与结论语义——
 * - `app/api/models-config/test/route.ts`（模型配置面板的「测试模型」，未保存配置 + 临时 models.json）；
 * - `lib/agent-recovery.ts` 的恢复探测（已落库覆盖对在真实配置下的解析结果）。
 *
 * 本模块不碰状态、不碰 DB、不建会话：它只回答「这一次最小调用通不通」。
 * 调用点（`lib/agent-recovery.ts` / `app/api/models-config/test/route.ts`）负责先把模型解析成
 * `model` + 凭证，本模块负责发起与映射。
 */

/** 单次探测上限（面板既有常量，逐字保留）。 */
export const MODEL_PROBE_TIMEOUT_MS = 20_000;
/** 最小调用的输出上限（几十 token 量级）。 */
export const MODEL_PROBE_MAX_TOKENS = 16;
/** 探测不重试：结论要的是「此刻通不通」，重试只会拉长等待。 */
export const MODEL_PROBE_MAX_RETRIES = 0;
/** 结论里回显的响应文本上限。 */
export const MODEL_PROBE_RESPONSE_TEXT_LIMIT = 300;
/** 最小 prompt。 */
export const MODEL_PROBE_PROMPT = "Reply with OK only.";

export interface ModelProbeCredentials {
  apiKey: string;
  headers?: Record<string, string | null>;
}

/** 探测结论：`ok` 是唯一裁决位；`error` 只在 false 时出现，`latencyMs/status` 是诊断信息。 */
export interface ModelProbeVerdict {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  status?: number;
  responseText?: string;
}

/** 传给 completer 的调用参数（与面板既有调用逐字同参）。 */
export interface ModelProbeCompleteOptions {
  apiKey: string;
  headers?: Record<string, string | null>;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  cacheRetention: "none";
  signal: AbortSignal;
  onResponse: (response: { status: number }) => void;
}

/** 最小调用接缝：默认走 SDK 的 `completeSimple`，测试注入 fake（零网络、零凭证）。 */
export type ModelProbeCompleter = (
  model: Model<Api>,
  context: Parameters<typeof completeSimple>[1],
  options: ModelProbeCompleteOptions,
) => Promise<AssistantMessage>;

export interface ModelProbeOptions {
  /** 单次探测上限（默认 `MODEL_PROBE_TIMEOUT_MS`）。 */
  timeoutMs?: number;
  /** 测试注入：底层最小调用。 */
  complete?: ModelProbeCompleter;
}

const defaultCompleter: ModelProbeCompleter = (model, context, options) =>
  completeSimple(model, context, options as Parameters<typeof completeSimple>[2]);

export function probeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 凭证判据（两个调用点共用）：解析结果里没有可用的 apiKey 就不能发起调用——
 * 面板把它映射成 200 的 `{ok:false,error}`，恢复探测把它当解析失败（fail-closed，不假绿）。
 */
export function probeCredentialsFrom(
  auth: { apiKey?: string; headers?: Record<string, string | null> } | null | undefined,
): ModelProbeCredentials | null {
  if (!auth?.apiKey) return null;
  return auth.headers ? { apiKey: auth.apiKey, headers: auth.headers } : { apiKey: auth.apiKey };
}

/** 「拿不到凭证」的统一可读原因（两个调用点逐字一致）。 */
export function missingProbeCredentialsError(provider: string): string {
  return `No API key found for "${provider}"`;
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * 一次最小连通性探测：可中止的超时 + `maxTokens/maxRetries` 收窄 + 结论映射。
 * 不写任何状态；不吞错——completer 拒绝原样抛给调用方，由调用点各自 fail-closed 兜底
 *（面板路由 → 500；恢复探测 → `{ok:false,error}`，状态点保持不动）。
 */
export async function runModelProbe(
  model: Model<Api>,
  credentials: ModelProbeCredentials,
  options: ModelProbeOptions = {},
): Promise<ModelProbeVerdict> {
  const timeoutMs = options.timeoutMs ?? MODEL_PROBE_TIMEOUT_MS;
  const complete = options.complete ?? defaultCompleter;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let status: number | undefined;
  const startedAt = Date.now();

  try {
    const message = await complete(
      model,
      {
        messages: [
          {
            role: "user",
            content: MODEL_PROBE_PROMPT,
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: credentials.apiKey,
        ...(credentials.headers ? { headers: credentials.headers } : {}),
        maxTokens: MODEL_PROBE_MAX_TOKENS,
        timeoutMs,
        maxRetries: MODEL_PROBE_MAX_RETRIES,
        cacheRetention: "none",
        signal: controller.signal,
        onResponse: (response) => {
          status = response.status;
        },
      },
    );

    const latencyMs = Date.now() - startedAt;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return {
        ok: false,
        error:
          message.errorMessage ??
          (controller.signal.aborted ? "Test timed out" : "Model returned an error"),
        latencyMs,
        ...(status !== undefined ? { status } : {}),
      };
    }

    return {
      ok: true,
      latencyMs,
      ...(status !== undefined ? { status } : {}),
      responseText: getAssistantText(message).slice(0, MODEL_PROBE_RESPONSE_TEXT_LIMIT),
    };
  } finally {
    clearTimeout(timeout);
  }
}
