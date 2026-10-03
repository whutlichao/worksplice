import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseLaunchOptions } = require("../bin/worksplice-options.js");

test("opens the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    port: "30142",
    hostname: "127.0.0.1",
    openBrowser: true,
    demo: false,
  });
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("supports truthy WORKSPLICE_NO_OPEN values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { WORKSPLICE_NO_OPEN: value }).openBrowser, false);
  }
});

test("does not disable browser opening for false WORKSPLICE_NO_OPEN values", () => {
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions([], { WORKSPLICE_NO_OPEN: value }).openBrowser, true);
  }
});

test("preserves port and hostname options", () => {
  assert.deepEqual(
    parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {}),
    {
      port: "8080",
      hostname: "0.0.0.0",
      openBrowser: true,
      demo: false,
    },
  );
});

test("demo mode comes from --demo or a truthy WORKSPLICE_DEMO", () => {
  assert.equal(parseLaunchOptions(["--demo"], {}).demo, true);
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { WORKSPLICE_DEMO: value }).demo, true);
  }
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(
      parseLaunchOptions([], { WORKSPLICE_DEMO: value }).demo,
      false,
      "假值不得把普通启动变成演示模式——演示模式会绕开用户真实的数据目录",
    );
  }
  assert.equal(parseLaunchOptions(["--no-open"], {}).demo, false);
});

test("supports WORKSPLICE_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(
    parseLaunchOptions([], { HOSTNAME: "container-id" }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseLaunchOptions([], { WORKSPLICE_HOSTNAME: "0.0.0.0" }).hostname,
    "0.0.0.0",
  );
});
