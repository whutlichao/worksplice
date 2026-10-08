"use client";

import { useMemo } from "react";

const AVATAR_PALETTE = ["#f8a16f", "#fe7da8", "#ffd440", "#27ccf3", "#bbafe6", "#a9d877"];

export type PixelAvatarSize = 28 | 40 | 44 | 48;

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** §4.4 8×8 像素头像：seed 确定性生成左右镜像图案，image-rendering: pixelated。 */
export function PixelAvatar({
  seed,
  name,
  size = 40,
}: {
  seed: string;
  name?: string;
  size?: PixelAvatarSize;
}) {
  const hash = useMemo(() => hashString(seed), [seed]);
  const bg = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  const ink = "#141111";

  const cells: string[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      const cell = (hash >>> ((row * 4 + col) % 24)) & 1;
      const fill = cell === 0 ? ink : bg;
      cells.push(
        `<rect x="${col}" y="${row}" width="1" height="1" fill="${fill}"/>`,
        `<rect x="${7 - col}" y="${row}" width="1" height="1" fill="${fill}"/>`,
      );
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">`,
    `<rect width="8" height="8" fill="${bg}"/>`,
    ...cells,
    `<rect x="0" y="0" width="8" height="8" fill="none" stroke="${ink}" stroke-width="1"/>`,
    `</svg>`,
  ].join("");

  return (
    <div
      role="img"
      aria-label={name ?? seed}
      title={name ?? seed}
      className="pixelated"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        background: bg,
        border: `1px solid var(--border)`,
        boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.35)",
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
