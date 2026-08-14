import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { RpcSubscriber } = await jiti.import("./subscriber.ts");

function resetSubscriberState() {
  globalThis.__workspliceRunningListeners = new Set();
}

test("subscribe adds the listener and returns an unsubscribe function", () => {
  resetSubscriberState();
  const subscriber = new RpcSubscriber();
  const seen = [];
  const listener = (ids) => seen.push(ids);

  const unsubscribe = subscriber.subscribe(listener);
  assert.equal(subscriber.hasListeners(), true);

  subscriber.forEach((l) => l(["s1"]));
  assert.deepEqual(seen, [["s1"]]);

  unsubscribe();
  assert.equal(subscriber.hasListeners(), false);
  subscriber.forEach((l) => l(["s2"]));
  assert.deepEqual(seen, [["s1"]]);
});

test("forEach visits every listener", () => {
  resetSubscriberState();
  const subscriber = new RpcSubscriber();
  const called = [];
  subscriber.subscribe(() => called.push("a"));
  subscriber.subscribe(() => called.push("b"));

  subscriber.forEach((l) => l());

  assert.deepEqual(called, ["a", "b"]);
});

test("clear empties the listener set", () => {
  resetSubscriberState();
  const subscriber = new RpcSubscriber();
  subscriber.subscribe(() => {});

  subscriber.clear();

  assert.equal(subscriber.hasListeners(), false);
});
