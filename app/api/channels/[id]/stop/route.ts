import { NextResponse } from "next/server";
import {
  stopChannelTurn,
  CURRENT_MEMBER_ID,
} from "@/lib/domain/collab";
import { jsonError } from "@/lib/domain/errors";

/**
 * POST /api/channels/[id]/stop（票 #238）：Owner 停当前房间波次。
 * 薄封装：只校验人类调用者身份并映射服务层结果；不销毁会话、不写游标、不 ack 任务事件。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(stopChannelTurn(id, CURRENT_MEMBER_ID));
  } catch (error) {
    return jsonError(error);
  }
}
