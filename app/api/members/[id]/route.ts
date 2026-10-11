import { NextResponse } from "next/server";
import {
  getAgent,
  setAgentAvatarTint,
  AgentNotFoundError,
} from "@/lib/domain/collab";
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

// PATCH /api/members/[id] — body: { avatarTint: 0 | 1 | 2 | 3 | null }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: unknown = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Object.hasOwn(body, "avatarTint")
    ) {
      return NextResponse.json({ error: "avatarTint is required" }, { status: 400 });
    }
    const agent = setAgentAvatarTint(id, (body as { avatarTint: unknown }).avatarTint);
    return NextResponse.json({ agent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentNotFoundError ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
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
