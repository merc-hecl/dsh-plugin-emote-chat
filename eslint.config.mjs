/**
 * [INPUT]: ESLint flat config
 * [OUTPUT]: Host、Client、脚本与测试的未定义标识符和未使用变量检查
 * [POS]: 全仓库手写 JavaScript 静态检查，不检查生成的 bundle
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export default [
  {
    files: ["lib/*.js", "src/client/*.js", "scripts/*.mjs", "test/*.mjs"],
    ignores: ["lib/client.js"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "process",
          "Buffer",
          "Response",
          "Request",
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
          "TextDecoder",
          "DOMException",
          "setImmediate",
        ].map((name) => [name, "readonly"]),
      ),
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
    },
  },
];
