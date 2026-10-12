/**
 * [INPUT]: 共享 browserCookie 与当前宿主启动清单
 * [OUTPUT]: 启动清单和 bundle 路由的只读诊断输出
 * [POS]: 开发诊断脚本；不进入发布包，不改变宿主配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
/**
 * Inspect the live page's boot graph for this plugin's client half.
 *
 * Reads the authenticated index (the boot manifest ships with it) and reports
 * whether the package appears in `window.__DSH_BOOT__` and whether the bundle
 * route answers. Read-only: one credentialed GET of `/` and one of the bundle.
 *
 * Usage:
 *   node scripts/boot-graph.mjs [baseUrl]
 */

import { browserCookie } from "./auth.mjs";

const base = (process.argv[2] ?? process.env.DSH_WEB_URL ?? "http://127.0.0.1:19387").replace(/\/$/u, "");
const packageName = "dsh-plugin-emote-chat";
const cookie = browserCookie(base);

const index = await fetch(`${base}/`, { headers: { cookie } });
const html = await index.text();
console.log(`index ${index.status} (${html.length} bytes)`);

const bootMatch = /(?:globalThis\["__DSH_BOOT__"\]|window\.__DSH_BOOT__)\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/u.exec(html);
console.log(`boot manifest: ${bootMatch === null ? "not found inline" : "found"}`);

const occurrences = [...html.matchAll(new RegExp(packageName, "gu"))].length;
console.log(`"${packageName}" occurrences in the index: ${occurrences}`);

let bundleUrl;
if (bootMatch !== null) {
  try {
    const boot = JSON.parse(bootMatch[1]);
    const rows = Array.isArray(boot.entries) ? boot.entries : [];
    const row = rows.find((candidate) => candidate.id === packageName);
    bundleUrl = row?.url;
    console.log(`boot row: ${row === undefined ? "MISSING" : JSON.stringify(row)}`);
  } catch (error) {
    console.log(`boot manifest parse failed: ${String(error.message)}`);
  }
}

if (bundleUrl !== undefined) {
  const response = await fetch(new URL(bundleUrl, base + "/"), { headers: { cookie } });
  const body = await response.text();
  console.log(`${response.status} ${bundleUrl} (${body.length} bytes)`);
} else {
  console.log("bundle route: absent from boot entries");
  process.exitCode = 1;
}
