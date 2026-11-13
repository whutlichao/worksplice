import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";

// socket 层的回归面：准入闸的探针必须区分「有人握了手」与「本服务在答」。
//
// 为什么这层值得起真 socket（而不是继续注入 `probe`）：本票的 bug 由**对端行为**决定——
// tun 型 VPN 客户端（实测 Shadowrocket 的 `MacPacketTunnel`，网卡 utun9）对自己地址上的
// 任意端口都完成 TCP 握手，握手后既不转发也不回一个字节。这种 peer 换个注入式用例只能用一个
// 假的 `"open"` 冒充，测不出「判据看的是握手还是应答」。
//
// 全部用例起在 loopback 的 `listen(0)` 上（候选地址名取 `localhost`：它不被
// `isLoopbackAddress` 归为 loopback，解析后落到本机 loopback），于是默认探针真的跑在 socket
// 上，又不依赖本机具体网卡。
const { probeAnswer, probeHandshake, detectBindScope, detectBindScopeVerdict } = await import(
  "./access-gate.ts"
);

/** 假 tun 的形态：照做握手，之后一个字节都不写。 */
async function startSilentAcceptor(host = "127.0.0.1") {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    // 兜住 error：探针侧 destroy 会让这里冒 ECONNRESET，不接就是 uncaught。
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, host, resolve));
  return {
    port: server.address().port,
    stop: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}

/** 真应答者：最小 HTTP 服务（`status` 用来证明「任意状态码都算答得上」）。 */
async function startHttpAnswerer(host = "127.0.0.1", status = 200) {
  const server = http.createServer((_request, response) => {
    response.statusCode = status;
    response.end("ok");
  });
  await new Promise((resolve) => server.listen(0, host, resolve));
  return {
    port: server.address().port,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

// ---------------------------------------------------------------------------
// 本票的正解：tun 型假 accept（握手成功 + 零字节应答）不得判 open
// ---------------------------------------------------------------------------

test("a peer that completes the handshake but answers zero bytes is not open", async (t) => {
  const peer = await startSilentAcceptor();
  t.after(() => peer.stop());

  // 先钉住这个 peer 确实是「假 accept」而不是「连不上」——否则本用例测的是别的东西。
  assert.equal(await probeHandshake("127.0.0.1", peer.port), "open", "假 tun 必须真的完成握手");

  assert.equal(
    await probeAnswer("127.0.0.1", peer.port, { connectTimeoutMs: 200, answerTimeoutMs: 120 }),
    "refused",
    "握手成功但零字节应答的 peer 不得判为 open（tun 型 VPN 客户端的假 accept）",
  );
});

test("a listener that answers HTTP is open — any status code counts, no credential involved", async (t) => {
  for (const status of [200, 401, 404, 503]) {
    const peer = await startHttpAnswerer("127.0.0.1", status);
    t.after(() => peer.stop());
    assert.equal(
      await probeAnswer("127.0.0.1", peer.port, { connectTimeoutMs: 200, answerTimeoutMs: 400 }),
      "open",
      `状态码 ${status} 证明本服务在这个地址上答得上 HTTP（要的是「答得上」，不是「答得对」）`,
    );
  }
});

// ---------------------------------------------------------------------------
// 其余三档收敛（fail-closed 的方向：只有 HTTP 应答才进 non-loopback）
// ---------------------------------------------------------------------------

test("a port nobody listens on is refused", async () => {
  // 先占一个端口再把 listener 关掉：既拿到一个「确定没人听」的端口号，又不靠猜。
  const peer = await startSilentAcceptor();
  const port = peer.port;
  await peer.stop();

  assert.equal(
    await probeAnswer("127.0.0.1", port, { connectTimeoutMs: 200, answerTimeoutMs: 200 }),
    "refused",
  );
});

test("a peer that hangs up right after the handshake is refused, not open", async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  );

  assert.equal(
    await probeAnswer("127.0.0.1", server.address().port, {
      connectTimeoutMs: 200,
      answerTimeoutMs: 200,
    }),
    "refused",
    "建连后 EOF 而无任何 HTTP 字节 = 对端不是本服务",
  );
});

test("a connect that fails with something other than a refusal stays undecided", async () => {
  // `.invalid` 是 RFC 2606 保留的永不解析的 TLD ⇒ 建连阶段拿到 ENOTFOUND（不是 ECONNREFUSED）。
  assert.equal(
    await probeAnswer("probe.invalid", 40143, { connectTimeoutMs: 200, answerTimeoutMs: 200 }),
    "unknown",
  );
});

test("a connect that never completes within its budget stays undecided", async () => {
  // TEST-NET-2（RFC 5737）只用于文档，永不承载真实主机；SYN 被丢弃 ⇒ 建连预算耗尽。
  assert.equal(
    await probeAnswer("198.51.100.1", 40143, { connectTimeoutMs: 150, answerTimeoutMs: 100 }),
    "unknown",
    "连不上但又不是拒绝，只能是 unknown——unknown 不声称 loopback",
  );
});

// ---------------------------------------------------------------------------
// 端到端：真 socket + 注入 interfaces + 默认探针（不依赖本机具体网卡）
// ---------------------------------------------------------------------------

const loopbackNamedCandidate = () => [{ name: "test0", address: "localhost", internal: false }];

test("a fake-accept peer at a non-loopback candidate never makes the bind look non-loopback", async (t) => {
  const peer = await startSilentAcceptor("0.0.0.0");
  t.after(() => peer.stop());

  // 这个测试形状里候选与 loopback 是**同一个**假对端（真世界里 loopback 上是本服务自己），
  // 所以「服务自己答得上 HTTP」这条校准必然不通过 ⇒ 结论是「不可判定」，不是 loopback。
  // 要守的仍然是本票的不变式：假 accept 永远不能变成 non-loopback（那样服务会被关掉）。
  const verdict = await detectBindScopeVerdict({
    port: String(peer.port),
    interfaces: loopbackNamedCandidate,
  });
  assert.notEqual(verdict.scope, "non-loopback", "tun 型假 accept 不得判成 non-loopback");
  assert.equal(verdict.scope, "unknown");
  assert.equal(verdict.settled, false, "服务自己答不上 HTTP ⇒ 静默不是证据，此结论不可缓存");
});

test("a peer that stays silent once but answers later is still seen as non-loopback", async (t) => {
  // 现实形态：候选地址上就是本服务，但首轮探测撞上它自己在忙/在编译（静默），第二轮才答。
  // 只烤握手、或只探一轮的形态都会在这里漏判成 loopback（= fail-open）。
  let connections = 0;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    if (connections === 1) return; // 首次：接了连接、一个字节都不回
    socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  );

  assert.equal(
    await detectBindScope({
      port: String(server.address().port),
      interfaces: loopbackNamedCandidate,
    }),
    "non-loopback",
    "复判必须能看见「首轮静默、次轮答得上」的服务——否则真 0.0.0.0 暴露会静默通过",
  );
});

test("a real 0.0.0.0 bind that answers HTTP at the candidate still reads as non-loopback", async (t) => {
  // fail-closed 方向的反向守卫：真要暴露到非 loopback 面，探针必须看得出来。
  const answerer = await startHttpAnswerer("0.0.0.0");
  t.after(() => answerer.stop());

  assert.equal(
    await detectBindScope({
      port: String(answerer.port),
      interfaces: loopbackNamedCandidate,
    }),
    "non-loopback",
  );
});
