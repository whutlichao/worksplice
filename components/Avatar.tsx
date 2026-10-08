"use client";

import type { MemberType } from "@/lib/data/types";

export type AvatarSize = "sm" | "md" | "lg";

/** 色调板长度（`--av-0…--av-4`，colors_and_type.css）。 */
const AVATAR_TINTS = 5;

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
 * 有列表序号传序号（上游 `av(i)` 的确定性映射），无序号传 member id（FNV-1a 取模）——
 * 「同一成员在任何位置恒定同色」的意图保住，序号只是可选手段。
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
    return hashString(colorKey) % AVATAR_TINTS;
  }
  return 0;
}

/** 首字：人类「我」；agent 名称首字符（ASCII 转大写）；名称缺失 → 占位 `?`。 */
function initials(name: string | undefined, type: MemberType | null | undefined): string {
  if (type === "human") return "我";
  const trimmed = name?.trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0].toUpperCase();
}

/** §4.4 头像（D6）：方 tile + 首字。形态在 globals.css 的 `.avatar` class 块；
 *  底色 = `--av-0…--av-4`，由上面的纯函数确定性取。 */
export function Avatar({
  name,
  type,
  size = "md",
  colorKey,
}: {
  name?: string;
  type?: MemberType | null;
  size?: AvatarSize;
  /** 取色参数：列表内传序号，否则传 member id；缺省走色板首位。 */
  colorKey?: number | string;
}) {
  const tint = avatarTint(colorKey, type);
  const glyph = initials(name, type);
  const label = name?.trim() || (typeof colorKey === "string" ? colorKey : glyph);
  return (
    <span
      className={size === "md" ? "avatar" : `avatar ${size}`}
      style={{ background: `var(--av-${tint})` }}
      role="img"
      aria-label={label}
      title={label}
    >
      {glyph}
    </span>
  );
}
