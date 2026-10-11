import test from "node:test";
test("synthetic benchmark runner", async () => {
  await import("./benchmark.mjs");
});
