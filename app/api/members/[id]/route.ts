import { NextResponse } from "next/server";
import { getAgent, AgentNotFoundError } from "@/lib/domain/raft";
import { deleteAgentIdentity } from "@/lib/agent-lifecycle";

// GET /api/members/[id] — 单个 agent 成员详情
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json({ agent: getAgent(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

// DELETE /api/members/[id] — 删除身份（§3.6）：历史消息保留、workspace 目录清理
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await deleteAgentIdentity(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentNotFoundError ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
