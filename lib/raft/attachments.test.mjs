import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-attachments-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel } = await import("./channels.ts");
const { sendMessage, getMessageWithAuthor, listMessages } = await import("./messages.ts");
const { MAX_ATTACHMENT_BYTES } = await import("./attachments.ts");

function freshChannel() {
  return createChannel({ name: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

function draft(fileName, data, mime = "text/plain") {
  return { fileName, mime, data: Buffer.from(data) };
}

test("sendMessage stores attachment files under the data dir and links rows to the message", () => {
  const channel = freshChannel();
  const result = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "here is a file",
    attachments: [draft("note.txt", "hello world"), draft("pic.png", Buffer.from([1, 2, 3]), "image/png")],
  });
  assert.equal(result.held, false);

  const rows = globalThis.__workspliceDb.listAttachments(result.message.id);
  assert.equal(rows.length, 2);
  const note = rows.find((a) => a.file_name === "note.txt");
  assert.ok(note);
  assert.equal(note.size_bytes, 11);
  assert.equal(note.mime, "text/plain");
  assert.ok(note.disk_path.startsWith(globalThis.__workspliceDb.paths.attachmentsDir));
  assert.ok(fs.existsSync(note.disk_path));
  assert.equal(fs.readFileSync(note.disk_path, "utf-8"), "hello world");

  const withAuthor = getMessageWithAuthor(result.message.id);
  assert.equal(withAuthor.attachments.length, 2);
});

test("messageWithAuthor attaches reactions and attachments to list rows too", () => {
  const channel = freshChannel();
  const result = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "list row",
    attachments: [draft("a.txt", "aaa")],
  });
  const page = listMessages(channel.id);
  const row = page.messages.find((m) => m.id === result.message.id);
  assert.equal(row.attachments.length, 1);
  assert.deepEqual(row.reactions, []);
});

test("attachments over 50MB are rejected and nothing is written", () => {
  const channel = freshChannel();
  const filesBefore = fs.readdirSync(globalThis.__workspliceDb.paths.attachmentsDir).length;
  assert.throws(
    () =>
      sendMessage({
        targetId: channel.id,
        authorId: OWNER_MEMBER_ID,
        content: "too big",
        attachments: [draft("big.bin", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))],
      }),
    /50 MB/i,
  );
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 0);
  assert.equal(fs.readdirSync(globalThis.__workspliceDb.paths.attachmentsDir).length, filesBefore);
});

test("held sendMessage cleans up staged attachment files", () => {
  const channel = freshChannel();
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "one" });
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "two" });

  const filesBefore = fs.readdirSync(globalThis.__workspliceDb.paths.attachmentsDir).length;
  const result = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "stale with attachment",
    baseSeq: 1,
    attachments: [draft("stale.txt", "x")],
  });
  assert.equal(result.held, true);
  assert.equal(fs.readdirSync(globalThis.__workspliceDb.paths.attachmentsDir).length, filesBefore);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 2);
});

test("empty file names are rejected; path separators are stripped from stored names", () => {
  const channel = freshChannel();
  assert.throws(
    () =>
      sendMessage({
        targetId: channel.id,
        authorId: OWNER_MEMBER_ID,
        content: "no name",
        attachments: [draft("", "data")],
      }),
    /file name/i,
  );
  const result = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "weird name",
    attachments: [draft("../evil/name.txt", "data")],
  });
  const rows = globalThis.__workspliceDb.listAttachments(result.message.id);
  assert.equal(rows[0].file_name, "name.txt");
  assert.ok(!rows[0].disk_path.includes("evil"));
});

test("message content alone still works without attachments", () => {
  const channel = freshChannel();
  const result = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "plain" });
  assert.equal(result.held, false);
  assert.equal(getMessageWithAuthor(result.message.id).attachments.length, 0);
});

test("attachment-only messages are allowed (empty content + files)", () => {
  const channel = freshChannel();
  const result = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "   ",
    attachments: [draft("only.txt", "payload")],
  });
  assert.equal(result.held, false);
  assert.equal(getMessageWithAuthor(result.message.id).attachments.length, 1);
  assert.equal(getMessageWithAuthor(result.message.id).content, "");
});
