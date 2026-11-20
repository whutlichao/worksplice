import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { formatAgentErrorSummary } = await jiti.import("./agent-error-summary.ts");

test("blank errors produce no summary", () => {
  assert.equal(formatAgentErrorSummary(null), null);
  assert.equal(formatAgentErrorSummary(undefined), null);
  assert.equal(formatAgentErrorSummary(""), null);
  assert.equal(formatAgentErrorSummary("  \n\t \r\n "), null);
});

test("model/API wrappers unwrap into a short status + message summary", () => {
  const rateLimited = formatAgentErrorSummary(
    'model error: 429: {"error":{"message":"Rate limit reached","type":"FreeUsageLimitError"}}',
  );
  assert.equal(rateLimited.summary, "429: Rate limit reached");
  assert.equal(
    rateLimited.detail,
    'model error: 429: {"error":{"message":"Rate limit reached","type":"FreeUsageLimitError"}}',
  );

  const noCredits = formatAgentErrorSummary(
    'model error: 402 {"error":{"message":"Insufficient credits"}}',
  );
  assert.equal(noCredits.summary, "402: Insufficient credits");
});

test("bare JSON error shapes unwrap message/detail", () => {
  assert.equal(
    formatAgentErrorSummary('{"error":{"message":"Bad gateway"}}').summary,
    "Bad gateway",
  );
  assert.equal(
    formatAgentErrorSummary('{"message":"Overloaded"}').summary,
    "Overloaded",
  );
  assert.equal(
    formatAgentErrorSummary('{"detail":"Not found"}').summary,
    "Not found",
  );
});

test("multi-line errors and stacks use the first meaningful line", () => {
  const stack = formatAgentErrorSummary(
    "\n  Error: connect ECONNREFUSED 127.0.0.1:443\n    at TCPConnectWrap.afterConnect\n    at processTicksAndRejections",
  );
  assert.equal(stack.summary, "Error: connect ECONNREFUSED 127.0.0.1:443");
  assert.match(stack.detail, /processTicksAndRejections/, "detail 保留完整原文");
});

test("HTML error bodies collapse to their first readable text line", () => {
  const html = formatAgentErrorSummary(
    "<!DOCTYPE html>\n<html>\n<body><h1>502 Bad Gateway</h1></body>\n</html>",
  );
  assert.equal(html.summary, "502 Bad Gateway");
});

test("markup-only or label-only errors never produce a blank summary", () => {
  assert.equal(formatAgentErrorSummary("<html></html>").summary, "<html></html>");
  assert.equal(formatAgentErrorSummary("model error:").summary, "model error:");
});

test("whitespace collapses and long single lines soft-truncate at about 160 chars", () => {
  assert.equal(
    formatAgentErrorSummary("model error:  429:   Rate    limit   reached").summary,
    "429: Rate limit reached",
  );

  const long = `upstream error: ${"x".repeat(400)}`;
  const formatted = formatAgentErrorSummary(long);
  assert.ok(formatted.summary.endsWith("…"));
  assert.ok(formatted.summary.length <= 161);
  assert.equal(formatted.detail, long);
});

test("server-provided non-English error text is preserved verbatim", () => {
  const raw = "模型错误：额度不足，请稍后重试";
  assert.equal(formatAgentErrorSummary(raw).summary, raw);
});
