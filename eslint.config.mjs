import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // 全局 ignore：`.scratch/` 存的是 effort 的 spec / 票据 / 历史归档代码与一次性录屏脚本。
  // 它们入库是为了让文档与票据可追溯，不是待维护的源码；把它们算进 lint 检查面只会让
  // 归档快照里的 unused 变量随每个新 effort 线性累积，把真源码的告警淹在噪声里。
  // 只含 `ignores` 键的 config 对象即 flat config 的全局 ignore（eslint v9）。
  { ignores: [".scratch/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
