/**
 * 引导卡内容层粒子（ticket journey-card-transition）：纯几何/采样函数。
 *
 * 粒子目标点来自浏览器排版：Range 逐字符行盒 → canvas 绘制文字/按钮底板 →
 * 固定网格 alpha 采样。这里只保留两段确定性计算（行盒归并、位图 → 目标点），
 * DOM 测量与 canvas 绘制留在组件侧，便于 node:test 直接断言几何结果。
 */

/** 用户选定的出厂采样密度：细 = 2.6px 网格。 */
export const JOURNEY_GUIDE_PARTICLE_STEP_PX = 2.6;

/** 用户选定的出厂速度：快 = 1.35 倍（基准 760/320/560ms）。 */
export const JOURNEY_GUIDE_PARTICLE_SPEED = 1.35;

/** 旧内容消散（760ms / 1.35）。 */
export const JOURNEY_GUIDE_DISSOLVE_MS = Math.round(
  760 / JOURNEY_GUIDE_PARTICLE_SPEED,
);
/** 消散开始到新内容快照可用的等待（320ms / 1.35）。 */
export const JOURNEY_GUIDE_SWAP_MS = Math.round(
  320 / JOURNEY_GUIDE_PARTICLE_SPEED,
);
/** 新内容重聚（560ms / 1.35）。 */
export const JOURNEY_GUIDE_REFORM_MS = Math.round(
  560 / JOURNEY_GUIDE_PARTICLE_SPEED,
);
/** 重聚进行到约 90% 时实体内容开始淡入。 */
export const JOURNEY_GUIDE_REVEAL_MS = Math.round(
  JOURNEY_GUIDE_REFORM_MS * 0.9,
);
/** 实体内容淡入时长。 */
export const JOURNEY_GUIDE_CONTENT_FADE_MS = 140;
/** 退场保留窗口：覆盖粒子随机时长（≤1.0 倍）与错峰（≤60ms）。 */
export const JOURNEY_GUIDE_EXIT_MS = JOURNEY_GUIDE_DISSOLVE_MS + 100;
/** 切换时间线清理点：重聚最长 1.05 倍 + 30ms 错峰仍有余量。 */
export const JOURNEY_GUIDE_SWITCH_TOTAL_MS =
  JOURNEY_GUIDE_SWAP_MS + JOURNEY_GUIDE_REFORM_MS + 130;
/** 进入时间线清理点。 */
export const JOURNEY_GUIDE_ENTER_TOTAL_MS = JOURNEY_GUIDE_REFORM_MS + 160;

export interface JourneyGuideGlyphRect {
  char: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface JourneyGuideTextLine {
  text: string;
  left: number;
  top: number;
  height: number;
}

export interface JourneyGuideParticlePoint {
  /** 相对粒子层左上角的 CSS px。 */
  x: number;
  y: number;
  /** rgba(...) 字符串，取网格内 alpha 加权色。 */
  color: string;
  /** 粒子直径（CSS px）。 */
  size: number;
}

/**
 * 逐字符矩形按 `top` 归并成真实行盒（浏览器折行/居中由 Range 给出，不自算宽度）。
 * 调用方按文本块分别调用；容差用于吸收亚像素抖动。
 */
export function groupJourneyGuideTextLines(
  rects: readonly JourneyGuideGlyphRect[],
  topTolerance = 0.5,
): JourneyGuideTextLine[] {
  const lines: JourneyGuideTextLine[] = [];
  for (const rect of rects) {
    if (!rect.width && !rect.height) continue;
    let line = lines.find(
      (candidate) => Math.abs(candidate.top - rect.top) < topTolerance,
    );
    if (!line) {
      line = {
        text: "",
        left: rect.left,
        top: rect.top,
        height: rect.height,
      };
      lines.push(line);
    }
    line.text += rect.char;
    // 同一行按视觉左边界取行盒起点；字符顺序由 DOM 顺序给出。
    if (rect.left < line.left) line.left = rect.left;
    line.height = Math.max(line.height, rect.height);
  }
  return lines.map(({ text, left, top, height }) => ({
    text,
    left,
    top,
    height,
  }));
}

/**
 * 位图 → 粒子目标点。
 *
 * 每个 `step` CSS px 的格子取四象限 alpha；粒子落点是墨迹的加权重心（不是格子
 * 中心，否则云团整体偏右下约半格）。`data` 是 canvas 的 RGBA 像素，`widthPx`/
 * `heightPx` 是设备像素尺寸，`dpr` 用于把 CSS 坐标映射到设备像素。
 */
export function sampleJourneyGuideParticles(
  data: ArrayLike<number>,
  widthPx: number,
  heightPx: number,
  dpr: number,
  step = JOURNEY_GUIDE_PARTICLE_STEP_PX,
  alphaThreshold = 70,
): JourneyGuideParticlePoint[] {
  const points: JourneyGuideParticlePoint[] = [];
  const widthCss = widthPx / dpr;
  const heightCss = heightPx / dpr;
  const quadrants = [0.25, 0.75];
  for (let yy = 0; yy < heightCss; yy += step) {
    for (let xx = 0; xx < widthCss; xx += step) {
      let maxAlpha = 0;
      let sumAlpha = 0;
      let weightX = 0;
      let weightY = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const offsetX of quadrants) {
        for (const offsetY of quadrants) {
          const px = Math.round((xx + step * offsetX) * dpr);
          const py = Math.round((yy + step * offsetY) * dpr);
          if (px >= widthPx || py >= heightPx) continue;
          const index = (py * widthPx + px) * 4;
          const alpha = data[index + 3];
          if (alpha > maxAlpha) maxAlpha = alpha;
          if (alpha === 0) continue;
          sumAlpha += alpha;
          weightX += offsetX * alpha;
          weightY += offsetY * alpha;
          red += data[index] * alpha;
          green += data[index + 1] * alpha;
          blue += data[index + 2] * alpha;
        }
      }
      if (maxAlpha <= alphaThreshold || sumAlpha === 0) continue;
      points.push({
        x: xx + (step * weightX) / sumAlpha,
        y: yy + (step * weightY) / sumAlpha,
        color: `rgba(${Math.round(red / sumAlpha)},${Math.round(
          green / sumAlpha,
        )},${Math.round(blue / sumAlpha)},${(maxAlpha / 255).toFixed(2)})`,
        size: step * 0.98,
      });
    }
  }
  return points;
}
