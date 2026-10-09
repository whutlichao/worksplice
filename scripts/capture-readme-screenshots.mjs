#!/usr/bin/env node
/**
 * Capture the eight README screenshots (channel / task-board / agent-panel /
 * search × en + zh-CN) from a running worksplice dev server.
 *
 * Usage — two shells, both from the repo root:
 *
 *   1. seed the demo workspace into a scratch data dir and serve it:
 *
 *        export WORKSPLICE_DATA_DIR=/tmp/worksplice-screenshots/demo-data
 *        node scripts/seed-demo.mjs
 *        npx next dev -H 127.0.0.1 -p 30152
 *
 *      (never point WORKSPLICE_DATA_DIR at ~/.worksplice — the shots must come
 *      from seeded demo data, and the server must read the same scratch dir)
 *
 *   2. capture, from the repo root:
 *
 *        node scripts/capture-readme-screenshots.mjs
 *
 * Environment:
 *   WORKSPLICE_SCREENSHOT_URL  base URL of the running server
 *                              (default: http://127.0.0.1:30152)
 *   WORKSPLICE_SCREENSHOT_DIR  output directory
 *                              (default: docs/screenshots)
 *
 * Playwright is not a repo dependency; install it without touching
 * package.json:
 *
 *   npm i --no-save playwright
 *   npx playwright install chromium
 *
 * The script drives the seeded demo workspace: #stream-sync channel, the
 * Messages tab for `channel`, the Tasks tab for `task-board`, Marlow's detail
 * panel for `agent-panel`, and the "reconcil" query for `search`. Interface
 * language is set through the `worksplice-locale` localStorage key, the same
 * one the language picker writes. Re-runs frame the same content at the same
 * 1970×989 viewport; a few antialiasing edge pixels may still differ between
 * runs, so diff the framing, not the PNG bytes.
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.WORKSPLICE_SCREENSHOT_URL ?? "http://127.0.0.1:30152";
const OUT_DIR = resolve(
  process.env.WORKSPLICE_SCREENSHOT_DIR ??
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots"),
);
const VIEWPORT = { width: 1970, height: 989 };
const CHANNEL_NAME = "stream-sync";
const AGENT_NAME = "Marlow";
const SEARCH_QUERY = "reconcil";

/** UI strings the script drives; keep in sync with lib/i18n/messages/*.ts. */
const LOCALES = [
  {
    id: "en",
    suffix: "",
    tasksTab: "Tasks",
    boardView: "Board",
    searchTitle: "Search",
    searchPlaceholder: "Search messages…",
    resultsLabel: "results",
  },
  {
    id: "zh-CN",
    suffix: ".zh-CN",
    tasksTab: "任务",
    boardView: "看板",
    searchTitle: "全文搜索",
    searchPlaceholder: "搜索消息…",
    resultsLabel: "条结果",
  },
];

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail(
    "playwright is not installed. Install it without touching package.json:\n" +
      "    npm i --no-save playwright\n" +
      "    npx playwright install chromium",
  );
}

let response;
try {
  response = await fetch(`${BASE_URL}/api/channels`);
} catch (error) {
  fail(`no server at ${BASE_URL} (${error.message}). Start one with WORKSPLICE_DATA_DIR pointing at seeded demo data.`);
}
if (!response.ok) fail(`${BASE_URL}/api/channels answered ${response.status}.`);

// Deterministic rasterization: otherwise subpixel text/icon antialiasing
// flakes a handful of edge pixels between runs.
const browser = await chromium.launch({
  args: [
    "--force-color-profile=srgb",
    "--font-render-hinting=none",
    "--disable-lcd-text",
    "--disable-threaded-animation",
    "--run-all-compositor-stages-before-draw",
    "--disable-new-content-rendering-timeout",
  ],
});
await mkdir(OUT_DIR, { recursive: true });

for (const locale of LOCALES) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript((value) => {
    localStorage.setItem("worksplice-locale", value);
  }, locale.id);
  const page = await context.newPage();

  const shot = async (name) => {
    const path = `${OUT_DIR}/${name}${locale.suffix}.png`;
    // animations: "disabled" freezes the pulsing presence dots; without it a
    // handful of pixels differ between runs depending on the frame caught.
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path, animations: "disabled" });
    console.log(`  ✓ ${path}`);
  };

  console.log(`\n[${locale.id}] ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator("button.nav-row").first().waitFor({ timeout: 30_000 });

  // --- channel: #stream-sync, Messages tab, hover bar on Rune's reply ---
  await page.locator("button.nav-row", { hasText: CHANNEL_NAME }).first().click();
  const rows = page.locator(".ws-message-row");
  await rows.first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);

  // Frame the same stretch of the thread the old shots used: Quill's quote
  // reply near the top, Rune's reply hovered to expose the action bar.
  const quillRow = rows.filter({ hasText: "Quill" }).first();
  await quillRow.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
  const hoverRow = rows.filter({ hasText: "Rune" }).first();
  await hoverRow.hover();
  await page.waitForTimeout(300);
  await shot("channel");

  // --- task-board: same channel, Tasks tab, Board view ---
  await page.getByRole("tab", { name: locale.tasksTab, exact: true }).click();
  await page.getByRole("tab", { name: locale.boardView, exact: true }).click();
  await page.waitForTimeout(600);
  await shot("task-board");

  // --- agent-panel: Marlow's detail panel, opened from the sidebar ---
  // The panel fills its runtime / observability sections from three requests;
  // wait for them so the shot does not catch the "loading" placeholders.
  const panelSettled = [
    page.waitForResponse((r) => /\/observability$/.test(new URL(r.url()).pathname)),
    page.waitForResponse((r) => /\/runtime$/.test(new URL(r.url()).pathname)),
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/models"),
  ];
  await page.locator("button.nav-row", { hasText: AGENT_NAME }).first().click();
  await Promise.all(panelSettled);
  await page.waitForTimeout(400);
  await shot("agent-panel");

  // --- search: full-text query with the detail panel still open ---
  await page.getByPlaceholder(locale.searchPlaceholder).fill(SEARCH_QUERY);
  await page.getByRole("button", { name: locale.searchTitle, exact: true }).click();
  await page.getByText(locale.resultsLabel, { exact: false }).first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot("search");

  await context.close();
}

await browser.close();
console.log(`\nDone — 8 screenshots in ${OUT_DIR}\n`);
