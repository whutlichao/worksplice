import { NextResponse } from "next/server";
import { sessionResetAgent, toLifecycleErrorStatus } from "@/lib/agent-lifecycle";

// POST /api/members/[id]/session-reset — Session reset（§3.6）：清会话上下文，workspace 保留
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await sessionResetAgent(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: toLifecycleErrorStatus(error) });
  }
}
