import { NextResponse } from "next/server";
import { getAgent, AgentNotFoundError } from "@/lib/domain/collab";
import { getAgentRuntime } from "@/lib/agent-runtime";
import { saveAgentRuntime } from "@/lib/agent-recovery";

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
        // get_state 的 model 是 {id, provider}（lib/rpc/session.ts），面板要 {provider, modelId}
        // ——与 app/api/agent/new/route.ts 同款映射（D3：曾直接透传，面板显示 "new-api/—"）。
        const state = (await wrapper.send({ type: "get_state" })) as {
          model?: { id: string; provider: string } | null;
          thinkingLevel?: string;
        };
        live = {
          model: state.model
            ? { provider: state.model.provider, modelId: state.model.id }
            : null,
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
//
// 出错状态点的恢复路径（票据 02）：保存后存在具体覆盖对、且保存前该成员处于 error 时，
// 服务层对刚保存的模型做一次最小连通性探测并按其结论收敛状态点——探测不落会话、
// 不进会话历史、不唤醒 agent-loop、不写 round_logs；结论（含失败原因）只随本次响应返回。
// 判定、串行与发布全部在 lib/agent-recovery.ts（本路由不内联任何探测逻辑）。
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      provider?: unknown;
      modelId?: unknown;
      thinkingLevel?: unknown;
    };

    const result = await saveAgentRuntime(id, {
      provider: body.provider,
      modelId: body.modelId,
      thinkingLevel: body.thinkingLevel,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentNotFoundError ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
