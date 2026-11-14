import { NextResponse } from "next/server";
import {
  ChannelChiefError,
  listChannelsWithMeta,
  createChannel,
  CURRENT_MEMBER_ID,
} from "@/lib/domain/collab";

export async function GET() {
  try {
    return NextResponse.json({ channels: listChannelsWithMeta(CURRENT_MEMBER_ID) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      type?: unknown;
      description?: unknown;
      memberIds?: unknown;
      chiefMemberId?: unknown;
    };
    const channel = createChannel({
      name: typeof body.name === "string" ? body.name : "",
      type: body.type === "private" ? "private" : "public",
      description: typeof body.description === "string" ? body.description : "",
      memberIds: Array.isArray(body.memberIds)
        ? body.memberIds.filter((m): m is string => typeof m === "string")
        : undefined,
      // #252 建频道时顺手指定的首席：缺省 / null ⇒ 不写绑定（回落全局）。
      // 绑定合法性（本频道未软删 agent 成员）由协作域在校验后写库，非法即整笔回滚。
      chiefMemberId: typeof body.chiefMemberId === "string" ? body.chiefMemberId : null,
    });
    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    // 非法首席（人类成员 / 软删 / 非本频道成员）走协作域的稳定拒绝语义：4xx + code。
    if (error instanceof ChannelChiefError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
