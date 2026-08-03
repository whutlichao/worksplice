import { NextResponse } from "next/server";
import { changeAgentWorkspace, toLifecycleErrorStatus } from "@/lib/agent-lifecycle";

// POST /api/members/[id]/workspace  body: { workspacePath: string }
// 更换绑定目录（§3.6 workspace 区，DirectoryPicker 入口）；
// 换目录即换会话：旧 cwd 上的会话先销毁，pi_session_file 一并清空。
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { workspacePath?: unknown };
    if (typeof body.workspacePath !== "string" || !body.workspacePath.trim()) {
      return NextResponse.json({ error: "workspacePath is required" }, { status: 400 });
    }
    const agent = await changeAgentWorkspace(id, body.workspacePath);
    return NextResponse.json({ agent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: toLifecycleErrorStatus(error) });
  }
}
