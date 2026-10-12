/**
 * [INPUT]: 共享 browserCookie 与当前插件 HTTP 路由
 * [OUTPUT]: 插件准确 HTTP 路由的只读诊断输出
 * [POS]: 开发诊断脚本；不进入发布包，不改变宿主配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
/**
 * Read-only verification probe for a running dsh Web/Desktop process.
 *
 * It signs the browser-session cookie from `$DSH_HOME/.credentials.yaml` (the
 * same secret Connection uses), then checks that this plugin's exact Fetch
 * routes are registered and answering. An unauthenticated request returns 401
 * for every /api path, so the cookie is what separates "registered" (a body)
 * from "not registered" (404 not found).
 *
 * Usage:
 *   node scripts/probe.mjs [baseUrl]
 *
 * Nothing here mutates the harness: it only reads the local credential file and
 * issues GET requests to the loopback URL the process already serves.
 */

import { browserCookie } from "./auth.mjs";

const base = (process.argv[2] ?? process.env.DSH_WEB_URL ?? "http://127.0.0.1:19387").replace(/\/$/u, "");
const authority = new URL(base).host;
const cookie = browserCookie(base);

/** GET one path and print the first bytes of the body. */
async function probe(path) {
  const headers = { cookie };
  try {
    const response = await fetch(`${base}${path}`, { headers });
    const body = await response.text();
    const trimmed = body.length > 220 ? `${body.slice(0, 220)}…` : body;
    console.log(`${String(response.status).padEnd(4)} ${path}\n     ${trimmed.replace(/\n/gu, " ")}`);
    return response.status;
  } catch (error) {
    console.log(`ERR  ${path}\n     ${String(error.message)}`);
    return 0;
  }
}

console.log(`probe: ${base} (authority ${authority}, cookie signed)`);
await probe("/api/emote-chat/config");
await probe("/api/emote-chat/reactions?since=0");
await probe("/api/emote-chat/sticker?id=missing%2Fmissing");
await probe("/api/emote-chat/does-not-exist");
