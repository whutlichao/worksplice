import { NextResponse } from "next/server";
import { getAgent, AgentNotFoundError, listAgentTasks, buildAgentTimeline, listRoundLogs } from "@/lib/domain/collab";
import { aggregateAgentUsage } from "@/lib/session-stats";
import { resolveSessionIdByPath } from "@/lib/session-reader";
import { getAgentRuntime } from "@/lib/agent-runtime";

// GET /api/members/[id]/observability — 可观测性（spec §3.6 / §6.5 / §07）：
// ① 状态点（成员行）② token/成本（session jsonl 只读解析，按 agent 聚合，不落库）
// ③ 任务历史（该 agent 参与的任务 + 状态变更时间线）④ 会话导出与上下文状态
// ⑤ 轮次记录（round_logs：区分「自判 ignore」与「处理失败」，cap-ack 的 (capped) 标记在此可见）。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = getAgent(id);

    const [stats, sessionId] = await Promise.all([
      aggregateAgentUsage(agent),
      agent.pi_session_file
        ? resolveSessionIdByPath(agent.pi_session_file).then((sid) => sid ?? null)
        : Promise.resolve(null),
    ]);

    // 存活会话的实时上下文占用（compaction/context 可见性；未存活返回 null）
    let live: { model?: { provider: string; modelId: string } | null; thinkingLevel?: string | null; contextUsage?: unknown } | null = null;
    try {
      const rt = await getAgentRuntime();
      const wrapper = rt.findSession(agent);
      if (wrapper?.isAlive()) {
        const state = (await wrapper.send({ type: "get_state" })) as {
          model?: { provider: string; modelId: string } | null;
          thinkingLevel?: string;
          contextUsage?: { percent: number; contextWindow: number; tokens: number } | null;
        };
        live = {
          model: state.model ?? null,
          thinkingLevel: state.thinkingLevel ?? null,
          contextUsage: state.contextUsage ?? null,
        };
      }
    } catch {
      live = null; // 会话状态读取失败不阻塞可观测性面板
    }

    return NextResponse.json({
      status: agent.status,
      stats,
      tasks: listAgentTasks(agent.id),
      timeline: buildAgentTimeline(agent.id),
      rounds: listRoundLogs(agent.id),
      session: {
        file: agent.pi_session_file,
        sessionId,
        live,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentNotFoundError ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
