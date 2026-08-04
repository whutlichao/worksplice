import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("GET /api/search reads q and returns results with snippet + openable location", async () => {
  const source = await readRoute("search/route.ts");
  assert.match(source, /searchMessages\(q, \{ limit \}\)/);
  assert.match(source, /searchParams\.get\("q"\)/);
  assert.match(source, /Search query is required/);
  assert.match(source, /status: 400/);
  assert.match(source, /searchParams\.get\("limit"\)/);
  assert.match(source, /results/);
});

test("search service clamps limit to [1, MAX_SEARCH_LIMIT]", async () => {
  const source = await readFile(new URL("../raft/search.ts", import.meta.url), "utf-8");
  assert.match(source, /MAX_SEARCH_LIMIT = 50/);
  assert.match(source, /Math\.min\(Math\.max\(1, Math\.floor\(raw\)\), MAX_SEARCH_LIMIT\)/);
});
