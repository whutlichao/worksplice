import { NextResponse } from "next/server";
import { restartAgent, toLifecycleErrorStatus } from "@/lib/agent-lifecycle";

// POST /api/members/[id]/restart — Restart（§3.6）：沿用现有 session 接着干
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await restartAgent(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: toLifecycleErrorStatus(error) });
  }
}
