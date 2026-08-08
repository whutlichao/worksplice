import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMentionTokens,
  mentionExcludedRanges,
  composerMentionCandidates,
} from "./mention.ts";

const MEMBERS = [
  { id: "m1", name: "bob", type: "agent" },
  { id: "m2", name: "alice", type: "agent" },
  { id: "m3", name: "bob smith", type: "agent" },
  { id: "owner-id", name: "Owner", type: "human" },
];

function tokenOf(content, members, name) {
  return parseMentionTokens(content, members).find((t) => t.name === name);
}

test("parseMentionTokens finds plain @name tokens with positions and flags", () => {
  const tokens = parseMentionTokens("hey @bob and @alice!", MEMBERS);
  assert.equal(tokens.length, 2);
  const bob = tokens[0];
  assert.equal(bob.start, 4);
  assert.equal(bob.end, 8);
  assert.equal(bob.name, "bob");
  assert.equal(bob.memberId, "m1");
  assert.equal(bob.isHuman, false);
  const owner = tokenOf("ping @Owner now", MEMBERS, "Owner");
  assert.equal(owner.memberId, "owner-id");
  assert.equal(owner.isHuman, true);
});

test("parseMentionTokens matches quoted @\"name with spaces\"", () => {
  const token = tokenOf('ask @"bob smith" please', MEMBERS, "bob smith");
  assert.ok(token, "quoted mention resolved");
  assert.equal(token.start, 4);
  assert.equal(token.end, 16);
});

test("parseMentionTokens ignores unknown tokens and case-insensitively matches", () => {
  assert.equal(parseMentionTokens("@ghost @bob", MEMBERS).length, 1);
  const token = tokenOf("HI @BOB", MEMBERS, "bob");
  assert.ok(token, "case-insensitive match");
});

test("parseMentionTokens skips code fences and inline code", () => {
  const content = "before\n```\n@bob\n```\nafter";
  assert.equal(parseMentionTokens(content, MEMBERS).length, 0);
  const inline = "use `@bob` here and @alice there";
  const tokens = parseMentionTokens(inline, MEMBERS);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "alice");
});

test("mentionExcludedRanges covers fences, unclosed fences and inline spans", () => {
  const ranges = mentionExcludedRanges("a\n```js\nx\n```\nb `c` d\n~~~\nopen");
  assert.equal(ranges.length, 3);
  assert.deepEqual(parseMentionTokens("```\n@bob\n```", MEMBERS), []);
  assert.deepEqual(parseMentionTokens("`@bob`", MEMBERS), []);
});

test("composerMentionCandidates lists only channel members, in agent order", () => {
  const agents = [
    { id: "a1", name: "alice", status: "online" },
    { id: "a2", name: "bob", status: "offline" },
    { id: "a3", name: "carol", status: "working" },
  ];
  const got = composerMentionCandidates(agents, new Set(["a2", "a3"]));
  assert.deepEqual(
    got.map((m) => m.id),
    ["a2", "a3"],
    "non-members must not appear in the @ completion list",
  );
  assert.ok(got.every((m) => m.joined), "listed members are always joined");
});

test("composerMentionCandidates with no matching members returns empty list", () => {
  const agents = [{ id: "a1", name: "alice", status: "online" }];
  assert.deepEqual(composerMentionCandidates(agents, new Set()), []);
});
