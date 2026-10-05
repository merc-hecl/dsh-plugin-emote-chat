/**
 * [INPUT]: Node crypto/fs 与本地 DSH 浏览器会话认证
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

import { createHmac, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const base = (process.argv[2] ?? process.env.DSH_WEB_URL ?? "http://127.0.0.1:19387").replace(/\/$/u, "");
const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");

/** Extract the `client-connection/browser-session` grant's stored secret. */
function readSecret(text) {
  const lines = text.split(/\r?\n/u);
  let inRecord = false;
  for (const line of lines) {
    if (/^\S/u.test(line) && line.trim() !== "") inRecord = false;
    if (/^\s{2}client-connection\/browser-session:\s*$/u.test(line)) {
      inRecord = true;
      continue;
    }
    if (!inRecord) continue;
    const match = /^\s+secret\s*:\s*(\S+)\s*$/u.exec(line);
    if (match !== null) return match[1].replace(/^["']|["']$/gu, "");
  }
  return undefined;
}

/** Base64url-encode without padding, exactly as Connection does. */
function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Build the `dsh-auth-<hash>` cookie value for one authority. */
function cookieFor(secretRaw, authority) {
  const secret = Buffer.from(secretRaw, "base64url");
  const payload = {
    version: 1,
    authority,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3_600_000,
  };
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = createHmac("sha256", secret).update(body).digest();
  const token = `v1.${body}.${encodeBase64Url(signature)}`;
  const name = `dsh-auth-${createHash("sha256").update(authority).digest("base64url")}`;
  return `${name}=${token}`;
}

function resolveSecret() {
  try {
    return readSecret(readFileSync(join(home, ".credentials.yaml"), "utf8"));
  } catch (error) {
    console.error(`probe: credentials unreadable (${String(error.message)})`);
    return undefined;
  }
}

const authority = new URL(base).host;
const secret = resolveSecret();
const cookie = secret === undefined ? "" : cookieFor(secret, authority);

/** GET one path and print the first bytes of the body. */
async function probe(path) {
  const headers = cookie === "" ? {} : { cookie };
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

console.log(`probe: ${base} (authority ${authority}, cookie ${cookie === "" ? "unavailable" : "signed"})`);
await probe("/api/emote-chat/config");
await probe("/api/emote-chat/reactions?since=0");
await probe("/api/emote-chat/sticker?id=missing%2Fmissing");
await probe("/api/emote-chat/does-not-exist");
