import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./request-security.ts");
}

function apiPost(headers, url = "http://127.0.0.1:30142/api/test") {
  return new Request(url, { method: "POST", headers });
}

test("allows same-origin and non-browser API requests", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30142/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30142",
      origin: "http://localhost:30142",
      "sec-fetch-site": "same-origin",
    },
  })), true);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30142/api/test", {
    method: "POST",
    headers: { host: "localhost:30142" },
  })), true);
});

test("allows LAN same-origin requests when Next.js uses an internal localhost URL", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30142/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30142",
      origin: "http://192.168.32.7:30142",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(request), true);
});

test("allows IPv6 and an explicitly configured hostname", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const ipv6 = new Request("http://localhost:30142/api/test", {
    method: "POST",
    headers: {
      host: "[::1]:30142",
      origin: "http://[::1]:30142",
      "sec-fetch-site": "same-origin",
    },
  });
  const configured = new Request("http://localhost:30142/api/test", {
    method: "POST",
    headers: {
      host: "worksplice.internal:30142",
      origin: "http://worksplice.internal:30142",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(ipv6), true);
  assert.equal(isApiRequestAllowed(configured, ["worksplice.internal"]), true);
});

test("rejects cross-origin browser API requests", async () => {
  const { isApiRequestAllowed, shouldCheckApiRequestOrigin } = await loadSubject();
  const post = new Request("http://localhost:30142/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30142",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  });
  const crossSiteGet = new Request("http://localhost:30142/api/sessions", {
    headers: { host: "localhost:30142", "sec-fetch-site": "cross-site" },
  });
  assert.equal(shouldCheckApiRequestOrigin(post), true);
  assert.equal(isApiRequestAllowed(post), false);
  assert.equal(shouldCheckApiRequestOrigin(crossSiteGet), true);
  assert.equal(isApiRequestAllowed(crossSiteGet), false);
});

test("does not globally trust opaque iframe or alternate loopback origins", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const previewUrl = "http://localhost:30142/api/files/tmp/test.docx?type=preview";
  const opaqueIframe = new Request(previewUrl, {
    headers: {
      host: "localhost:30142",
      origin: "null",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "iframe",
    },
  });
  const alternateLoopback = new Request(previewUrl, {
    headers: {
      host: "localhost:30142",
      origin: "http://127.0.0.1:30142",
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(isApiRequestAllowed(opaqueIframe), false);
  assert.equal(isApiRequestAllowed(alternateLoopback), false);
});

test("allows only user-initiated session export document navigations from a PWA", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const navigationHeaders = {
    host: "127.0.0.1:30142",
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    "sec-fetch-user": "?1",
  };

  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30142/api/sessions/session-id/export?inline=1",
    { headers: navigationHeaders },
  )), true);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30142/api/sessions",
    { headers: navigationHeaders },
  )), false);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30142/api/sessions/session-id/export?inline=1",
    { headers: { ...navigationHeaders, "sec-fetch-dest": "empty" } },
  )), false);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30142/api/sessions/session-id/export?inline=1",
    {
      headers: {
        ...navigationHeaders,
        "sec-fetch-user": "",
      },
    },
  )), false);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30142/api/sessions/session-id/export?inline=1",
    { method: "POST", headers: navigationHeaders },
  )), false);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30142/api/sessions/session-id/export?inline=1",
    { headers: { ...navigationHeaders, host: "attacker.example:30142" } },
  )), false);
});

test("rejects an origin that does not match the external request host", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30142/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30142",
      origin: "http://attacker.example",
      "sec-fetch-site": "same-site",
    },
  });
  assert.equal(isApiRequestAllowed(request), false);
});

test("rejects DNS rebinding even when browser headers say same-origin", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30142/api/skills/install", {
    method: "POST",
    headers: {
      host: "attacker.example:30142",
      origin: "http://attacker.example:30142",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  });
  assert.equal(isApiRequestAllowed(request), false);
});

test("rejects missing, malformed, and unconfigured Host headers", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30142/api/test")), false);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30142/api/test", {
    headers: { host: "localhost@attacker.example:30142" },
  })), false);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30142/api/test", {
    headers: { host: "worksplice.internal:30142" },
  })), false);
});

test("rebuilds the request origin from a trusted proxy's forwarding headers", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  // Orca 的 dev 代理把 Host 改写成上游 bind 地址，浏览器原始 host 只在
  // X-Forwarded-Host 里，且不设置 X-Forwarded-Proto（协议沿用 request.url 的 http）。
  const request = apiPost({
    host: "127.0.0.1:30142",
    "x-forwarded-host": "worksplice.orca.localhost:60747",
    origin: "http://worksplice.orca.localhost:60747",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
  }, "http://127.0.0.1:30142/api/members");
  assert.equal(isApiRequestAllowed(request), true);
});

test("takes the scheme from X-Forwarded-Proto and ignores invalid values", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const forwarded = {
    host: "127.0.0.1:30142",
    "x-forwarded-host": "ws.example:443",
    "sec-fetch-site": "same-origin",
  };

  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    "x-forwarded-proto": "https",
    origin: "https://ws.example",
  })), true);
  // 大小写不敏感，且默认端口在 origin 比较里归一。
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    "x-forwarded-proto": "HTTPS",
    origin: "https://ws.example:443",
  })), true);
  // 非法协议回退到 request.url 的 http。
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    "x-forwarded-proto": "ftp",
    origin: "http://ws.example:443",
  })), true);
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    "x-forwarded-proto": "ftp",
    origin: "https://ws.example",
  })), false);
  // 只给转发协议、不给转发 host：Host 仍是 authority，协议照常采信。
  assert.equal(isApiRequestAllowed(apiPost({
    host: "127.0.0.1:30142",
    "x-forwarded-proto": "https",
    origin: "https://127.0.0.1:30142",
    "sec-fetch-site": "same-origin",
  })), true);
});

test("uses only the first X-Forwarded-Host value", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const forwarded = {
    host: "127.0.0.1:30142",
    "x-forwarded-host": "ws.orca.localhost:60747, inner.example",
    "sec-fetch-site": "same-origin",
  };
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    origin: "http://ws.orca.localhost:60747",
  })), true);
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    origin: "http://inner.example",
  })), false);
});

test("keeps rejecting cross-site, mismatched, and malformed forwarded origins", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const forwarded = {
    host: "127.0.0.1:30142",
    "x-forwarded-host": "attacker.example",
    "sec-fetch-site": "same-origin",
  };

  // 转发头只参与 origin 重建，不替代同源比较。
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    origin: "https://attacker.example",
  })), false);
  // 跨站请求在 Sec-Fetch-Site 处先被拒绝，转发头无从放宽。
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    origin: "http://attacker.example",
    "sec-fetch-site": "cross-site",
  })), false);
  // userinfo / 路径形态的转发 host 不通过校验，回退到 Host（127.0.0.1:30142）。
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    "x-forwarded-host": "evil@attacker.example",
    origin: "http://attacker.example",
  })), false);
  assert.equal(isApiRequestAllowed(apiPost({
    ...forwarded,
    "x-forwarded-host": "attacker.example/api",
    origin: "http://attacker.example",
  })), false);
  // Host 白名单仍只看 Host：转发头不能让未配置的外部 host 通过准入。
  assert.equal(isApiRequestAllowed(apiPost({
    host: "attacker.example:30142",
    "x-forwarded-host": "attacker.example:30142",
    origin: "http://attacker.example:30142",
    "sec-fetch-site": "same-origin",
  })), false);
});

test("recognizes JSON request content types", async () => {
  const { hasJsonContentType } = await loadSubject();
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "application/json; charset=utf-8" },
  })), true);
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "application/problem+json" },
  })), true);
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "text/plain" },
  })), false);
});
