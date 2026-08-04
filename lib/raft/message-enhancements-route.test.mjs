import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/messages accepts multipart files and keeps the JSON path working (§3.5)", async () => {
  const source = await readRoute("messages/route.ts");
  assert.match(source, /multipart\/form-data/);
  assert.match(source, /formData\(\)/);
  assert.match(source, /files/);
  assert.match(source, /sendMessage\(/);
  assert.match(source, /attachments/);
  assert.match(source, /status: 409/);
});

test("reaction route exposes GET summaries and POST toggle", async () => {
  const source = await readRoute("messages/[id]/reactions/route.ts");
  assert.match(source, /listReactionSummaries\(/);
  assert.match(source, /toggleReaction\(/);
  assert.match(source, /CURRENT_MEMBER_ID/);
});

test("attachment download route streams the stored file with a safe filename", async () => {
  const source = await readRoute("attachments/[id]/route.ts");
  assert.match(source, /getAttachmentRow\(/);
  assert.match(source, /Content-Disposition/);
  assert.match(source, /status: 404/);
  assert.match(source, /disk_path/);
});

test("channel pinned route: GET list with sort, POST pin, DELETE unpin", async () => {
  const source = await readRoute("channels/[id]/pinned/route.ts");
  assert.match(source, /listPinned\(/);
  assert.match(source, /pinMessage\(/);
  assert.match(source, /unpinMessage\(/);
  assert.match(source, /CURRENT_MEMBER_ID/);
  assert.match(source, /sort/);
  assert.match(source, /messageId is required/);
});

test("pinned reorder route rewrites manual order", async () => {
  const source = await readRoute("channels/[id]/pinned/reorder/route.ts");
  assert.match(source, /setPinnedOrder\(/);
  assert.match(source, /Array\.isArray\(body\.order\)/);
});
