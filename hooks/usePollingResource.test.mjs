import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("usePollingResource 是唯一的轮询纪律持有者（#278）", async () => {
  const pollingSource = await readFile(
    new URL("./usePollingResource.ts", import.meta.url),
    "utf-8",
  );
  // 原语只做四件事：取数、合并注入、后台 tab 暂停、interval 注入 + 卸载清理。
  assert.match(pollingSource, /export function usePollingResource/);
  assert.match(pollingSource, /scopeKey/);
  assert.match(pollingSource, /intervalMs/);
  assert.match(pollingSource, /load/);
  assert.match(pollingSource, /merge/);
  assert.match(pollingSource, /setInterval/);
  assert.match(pollingSource, /document\.hidden/);
  assert.match(pollingSource, /clearInterval/);
});

test("useChannelData 只消费原语，不再自持定时器（#278）", async () => {
  const hookSource = await readFile(
    new URL("./useChannelData.ts", import.meta.url),
    "utf-8",
  );
  assert.match(hookSource, /usePollingResource/);
  assert.doesNotMatch(hookSource, /setInterval/);
  assert.doesNotMatch(hookSource, /document\.hidden/);
  assert.doesNotMatch(hookSource, /clearInterval/);
});
