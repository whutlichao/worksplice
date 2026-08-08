import assert from "node:assert/strict";
import test from "node:test";
import {
  hasLiveSusan,
  liveSusanMemberId,
  precheckSusanForPrivateChannel,
  resolveBootstrapModel,
} from "./secretary-bootstrap.ts";

test("hasLiveSusan: true only for a live agent named Susan", () => {
  assert.equal(hasLiveSusan([]), false);
  assert.equal(hasLiveSusan([{ name: "bob", type: "agent" }]), false);
  assert.equal(hasLiveSusan([{ name: "susan", type: "agent" }]), false, "name match is exact");
  assert.equal(
    hasLiveSusan([{ name: "Susan", type: "human" }]),
    false,
    "human owner named Susan is not a secretary",
  );
  assert.equal(hasLiveSusan([{ name: "Susan", type: "agent" }]), true);
});

test("hasLiveSusan: soft-deleted Susan does not count (rebuild entry stays visible)", () => {
  assert.equal(
    hasLiveSusan([{ name: "Susan", type: "agent", deleted: 1 }]),
    false,
    "deleted row excluded",
  );
  assert.equal(
    hasLiveSusan([
      { name: "bob", type: "agent" },
      { name: "Susan", type: "agent", deleted: 1 },
    ]),
    false,
  );
  assert.equal(
    hasLiveSusan([
      { name: "Susan", type: "agent", deleted: 0 },
      { name: "Susan", type: "agent", deleted: 1 },
    ]),
    true,
    "live copy wins over a leftover deleted copy",
  );
});

test("resolveBootstrapModel: defaultModel present and visible -> that pair (explicit/scope default wins)", () => {
  const models = {
    defaultModel: { provider: "zenmux", modelId: "claude-sonnet-4-6" },
    modelList: [
      { id: "claude-sonnet-4-6", name: "Claude", provider: "zenmux" },
      { id: "b", name: "B", provider: "p2" },
    ],
  };
  assert.deepEqual(resolveBootstrapModel(models), {
    provider: "zenmux",
    modelId: "claude-sonnet-4-6",
  });
});

test("resolveBootstrapModel: default pair not in modelList -> first visible (matches form preselection)", () => {
  const models = {
    defaultModel: { provider: "zenmux", modelId: "invisible-model" },
    modelList: [
      { id: "jamba-large-1.7", name: "AI21: Jamba", provider: "openrouter" },
      { id: "gpt-5", name: "GPT-5", provider: "opencode" },
    ],
  };
  assert.deepEqual(resolveBootstrapModel(models), {
    provider: "openrouter",
    modelId: "jamba-large-1.7",
  });
  assert.equal(
    resolveBootstrapModel({ defaultModel: { provider: "x" }, modelList: [] }),
    null,
    "malformed default pair alone is not a usable model",
  );
});

test("resolveBootstrapModel: no default but usable models -> first visible (matches form preselection)", () => {
  const models = {
    defaultModel: null,
    modelList: [
      { id: "jamba-large-1.7", name: "AI21: Jamba", provider: "openrouter" },
      { id: "gpt-5", name: "GPT-5", provider: "opencode" },
    ],
  };
  assert.deepEqual(resolveBootstrapModel(models), {
    provider: "openrouter",
    modelId: "jamba-large-1.7",
  });
});

test("resolveBootstrapModel: no model at all -> null (guide to ModelsConfig)", () => {
  assert.equal(resolveBootstrapModel({ defaultModel: null, modelList: [] }), null);
  assert.equal(resolveBootstrapModel({ defaultModel: null }), null);
  assert.equal(resolveBootstrapModel({}), null);
  assert.equal(resolveBootstrapModel(null), null, "models still loading / fetch failed");
});

test("liveSusanMemberId: id of a live agent named Susan, else undefined", () => {
  assert.equal(liveSusanMemberId([]), undefined);
  assert.equal(liveSusanMemberId(null), undefined);
  assert.equal(liveSusanMemberId([{ id: "m1", name: "bob", type: "agent" }]), undefined);
  assert.equal(liveSusanMemberId([{ id: "m2", name: "Susan", type: "agent" }]), "m2");
  assert.equal(
    liveSusanMemberId([
      { id: "m1", name: "bob", type: "agent" },
      { id: "m2", name: "Susan", type: "agent" },
    ]),
    "m2",
  );
});

test("liveSusanMemberId: ignores humans and soft-deleted rows (rebuild entry stays), live copy wins", () => {
  assert.equal(
    liveSusanMemberId([{ id: "h1", name: "Susan", type: "human" }]),
    undefined,
    "human owner named Susan is not a secretary",
  );
  assert.equal(
    liveSusanMemberId([{ id: "m1", name: "Susan", type: "agent", deleted: 1 }]),
    undefined,
    "deleted row excluded",
  );
  assert.equal(
    liveSusanMemberId([
      { id: "m1", name: "Susan", type: "agent", deleted: 0 },
      { id: "m2", name: "Susan", type: "agent", deleted: 1 },
    ]),
    "m1",
    "live copy wins over a leftover deleted copy",
  );
});

test("precheckSusanForPrivateChannel: private + untouched Susan -> added (idempotent)", () => {
  assert.deepEqual(precheckSusanForPrivateChannel([], "private", "m2", false), ["m2"]);
  assert.deepEqual(
    precheckSusanForPrivateChannel(["m1", "m2"], "private", "m2", false),
    ["m1", "m2"],
    "already present -> unchanged",
  );
});

test("precheckSusanForPrivateChannel: no-op when public / no live Susan / touched by user", () => {
  assert.deepEqual(
    precheckSusanForPrivateChannel([], "public", "m2", false),
    [],
    "public channel: not involved (spec §7)",
  );
  assert.deepEqual(
    precheckSusanForPrivateChannel(["m1"], "public", "m2", false),
    ["m1"],
  );
  assert.deepEqual(
    precheckSusanForPrivateChannel([], "private", undefined, false),
    [],
    "no live Susan -> nothing to pre-check",
  );
  assert.deepEqual(
    precheckSusanForPrivateChannel(["m1"], "private", "m2", true),
    ["m1"],
    "user toggled Susan -> respect choice, never re-add",
  );
  assert.deepEqual(
    precheckSusanForPrivateChannel(["m2"], "private", "m2", true),
    ["m2"],
    "user-kept selection stays even when touched",
  );
  assert.deepEqual(
    precheckSusanForPrivateChannel([], "private", undefined, true),
    [],
  );
});

test("precheckSusanForPrivateChannel: switching back to public drops the untouched pre-check (public not involved)", () => {
  assert.deepEqual(
    precheckSusanForPrivateChannel(["m1", "m2"], "public", "m2", false),
    ["m1"],
    "pre-checked Susan removed; other selections kept",
  );
  assert.deepEqual(
    precheckSusanForPrivateChannel(["m1"], "public", "m2", false),
    ["m1"],
    "no Susan -> unchanged (same reference semantics)",
  );
  assert.deepEqual(
    precheckSusanForPrivateChannel(["m1", "m2"], "public", "m2", true),
    ["m1", "m2"],
    "user-selected Susan survives (touched)",
  );
});
