import type { TranslationParams } from "@/lib/i18n/types";

/**
 * 首席写入失败的**唯一码 → 文案映射**（票 #248–#252 的三条写面：`POST /api/channels`、
 * `POST /api/channels/[id]/chief`、`POST /api/global-chief` 回同一组 `code`）。
 *
 * 消费方共两处，必须共用这一份：频道设置的写入（`ChannelView`）与建频道弹窗
 * （`CreateChannelModal`，首席是建频道时顺手指定的）。此前弹窗按 `code` 前缀猜
 * （`startsWith("member")`），漏了 `not_channel_member` / `channel_not_found` 的本地化。
 *
 * 纯数据 + 纯函数（只 import 类型）：两处都在浏览器里跑，不能把服务端模块拉进客户端包。
 * 表的键与协作域的 `ChannelChiefErrorCode` / `GlobalChiefErrorCode` 同集，服务层新增码时
 * 这里编译期就会报错。
 */

/** 首席写入的全部拒绝码（与协作域的错误码并集一致）。 */
export const CHIEF_FAILURE_KEYS = {
  channel_not_found: "chief.failChannelNotFound",
  owner_only: "chief.failOwnerOnly",
  member_not_found: "chief.failMemberNotFound",
  human_member: "chief.failHumanMember",
  member_deleted: "chief.failMemberDeleted",
  not_channel_member: "chief.failNotChannelMember",
} as const;

export type ChiefFailureCode = keyof typeof CHIEF_FAILURE_KEYS;

/** 这个 `code` 是否属于首席写入的拒绝码（调用方据此决定是否追加「首席选择无效」前缀）。 */
export function isChiefFailureCode(code: string | undefined): code is ChiefFailureCode {
  return code !== undefined && Object.hasOwn(CHIEF_FAILURE_KEYS, code);
}

/** 拒绝码 → 本地化文案；未知码 / 缺码时退回服务端消息（不吞原因）。 */
export function chiefFailureText(
  t: (key: string, params?: TranslationParams) => string,
  code: string | undefined,
  fallback: string,
): string {
  return isChiefFailureCode(code) ? t(CHIEF_FAILURE_KEYS[code]) : fallback;
}
