import { NextResponse } from "next/server";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  missingProbeCredentialsError,
  probeCredentialsFrom,
  probeErrorMessage,
  runModelProbe,
} from "@/lib/model-probe";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// 探测的常量与结论语义（maxTokens 16 / maxRetries 0 / 20s 超时 / ok-error-latencyMs-status）
// 只有一份实现：lib/model-probe.ts（与恢复探测共用）。本路由负责的只是输入形态：
// 「未保存的配置 + 临时 models.json」，行为与抽内核之前逐字一致。

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ ok: false, error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json(
      { ok: false, error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  let tempDir: string | undefined;

  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown; model?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ ok: false, error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ ok: false, error: "provider is required" }, { status: 400 });
    if (!isRecord(body.model)) return NextResponse.json({ ok: false, error: "model is required" }, { status: 400 });

    const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
    if (!modelId) return NextResponse.json({ ok: false, error: "Model ID is required" }, { status: 400 });

    tempDir = mkdtempSync(join(tmpdir(), "worksplice-model-test-"));
    const modelsPath = join(tempDir, "models.json");
    writeFileSync(modelsPath, JSON.stringify({
      providers: {
        [providerName]: {
          ...body.provider,
          models: [{ ...body.model, id: modelId }],
        },
      },
    }, null, 2), "utf8");

    const modelRuntime = await ModelRuntime.create({ modelsPath });
    const loadError = modelRuntime.getError();
    if (loadError) return NextResponse.json({ ok: false, error: loadError });

    const model = modelRuntime.getModel(providerName, modelId);
    if (!model) return NextResponse.json({ ok: false, error: `Model not found: ${providerName}/${modelId}` });

    const resolved = await modelRuntime.getAuth(model);
    const credentials = probeCredentialsFrom(resolved?.auth);
    if (!credentials) {
      return NextResponse.json({
        ok: false,
        error: missingProbeCredentialsError(providerName),
      });
    }

    return NextResponse.json(await runModelProbe(model, credentials));
  } catch (error) {
    return NextResponse.json({ ok: false, error: probeErrorMessage(error) }, { status: 500 });
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
