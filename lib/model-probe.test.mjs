import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * 探测内核（`lib/model-probe.ts`）的单测：结论映射 / 凭证判据 / 常量，
 * 以及「模型配置面板改用它复用内核后，请求形态与结论语义逐字一致」的源码级证据。
 * 无网络、无凭证：最小调用由注入的 fake completer 承担。
 */

const {
  MODEL_PROBE_MAX_RETRIES,
  MODEL_PROBE_MAX_TOKENS,
  MODEL_PROBE_PROMPT,
  MODEL_PROBE_RESPONSE_TEXT_LIMIT,
  MODEL_PROBE_TIMEOUT_MS,
  missingProbeCredentialsError,
  probeCredentialsFrom,
  runModelProbe,
} = await import("./model-probe.ts");

const FAKE_MODEL = { provider: "probe-local", id: "probe-alpha" };

function makeCompleter(handler) {
  const calls = [];
  return {
    calls,
    complete: async (model, context, options) => {
      calls.push({ model, context, options });
      options.onResponse?.({ status: 200 });
      return handler({ model, context, options });
    },
  };
}

function okMessage(text = "OK") {
  return { stopReason: "end", content: [{ type: "text", text }] };
}

test("runModelProbe maps a successful completion to ok with latency, status and text", async () => {
  const { complete, calls } = makeCompleter(() => okMessage("OK"));
  const verdict = await runModelProbe(FAKE_MODEL, { apiKey: "test-key" }, { complete });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.status, 200);
  assert.equal(verdict.responseText, "OK");
  assert.ok(typeof verdict.latencyMs === "number" && verdict.latencyMs >= 0);
  assert.equal(verdict.error, undefined);

  // 请求形态与面板一致：同一份常量（maxTokens 16 / maxRetries 0 / 20s / 最小 prompt）
  const { options } = calls[0];
  assert.equal(options.apiKey, "test-key");
  assert.equal(options.maxTokens, 16);
  assert.equal(options.maxRetries, 0);
  assert.equal(options.cacheRetention, "none");
  assert.equal(options.timeoutMs, 20_000);
  assert.equal(options.signal instanceof AbortSignal, true);
  assert.equal(calls[0].context.messages.at(-1).content, "Reply with OK only.");
});

test("runModelProbe truncates the response text and maps a stopReason error", async () => {
  const long = makeCompleter(() => okMessage("x".repeat(400)));
  const truncated = await runModelProbe(FAKE_MODEL, { apiKey: "k" }, { complete: long.complete });
  assert.equal(truncated.responseText.length, 300);

  const failed = makeCompleter(() => ({ stopReason: "error", errorMessage: "quota exceeded", content: [] }));
  const verdict = await runModelProbe(FAKE_MODEL, { apiKey: "k" }, { complete: failed.complete });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.error, "quota exceeded");
  assert.equal(verdict.latencyMs >= 0, true);
});

test("runModelProbe reports a stopped call and the aborted-controller timeout text", async () => {
  const stopped = makeCompleter(() => ({ stopReason: "aborted", content: [] }));
  const verdict = await runModelProbe(FAKE_MODEL, { apiKey: "k" }, { complete: stopped.complete });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.error, "Model returned an error");

  // 真正的超时：completer 一直不返回，直到内核的控制器中止（signal.aborted 由内核置位）
  const hanging = makeCompleter(
    ({ options }) =>
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve({ stopReason: "aborted", content: [] }));
      }),
  );
  const timedOut = await runModelProbe(
    FAKE_MODEL,
    { apiKey: "k" },
    { complete: hanging.complete, timeoutMs: 10 },
  );
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error, "Test timed out");
});

test("runModelProbe propagates a rejecting completer instead of inventing a verdict", async () => {
  // 内核不吞错：调用点各自 fail-closed（面板路由 → 500；恢复探测 → ok:false 且状态点不动）
  await assert.rejects(
    () =>
      runModelProbe(
        FAKE_MODEL,
        { apiKey: "k" },
        {
          complete: async () => {
            throw new Error("transport exploded");
          },
        },
      ),
    /transport exploded/,
  );
});

test("probeCredentialsFrom requires a non-empty api key and forwards headers", () => {
  assert.equal(probeCredentialsFrom(undefined), null);
  assert.equal(probeCredentialsFrom(null), null);
  assert.equal(probeCredentialsFrom({}), null);
  assert.equal(probeCredentialsFrom({ apiKey: "" }), null);
  assert.deepEqual(probeCredentialsFrom({ apiKey: "k" }), { apiKey: "k" });
  assert.deepEqual(probeCredentialsFrom({ apiKey: "k", headers: { a: "b" } }), {
    apiKey: "k",
    headers: { a: "b" },
  });
  assert.equal(missingProbeCredentialsError("probe-local"), 'No API key found for "probe-local"');
});

test("probe constants keep the model config panel's frozen semantics", () => {
  assert.equal(MODEL_PROBE_TIMEOUT_MS, 20_000);
  assert.equal(MODEL_PROBE_MAX_TOKENS, 16);
  assert.equal(MODEL_PROBE_MAX_RETRIES, 0);
  assert.equal(MODEL_PROBE_PROMPT, "Reply with OK only.");
  assert.equal(MODEL_PROBE_RESPONSE_TEXT_LIMIT, 300);
});

test("the model config test route reuses the kernel and keeps its request shape", async () => {
  const source = await readFile(
    new URL("../app/api/models-config/test/route.ts", import.meta.url),
    "utf-8",
  );

  // 共用内核：结论映射只有一份实现，路由不再内联 completeSimple
  assert.match(source, /runModelProbe\(/);
  assert.match(source, /probeCredentialsFrom\(/);
  assert.doesNotMatch(source, /completeSimple\(/);
  assert.doesNotMatch(source, /stopReason/);

  // 请求形态逐字不变：临时 models.json + 既有校验与错误码
  assert.match(source, /mkdtempSync\(/);
  assert.match(source, /models\.json/);
  assert.match(source, /providerName is required/);
  assert.match(source, /provider is required/);
  assert.match(source, /model is required/);
  assert.match(source, /Model ID is required/);
  assert.match(source, /Model not found: /);
  assert.match(source, /status: 403/);
  assert.match(source, /status: 415/);
  assert.match(source, /status: 400/);

  // 结论语义直通内核返回值（同一份 ok/error/latencyMs/status/responseText）
  assert.match(source, /NextResponse\.json\(\s*(?:await\s+)?runModelProbe\(/);
});
