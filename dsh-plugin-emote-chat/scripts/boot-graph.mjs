/**
 * [INPUT]: Node crypto/fs 与本地 DSH 浏览器会话认证
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

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const base = (process.argv[2] ?? process.env.DSH_WEB_URL ?? "http://127.0.0.1:19387").replace(/\/$/u, "");
const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const packageName = "dsh-plugin-emote-chat";

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

const encodeBase64Url = (value) =>
  Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const authority = new URL(base).host;
const secret = Buffer.from(readSecret(readFileSync(join(home, ".credentials.yaml"), "utf8")), "base64url");
const payload = { version: 1, authority, issuedAt: Date.now(), expiresAt: Date.now() + 3_600_000 };
const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
const cookie = `dsh-auth-${createHash("sha256").update(authority).digest("base64url")}=v1.${body}.${encodeBase64Url(
  createHmac("sha256", secret).update(body).digest(),
)}`;

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
