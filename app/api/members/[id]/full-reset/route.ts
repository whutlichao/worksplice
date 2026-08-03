import { NextResponse } from "next/server";
import { fullResetAgent, toLifecycleErrorStatus } from "@/lib/agent-lifecycle";

// POST /api/members/[id]/full-reset — Full reset（§3.6）：会话 + workspace 全清（目录保留）
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await fullResetAgent(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: toLifecycleErrorStatus(error) });
  }
}
