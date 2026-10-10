"use client";

import { useI18n } from "@/hooks/useI18n";
import type { MemberType } from "@/lib/data/types";

export type AvatarSize = "sm" | "md" | "lg";

/** 色调板长度（`--av-0…--av-4`，colors_and_type.css）；agent ID 只散列到前四格，数字 key 可显式选择任一色格。 */
const AVATAR_TINTS = 5;
const AGENT_AVATAR_TINTS = AVATAR_TINTS - 1;

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 取色（spec D6「取色」段的落法）：人类恒 `--av-4`（色板里那格中性「你」色）；
 * agent 传稳定的 member id（FNV-1a 取模），数字序号仅表示显式色板位置，不应用作列表位置——
 * 确保同一成员在任何位置恒定同色。
 */
function avatarTint(
  colorKey: number | string | undefined,
  type: MemberType | null | undefined,
): number {
  if (type === "human") return AVATAR_TINTS - 1;
  if (typeof colorKey === "number" && Number.isFinite(colorKey)) {
    return ((Math.trunc(colorKey) % AVATAR_TINTS) + AVATAR_TINTS) % AVATAR_TINTS;
  }
  if (typeof colorKey === "string" && colorKey.length > 0) {
    return hashString(colorKey) % AGENT_AVATAR_TINTS;
  }
  return 0;
}

/** 首字：agent 名称首字符（ASCII 转大写）；名称缺失 → 占位 `?`。人类的「我」走 i18n（`avatar.you`）。 */
function initials(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0].toUpperCase();
}

/** §4.4 头像（D6）：方 tile + 首字。形态与 tint（`.avatar` / `.avatar.sm|lg` / `.av-0…av-4`）
 *  全部在 globals.css 的原语 class 块；本模块只做「成员 → 首字 / 色格」的确定性映射。 */
export function Avatar({
  name,
  type,
  size = "md",
  colorKey,
}: {
  name?: string;
  type?: MemberType | null;
  size?: AvatarSize;
  /** 取色参数：成员传稳定 member id；数字表示显式色板位置；缺省走色板首位。 */
  colorKey?: number | string;
}) {
  const { t } = useI18n();
  const tint = avatarTint(colorKey, type);
  const glyph = type === "human" ? t("avatar.you") : initials(name);
  const label = name?.trim() || (typeof colorKey === "string" ? colorKey : glyph);
  return (
    <span
      className={size === "md" ? `avatar av-${tint}` : `avatar ${size} av-${tint}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {glyph}
    </span>
  );
}
