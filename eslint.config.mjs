/**
 * [INPUT]: ESLint flat config
 * [OUTPUT]: 未定义标识符与未使用导入检查
 * [POS]: 源码模块拆分的静态契约检查，不检查生成的 bundle
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export default [
  {
    files: ["lib/*.js", "src/client/*.js"],
    ignores: ["lib/client.js"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "process",
          "Buffer",
          "Response",
          "URL",
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "document",
          "window",
          "fetch",
          "AbortController",
          "MutationObserver",
          "NodeFilter",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "console",
          "getComputedStyle",
        ].map((name) => [name, "readonly"]),
      ),
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
    },
  },
];
