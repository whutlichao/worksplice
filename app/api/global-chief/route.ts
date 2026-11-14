import { NextResponse } from "next/server";
import {
  GlobalChiefError,
  chiefRefOf,
  getGlobalChief,
  setGlobalChief,
} from "@/lib/domain/collab";

/**
 * POST /api/global-chief（票 #251）：全局首席的唯一 HTTP 写面。
 *
 * 薄封装：只校验入参形态，把「设 / 换 / 清空」交给协作域服务层（`setGlobalChief`）——
 * 「同一时刻至多一位」「目标必须是存活 agent」「`null` = 清空」全部在服务层裁决，
 * 路由不自己判、也不碰数据层。
 *
 * 拒绝语义来自服务层的 `GlobalChiefError`（`status` + `code`），与频道首席写面同一组码：
 * 不存在的 id 404 / 人类成员 400 / 已软删身份 409（§1「同语义错误跨路由必须同状态码」）。
 * 响应体形如 `{ error, code }`，面板按 code 选本地化文案、不吞服务端原因。
 *
 * 成功一律回「此刻的全局首席」（含清空后的 `null`）——调用方据此显示真实状态，
 * 不在客户端猜。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object" || !("memberId" in body)) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }
    const memberId = (body as { memberId: unknown }).memberId;
    if (memberId !== null && (typeof memberId !== "string" || memberId.trim() === "")) {
      return NextResponse.json(
        { error: "memberId must be a non-empty string or null" },
        { status: 400 },
      );
    }

    setGlobalChief(memberId);

    return NextResponse.json({ chief: chiefRefOf(getGlobalChief()) });
  } catch (error) {
    if (error instanceof GlobalChiefError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
