/**
 * [INPUT]: 依赖 esbuild 与 src/client/runtime.js
 * [OUTPUT]: 生成宿主 ModuleLoader 接受的 lib/client.js
 * [POS]: 唯一浏览器构建入口；依赖由 DSH 模块表提供，发布包包含预构建结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ["src/client/runtime.js"],
  outfile: "lib/client.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["react", "@deepseek-ai/dsh-client-ui-primitives"],
  banner: {
    js: '/** [INPUT]: src/client 源码; [OUTPUT]: DSH 客户端模块; [POS]: 生成产物，执行 npm run build 重建。\n * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md\n */\nwindow.__ModuleLoader__.load({id:"dsh-plugin-emote-chat",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
});
