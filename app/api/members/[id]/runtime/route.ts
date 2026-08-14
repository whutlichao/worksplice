import { NextResponse } from "next/server";
import { getAgent, setAgentRuntimeConfig, AgentNotFoundError } from "@/lib/domain/raft";
import { getAgentRuntime } from "@/lib/agent-runtime";

// GET /api/members/[id]/runtime — per-agent runtime 配置（§3.10）：
// configured = 持久化的覆盖（null = 继承全局默认）；live = 存活会话的实际状态。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = getAgent(id);

    let live: {
      model: { provider: string; modelId: string } | null;
      thinkingLevel: string | null;
    } | null = null;
    try {
      const rt = await getAgentRuntime();
      const wrapper = rt.findSession(agent);
      if (wrapper?.isAlive()) {
        const state = (await wrapper.send({ type: "get_state" })) as {
          model?: { provider: string; modelId: string } | null;
          thinkingLevel?: string;
        };
        live = {
          model: state.model ?? null,
          thinkingLevel: state.thinkingLevel ?? null,
        };
      }
    } catch {
      live = null;
    }

    return NextResponse.json({
      configured: {
        provider: agent.model_provider,
        modelId: agent.model_id,
        thinkingLevel: agent.thinking_level,
      },
      live,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentNotFoundError ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// PATCH /api/members/[id]/runtime — body: { provider?, modelId?, thinkingLevel? }
// 设置 per-agent 模型/provider/thinking 覆盖（null 清空回全局默认）。
// 存活会话立即应用（set_model / set_thinking_level），否则下次启动生效。
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = getAgent(id);
    const body = (await request.json().catch(() => ({}))) as {
      provider?: unknown;
      modelId?: unknown;
      thinkingLevel?: unknown;
    };

    // undefined = 不更新该维度；null = 清空回全局默认；空串按 null 处理。
    const provider = body.provider === undefined
      ? undefined
      : typeof body.provider === "string" && body.provider.trim()
        ? body.provider.trim()
        : null;
    const modelId = body.modelId === undefined
      ? undefined
      : typeof body.modelId === "string" && body.modelId.trim()
        ? body.modelId.trim()
        : null;
    const thinkingLevel = body.thinkingLevel === undefined
      ? undefined
      : typeof body.thinkingLevel === "string" && body.thinkingLevel.trim()
        ? body.thinkingLevel.trim()
        : null;

    // 先应用到存活会话（校验失败不持久化），再持久化覆盖配置。
    const rt = await getAgentRuntime();
    const wrapper = rt.findSession(agent);
    if (wrapper?.isAlive()) {
      if (provider !== undefined && modelId !== undefined && provider !== null && modelId !== null) {
        await wrapper.send({ type: "set_model", provider, modelId });
      }
      if (thinkingLevel !== undefined && thinkingLevel !== null) {
        await wrapper.send({ type: "set_thinking_level", level: thinkingLevel });
      }
    }

    const updated = setAgentRuntimeConfig(id, {
      modelProvider: provider,
      modelId,
      thinkingLevel,
    });
    return NextResponse.json({ agent: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentNotFoundError ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
