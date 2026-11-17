import { NextResponse } from "next/server";
import { restartAgent, toLifecycleErrorStatus } from "@/lib/agent-lifecycle";
import { jsonError } from "@/lib/domain/errors";

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
    return jsonError(error, toLifecycleErrorStatus(error));
  }
}
