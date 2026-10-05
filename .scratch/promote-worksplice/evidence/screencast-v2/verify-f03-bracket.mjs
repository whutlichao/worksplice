#!/usr/bin/env node
/**
 * verify-f03-bracket.mjs — pixel proof that Frame 3's crop bracket lands on the board's
 * real columns and that the mono chip under it names the column the bracket is on.
 *
 * Background. F3 draws a DOM bracket (`.f03-crop`) over a real capture of the demo task
 * board and steps it across five columns. Two defects were fixed here:
 *   1. the step offsets ran negative, walking the bracket off the board's left edge;
 *   2. the chip's ticker scrolled one row ahead of the bracket (label ≠ column).
 * This script re-derives both facts from the rendered pixels — it never trusts the
 * composition's own JS for the answer.
 *
 * What it measures, per step hold point:
 *   · the bracket's left and right border columns, from a full-height vertical ink run
 *     that starts at the bracket's top edge (so board column rules and card borders,
 *     which are 1–2px and start below it, are rejected);
 *   · the six board column rules (independent re-measurement of the target columns);
 *   · the chip's ticker window — the 184x22 mono strip — matched against five label
 *     bitmaps rendered independently in the same browser + brand font, so the chip's text
 *     is *read*, not assumed.
 *
 * Usage:
 *   node verify-f03-bracket.mjs                                  # renders/worksplice-90s-v2.mp4
 *   node verify-f03-bracket.mjs --video renders/other.mp4
 *   node verify-f03-bracket.mjs --from-snapshots <dir>            # hyperframes snapshot PNGs
 *   node verify-f03-bracket.mjs --json <path>                     # also write machine output
 *
 * Exit code 0 = every hold point passed; 1 = at least one assertion failed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ── the board's five real columns, measured on the rendered plate (see STORYBOARD.md):
      left edges 429 / 615 / 801 / 987 / 1173, column width 186px, pitch 186.7px ── */
const COL_LEFT = [429, 615, 801, 987, 1173];
const COL_WIDTH = 186;
const COL_TITLE = ["Pool", "In progress", "In review", "Done", "Closed"];

/* F3's bracket choreography (frame-local seconds): four stops of 0.34s, starting at
   STEP_T; the bracket fades out at 7.84. Holds are the settled gaps between stops. */
const STEP_T = [5.46, 6.02, 6.58, 7.14];
const MOVE_S = 0.34;
const FADE_OUT_S = 7.84;

/* bracket geometry (frame-local px), used to locate the chip's ticker window */
const CROP_SEAT_X = 418; // .f03-crop { left: 418px }
const CROP_SEAT_Y = 292; // .f03-crop { top: 292px }
const CROP_BORDER = 4; // .f03-crop { border: 4px solid }
const CHIP_TOP_REL = 452; // .f03-chip { top: 452px }  (from the crop's padding box)
const CHIP_H = 40;
const CHIP_PAD_L = 12; // .f03-chip { padding: 0 14px 0 12px }
const DOT_W = 12;
const CHIP_GAP = 10;
const TICKER_W = 184;
const TICKER_H = 22;

const TOLERANCE_PX = 4;
const PLATE_LEFT = 240; // .f03-plate { left: 240px } — the bracket must stay on the board

const W = 1920;
const H = 1080;

/* ────────────────────────────────── CLI ────────────────────────────────── */
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const VIDEO = resolve(HERE, argOf("--video", "renders/worksplice-90s-v2.mp4"));
const SNAPSHOTS = argOf("--from-snapshots", "");
const JSON_OUT = argOf("--json", "");

/* ─────────────────────────── frame acquisition ─────────────────────────── */
const toRaw = (args) =>
  execFileSync("ffmpeg", args, { maxBuffer: 96 * 1024 * 1024 });

function frameFromVideo(video, t) {
  return toRaw([
    "-v", "error",
    "-ss", t.toFixed(3),
    "-i", video,
    "-frames:v", "1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
}

const snapshotCache = new Map();
function frameFromSnapshotDir(dir, t) {
  if (!snapshotCache.size) {
    for (const f of readdirSync(dir)) {
      const m = f.match(/^frame-\d+-at-([\d.]+)s\.png$/);
      if (m) snapshotCache.set(Number(m[1]), join(dir, f));
    }
  }
  const times = [...snapshotCache.keys()];
  if (!times.length) throw new Error(`no frame-NN-at-<t>s.png files in ${dir}`);
  const best = times.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
  const file = snapshotCache.get(best);
  return toRaw(["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
}

if (!SNAPSHOTS && !existsSync(VIDEO)) {
  console.error(`video not found: ${VIDEO}\n(run the render first, or pass --from-snapshots <dir>)`);
  process.exit(1);
}
const frameAt = (t) =>
  SNAPSHOTS ? frameFromSnapshotDir(resolve(HERE, SNAPSHOTS), t) : frameFromVideo(VIDEO, t);

/* ─────────────────────────────── pixel helpers ─────────────────────────────── */
const at = (buf, x, y) => {
  const i = (y * W + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
};
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const isInk = (c) => lum(c) < 110 && Math.max(...c) - Math.min(...c) < 60;
const isBright = (c) => lum(c) > 120;

/* ── the bracket's vertical borders, and the board's column rules ── */
function bracketBorders(buf) {
  /* A bracket border is a ~4px-wide ink column that already has ink at the bracket's top
     edge (y=300) and keeps it down to y=730. Board column rules are 1px and start at
     y≈330; card borders are short. Both are rejected on width and on the top-edge test.
     The scan stops at x=1670: the plate's own 7px frame border (1673–1680) and its hard
     offset shadow sit past it, and the bracket's rightmost seat is 1359. */
  const top = 300;
  const y0 = 296;
  const y1 = 736;
  const cols = [];
  for (let x = 200; x <= 1670; x++) {
    if (!isInk(at(buf, x, top))) continue;
    let ink = 0;
    for (let y = y0; y <= y1; y++) if (isInk(at(buf, x, y))) ink++;
    if (ink >= (y1 - y0) * 0.9) cols.push(x);
  }
  const runs = [];
  for (const x of cols) {
    const last = runs[runs.length - 1];
    if (last && x === last[1] + 1) last[1] = x;
    else runs.push([x, x]);
  }
  /* drop the plate's own 7px frame border on the left */
  const plateBorders = [[238, 249]];
  return runs.filter(([a, b]) => {
    const width = b - a + 1;
    const onPlate = plateBorders.some(([p, q]) => a <= q && b >= p);
    return !onPlate && width >= 3 && width <= 8;
  });
}

function columnRules(buf) {
  /* the coordinator's method: scan a vertical guide line over y in [330, 780] */
  const y0 = 330;
  const y1 = 780;
  const need = Math.round((y1 - y0 + 1) * 0.7);
  const hits = [];
  for (let x = 250; x <= 1660; x++) {
    let ink = 0;
    for (let y = y0; y <= y1; y++) if (isInk(at(buf, x, y))) ink++;
    if (ink >= need) hits.push(x);
  }
  const runs = [];
  for (const x of hits) {
    const last = runs[runs.length - 1];
    if (last && x <= last[1] + 1) last[1] = x;
    else runs.push([x, x]);
  }
  /* collapse each run to its centre, then merge centres a few px apart (they are one rule) */
  const centres = runs.map(([a, b]) => Math.round((a + b) / 2));
  return centres.filter((c, i) => i === 0 || c - centres[i - 1] > 6);
}

/* ── the chip's ticker window, and reading the label out of it ── */
function tickerRect(boxLeft) {
  const chipLeft = boxLeft; // .f03-chip { left: -4px } inside a 4px border == the box edge
  const tickerLeft = chipLeft + CHIP_PAD_L + DOT_W + CHIP_GAP;
  const tickerTop = CROP_SEAT_Y + CROP_BORDER + CHIP_TOP_REL + (CHIP_H - TICKER_H) / 2;
  return { x: tickerLeft, y: Math.round(tickerTop), w: TICKER_W, h: TICKER_H };
}

function brightMask(buf, rect) {
  const m = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      m[y * rect.w + x] = isBright(at(buf, rect.x + x, rect.y + y)) ? 1 : 0;
    }
  }
  return m;
}
const maskIoU = (a, b) => {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] | b[i]) union++;
    if (a[i] & b[i]) inter++;
  }
  return union ? inter / union : 0;
};
function glyphBands(mask, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += mask[y * w + x];
    rows.push(n);
  }
  const bands = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && rows[y] > 0;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      bands.push([start, y - 1]);
      start = -1;
    }
  }
  return bands;
}

/* ── independent label references: same browser, same brand font, same metrics ── */
function referenceMasks() {
  const fontFile = join(HERE, "assets/fonts/fc727f226c737876-s.p.woff2");
  if (!existsSync(fontFile)) throw new Error(`brand mono font not found: ${fontFile}`);
  const dir = mkdtempSync(join(tmpdir(), "f03-labels-"));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Space Mono"; font-style: normal; font-weight: 400;
  src: url("file://${fontFile}") format("woff2"); }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #141111; width: ${TICKER_W}px; }
.col { width: ${TICKER_W}px; height: ${TICKER_H}px; line-height: ${TICKER_H}px;
  font-family: "Space Mono", monospace; font-size: 18px; letter-spacing: 0.06em;
  text-transform: uppercase; white-space: nowrap; color: #FFFAEF; }
</style></head><body>
${COL_TITLE.map((t) => `<div class="col">${t}</div>`).join("")}
</body></html>`;
  const htmlPath = join(dir, "ref.html");
  const pngPath = join(dir, "ref.png");
  writeFileSync(htmlPath, html);
  const chrome =
    process.env.HYPERFRAMES_BROWSER_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(chrome)) throw new Error(`Chrome not found: ${chrome}`);
  execFileSync(chrome, [
    "--headless", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${TICKER_W},${TICKER_H * COL_TITLE.length}`,
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ], { stdio: "ignore" });
  const raw = toRaw(["-v", "error", "-i", pngPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const rw = TICKER_W;
  return COL_TITLE.map((title, i) => {
    const m = new Uint8Array(TICKER_W * TICKER_H);
    for (let y = 0; y < TICKER_H; y++) {
      for (let x = 0; x < TICKER_W; x++) {
        const j = ((i * TICKER_H + y) * rw + x) * 3;
        m[y * TICKER_W + x] = isBright([raw[j], raw[j + 1], raw[j + 2]]) ? 1 : 0;
      }
    }
    return { title, mask: m };
  });
}

/* ─────────────────────────── the frame's own start ─────────────────────────── */
function frameStart() {
  const index = join(HERE, "index.html");
  if (!existsSync(index)) return 12; // F3's slot in the assembled 90s master
  const src = readFileSync(index, "utf8");
  const el = src.match(
    /<div[^>]*data-composition-src="compositions\/frames\/03-the-room\.html"[^>]*>/,
  );
  const m = el && el[0].match(/data-start="([\d.]+)"/);
  return m ? Number(m[1]) : 12;
}

/* ──────────────────────────────── the check ──────────────────────────────── */
const OFFSET = frameStart();
const holds = [];
for (let i = 0; i < STEP_T.length; i++) {
  const nextStart = i + 1 < STEP_T.length ? STEP_T[i + 1] : FADE_OUT_S;
  const settle = STEP_T[i] + MOVE_S;
  const end = Math.min(nextStart, FADE_OUT_S);
  if (settle >= end) continue;
  const mid = (settle + end) / 2;
  holds.push({
    step: i,
    column: COL_TITLE[i],
    targetLeft: COL_LEFT[i],
    targetRight: COL_LEFT[i] + COL_WIDTH,
    window: [OFFSET + settle, OFFSET + end],
    samples: [settle + 0.02, mid, end - 0.02].map((s) => OFFSET + s),
    at: OFFSET + mid,
  });
}

const refs = referenceMasks();
const report = { video: SNAPSHOTS ? `snapshots:${SNAPSHOTS}` : VIDEO, frameStart: OFFSET, steps: [] };
let failures = 0;

console.log(`source          : ${SNAPSHOTS ? SNAPSHOTS : VIDEO}`);
console.log(`F3 frame start  : ${OFFSET}s (from index.html)`);
console.log(`board columns   : ${COL_LEFT.join(" / ")}  (+${COL_WIDTH}px each)`);
console.log(`tolerance       : ±${TOLERANCE_PX}px   plate left: ${PLATE_LEFT}px`);
console.log("");

const labels = ["step", "column", "target L/R", "box L/R", "ΔL", "ΔR", "chip text", "IoU", "2nd", "column rules", "verdict"];
const rows = [];

for (const hold of holds) {
  const stepFailures = [];
  const frames = hold.samples.map((t) => ({ t, buf: frameAt(t) }));
  const midFrame = frames[Math.floor(frames.length / 2)];

  /* the six real column rules, re-measured on this very frame */
  const rules = columnRules(midFrame.buf);

  const measures = frames.map(({ t, buf }) => {
    const borders = bracketBorders(buf);
    const left = borders.length ? borders[0][0] : null;
    const right = borders.length ? borders[borders.length - 1][1] : null;
    return { t, borders: borders.length, left, right };
  });

  const mid = measures[Math.floor(measures.length / 2)];
  const midBuf = midFrame.buf;

  /* every sample in the hold window must agree, so a border that lands mid-move fails */
  for (const m of measures) {
    if (m.borders !== 2) stepFailures.push(`t=${m.t.toFixed(2)}s: found ${m.borders} bracket borders, expected 2`);
    if (m.left === null) continue;
    if (Math.abs(m.left - hold.targetLeft) > TOLERANCE_PX)
      stepFailures.push(`t=${m.t.toFixed(2)}s: left ${m.left} vs ${hold.targetLeft} (±${TOLERANCE_PX})`);
    if (Math.abs(m.right - hold.targetRight) > TOLERANCE_PX)
      stepFailures.push(`t=${m.t.toFixed(2)}s: right ${m.right} vs ${hold.targetRight} (±${TOLERANCE_PX})`);
    if (m.left < PLATE_LEFT) stepFailures.push(`t=${m.t.toFixed(2)}s: left ${m.left} left of the plate (${PLATE_LEFT})`);
  }

  /* read the chip: the settled ticker shows exactly one label, matched against five refs */
  let chip = { title: "?", iou: 0, runnerUp: 0, bands: 0 };
  if (mid.left !== null) {
    const rect = tickerRect(mid.left);
    const mask = brightMask(midBuf, rect);
    chip.bands = glyphBands(mask, rect.w, rect.h).length;
    const scored = refs
      .map((r) => ({ title: r.title, iou: maskIoU(mask, r.mask) }))
      .sort((a, b) => b.iou - a.iou);
    chip = { ...chip, title: scored[0].title, iou: scored[0].iou, runnerUp: scored[1].iou };
    if (chip.bands !== 1)
      stepFailures.push(`ticker shows ${chip.bands} glyph bands (a rest holds exactly 1) — the label is mid-scroll`);
    if (chip.title !== hold.column)
      stepFailures.push(`chip reads "${chip.title}" but the bracket is on ${hold.column}`);
    if (!(chip.iou >= 0.55 && chip.iou - chip.runnerUp >= 0.15))
      stepFailures.push(`chip text match too weak: IoU ${chip.iou.toFixed(3)} vs next ${chip.runnerUp.toFixed(3)}`);
  }

  const verdict = stepFailures.length ? "FAIL" : "PASS";
  if (stepFailures.length) failures++;
  console.log(
    `board rules on this frame: ${rules.join(" / ")}`,
  );
  const ruleHits = COL_LEFT.map((L) => {
    const near = rules.filter((r) => Math.abs(r - L) <= TOLERANCE_PX);
    return near.length ? `${L}\u2713` : `${L}\u2717`;
  }).join(" ");
  rows.push([
    String(hold.step),
    hold.column,
    `${hold.targetLeft}/${hold.targetRight}`,
    `${mid.left}/${mid.right}`,
    mid.left === null ? "" : String(mid.left - hold.targetLeft),
    mid.right === null ? "" : String(mid.right - hold.targetRight),
    `"${chip.title}"`,
    chip.iou.toFixed(2),
    chip.runnerUp.toFixed(2),
    ruleHits,
    verdict,
  ]);
  report.steps.push({ ...hold, measured: measures, rules, ruleHits, chip, failures: stepFailures, verdict });
  for (const f of stepFailures) console.log(`   ! ${f}`);
}

console.log("");
console.log(`hold points (samples at ${holds.map((h) => h.samples.map((s) => s.toFixed(2)).join(",")).join(" | ")})`);
const widths = labels.map((l, c) => Math.max(l.length, ...rows.map((r) => r[c].length)));
console.log(labels.map((l, c) => l.padEnd(widths[c])).join("  "));
for (const r of rows) console.log(r.map((v, c) => v.padEnd(widths[c])).join("  "));
console.log("");
console.log(failures ? `FAIL — ${failures} step(s) out of tolerance` : `PASS — ${rows.length}/${rows.length} steps on their column, chip text matches`);

if (JSON_OUT) {
  writeFileSync(resolve(HERE, JSON_OUT), JSON.stringify(report, null, 2) + "\n");
  console.log(`wrote ${JSON_OUT}`);
}
process.exit(failures ? 1 : 0);
