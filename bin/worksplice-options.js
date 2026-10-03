"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:      { type: "string", short: "p" },
      hostname:  { type: "string", short: "H" },
      "no-open": { type: "boolean" },
      demo:      { type: "boolean" },
    },
    strict: false,
  });

  return {
    port: cliArgs.port ?? env.PORT ?? "30142",
    hostname: cliArgs.hostname ?? env.WORKSPLICE_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.WORKSPLICE_NO_OPEN),
    // --demo：用一份预置演示库启动，不碰用户真实的 ~/.worksplice，也不跑任何 agent。
    demo: Boolean(cliArgs.demo) || isEnabled(env.WORKSPLICE_DEMO),
  };
}

module.exports = { parseLaunchOptions };
