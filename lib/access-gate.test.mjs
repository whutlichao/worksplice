import assert from "node:assert/strict";
import test from "node:test";

// 纯函数层 + 探针注入：准入闸的判定不依赖真实网络（探针与网卡清单都可注入）。
const {
  decideAccessPosture,
  detectBindScope,
  isLoopbackAddress,
  accessGateClosedMessage,
  getAccessPosture,
  resetAccessPostureCache,
} = await import("./access-gate.ts");

// ---------------------------------------------------------------------------
// 姿态判定（ADR-0013 决策二）
// ---------------------------------------------------------------------------

test("non-loopback bind without a credential closes the service (fail-closed)", () => {
  assert.equal(
    decideAccessPosture({ passwordEnabled: false, bind: "non-loopback" }),
    "closed",
  );
});

test("loopback keeps zero-config; a configured password keeps today's Basic-auth gate", () => {
  assert.equal(decideAccessPosture({ passwordEnabled: false, bind: "loopback" }), "open");
  assert.equal(decideAccessPosture({ passwordEnabled: true, bind: "loopback" }), "password");
  assert.equal(decideAccessPosture({ passwordEnabled: true, bind: "non-loopback" }), "password");
});

test("an undetermined bind never closes the service (npx worksplice stays zero-config)", () => {
  assert.equal(decideAccessPosture({ passwordEnabled: false, bind: "unknown" }), "open");
});

test("the closed message names the reason and both ways out", () => {
  const message = accessGateClosedMessage();
  assert.match(message, /WORKSPLICE_PASSWORD/);
  assert.match(message, /127\.0\.0\.1|loopback/i);
});

// ---------------------------------------------------------------------------
// bind 探针（自连接：绑到非 loopback 地址的监听在本机可达）
// ---------------------------------------------------------------------------

test("isLoopbackAddress recognizes the loopback forms", () => {
  for (const address of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const address of ["0.0.0.0", "192.168.1.5", "::", "fe80::1", "2001:db8::1"]) {
    assert.equal(isLoopbackAddress(address), false, address);
  }
});

const interfaces = (addresses) =>
  addresses.map((address, index) => ({
    name: `en${index}`,
    address,
    internal: false,
  }));

test("any reachable non-loopback address means the server accepts non-loopback connections", async () => {
  const probeResults = new Map([
    ["192.168.1.5", "refused"],
    ["10.0.0.7", "open"],
  ]);
  const scope = await detectBindScope({
    port: "30142",
    interfaces: () => interfaces([...probeResults.keys()]),
    probe: async (address) => probeResults.get(address) ?? "unknown",
  });
  assert.equal(scope, "non-loopback");
});

test("all non-loopback refused plus a live loopback probe means the listener is loopback-only", async () => {
  const scope = await detectBindScope({
    port: "30142",
    interfaces: () => interfaces(["192.168.1.5", "10.0.0.7"]),
    probe: async (address) => (address === "127.0.0.1" ? "open" : "refused"),
  });
  assert.equal(scope, "loopback");
});

test("all refused with no live loopback probe never claims loopback (the server may not be listening yet)", async () => {
  const scope = await detectBindScope({
    port: "30142",
    interfaces: () => interfaces(["192.168.1.5"]),
    probe: async () => "refused",
  });
  assert.equal(scope, "unknown");
});

test("an inconclusive probe never claims loopback", async () => {
  const scope = await detectBindScope({
    port: "30142",
    interfaces: () => interfaces(["192.168.1.5"]),
    probe: async () => "unknown",
  });
  assert.equal(scope, "unknown");
});

test("no port and no non-loopback interface are both honest answers, not guesses", async () => {
  assert.equal(
    await detectBindScope({ port: null, interfaces: () => interfaces(["192.168.1.5"]), probe: async () => "open" }),
    "unknown",
  );
  assert.equal(
    await detectBindScope({ port: "30142", interfaces: () => [], probe: async () => "open" }),
    "loopback",
  );
  assert.equal(
    await detectBindScope({
      port: "30142",
      interfaces: () => interfaces(["127.0.0.1", "::1"]),
      probe: async () => "open",
    }),
    "loopback",
  );
});

test("waitForServerListening polls the loopback probe until the server answers", async () => {
  const { waitForServerListening } = await import("./access-gate.ts");
  const results = ["refused", "refused", "open"];
  const listening = await waitForServerListening({
    port: "30142",
    timeoutMs: 500,
    pollMs: 1,
    probe: async () => results.shift() ?? "refused",
  });
  assert.equal(listening, true);

  const never = await waitForServerListening({
    port: "30142",
    timeoutMs: 50,
    pollMs: 1,
    probe: async () => "refused",
  });
  assert.equal(never, false, "一直连不上就不能声称已监听");
  assert.equal(
    await waitForServerListening({ port: "not-a-port", probe: async () => "open" }),
    false,
  );
});

// ---------------------------------------------------------------------------
// 生产入口：memo 化（每个请求不再探测）+ 与 env 的接线
// ---------------------------------------------------------------------------

test("getAccessPosture reads WORKSPLICE_PASSWORD and memoizes the verdict", async () => {
  const original = process.env.WORKSPLICE_PASSWORD;
  try {
    process.env.WORKSPLICE_PASSWORD = "secret";
    resetAccessPostureCache();
    assert.equal(await getAccessPosture(), "password");
    // memo 之后即使 env 变了也不再重探（服务进程启动后姿态固定）
    delete process.env.WORKSPLICE_PASSWORD;
    assert.equal(await getAccessPosture(), "password");
  } finally {
    if (original === undefined) delete process.env.WORKSPLICE_PASSWORD;
    else process.env.WORKSPLICE_PASSWORD = original;
    resetAccessPostureCache();
  }
});
