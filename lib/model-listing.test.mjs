import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-listing.ts");
  } catch {
    return import("./model-listing.ts");
  }
}

const { resolveModelListingStrategy, loadModelListingServices } = await loadSubject();

function makeAgentDir() {
  const agentDir = mkdtempSync(join(tmpdir(), "model-listing-agent-"));
  writeFileSync(join(agentDir, "settings.json"), "{}");
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {} }));
  writeFileSync(join(agentDir, "auth.json"), "{}");
  return agentDir;
}

test("plain cwd without project resources takes the lite path", () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-plain-"));
  const agentDir = makeAgentDir();
  assert.equal(resolveModelListingStrategy(cwd, agentDir), "lite");
});

test("untrusted cwd with project settings falls back to full (trust gate, #236)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-untrusted-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), "{}");
  const agentDir = makeAgentDir();
  assert.equal(resolveModelListingStrategy(cwd, agentDir), "full");
});

test("trusted cwd with project settings stays on the lite path", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-trusted-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), "{}");
  const agentDir = makeAgentDir();
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  new ProjectTrustStore(agentDir).set(cwd, true);
  assert.equal(resolveModelListingStrategy(cwd, agentDir), "lite");
});

test("lite path returns a working runtime without loading extensions", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-lite-"));
  const agentDir = makeAgentDir();
  const services = await loadModelListingServices(cwd, agentDir);
  assert.equal(services.strategy, "lite");
  assert.deepEqual(await services.modelRuntime.getAvailable(), []);
  assert.equal(services.settings.getEnabledModels(), undefined);
});
