import assert from "node:assert/strict";
import test from "node:test";
import { hasLiveSusan, resolveBootstrapModel } from "./secretary-bootstrap.ts";

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
