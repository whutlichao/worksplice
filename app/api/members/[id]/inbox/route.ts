import { NextResponse } from "next/server";
import { getAgent, AgentNotFoundError, drainAndAck, getPendingTargets } from "@/lib/domain/collab";

/**
 * GET /api/members/[id]/inbox（§5.7 inbox 路由组）：drain + ack。
 * - 带 ?targetId= 只 drain 该 target（channel 或 thread 锚点）；
 * - 不带则 drain 该 agent 已加入且有未消费消息的全部 channel。
 * 服务层语义：返回前 ack 推进 consumed_seqs 游标（§3.8）。
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    getAgent(id);
    const url = new URL(req.url);
    const targetId = url.searchParams.get("targetId");
    if (targetId) {
      return NextResponse.json({ agentId: id, drains: [drainAndAck(id, targetId)] });
    }
    const drains = getPendingTargets(id).map((target) => drainAndAck(id, target));
    return NextResponse.json({ agentId: id, drains });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof AgentNotFoundError) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
