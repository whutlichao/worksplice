import { NextResponse } from "next/server";
import {
  AgentNotFoundError,
  createDirectChannel,
  CURRENT_MEMBER_ID,
  getAgent,
  listChannelsWithMeta,
} from "@/lib/domain/collab";

// POST /api/members/[id]/dm — 懒创建入口：幂等建/取该 agent 的一对一 DM。
// 薄封装：业务规则（幂等、成员定死、软删拦截）全在服务层 createDirectChannel/getAgent，
// route 只做 404 门禁 + 返回 { channel, hasMessages } 供 AppShell 合并与按钮文案判定。
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // 软删/不存在/非 agent → AgentNotFoundError → 404（createDirectChannel 对软删
    // agent 会复用已归档 DM，route 层先用 getAgent 拦掉软删）。
    getAgent(id);
    const channel = createDirectChannel(id);
    const meta = listChannelsWithMeta(CURRENT_MEMBER_ID).find(
      (c) => c.id === channel.id,
    );
    if (!meta) {
      throw new Error(`DM channel not found after create: ${channel.id}`);
    }
    return NextResponse.json({
      channel: meta,
      hasMessages: meta.messageCount > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AgentNotFoundError ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
