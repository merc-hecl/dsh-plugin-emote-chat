/**
 * [INPUT]: Node crypto/fs 与 DSH settings describe/mutate 协议
 * [OUTPUT]: 配置及素材诊断，显式 --write 时执行 revision 保护的更新
 * [POS]: 开发集成诊断；默认只读，不通过文本编辑 profile
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
/**
 * Verification driver for a running dsh Web/Desktop process.
 *
 * It speaks the same wire protocol the Settings page uses: a credentialed POST
 * of a `client-request` envelope to `/api/settings/*`, the Connection bridge's
 * unary RPC channel. `settings/describe` reports each plugin's configurable
 * namespaces, and `settings/mutate` performs the write the page performs.
 *
 * Usage:
 *   node scripts/verify.mjs [--base <url>] [--pack <dir>] [--write] [--ns <id>]
 *
 * Without `--write` it only reads.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};
const has = (name) => argv.includes(`--${name}`);

const base = flag("base", process.env.DSH_WEB_URL ?? "http://127.0.0.1:19387").replace(/\/$/u, "");
const namespace = flag("ns", "emote-chat");
const packDir = flag("pack", undefined);
const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");

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

/**
 * POST one unary RPC call through the Connection bridge.
 *
 * The wire form is the generated Remote invocation: the endpoint is the
 * invocation id after `#` (slashes preserved), the payload carries `args`, and
 * the reply envelope is `{ result: { ok, value | error } }`.
 */
async function call(invocation, args) {
  const rpcId = randomUUID();
  const endpoint = invocation.slice(invocation.indexOf("#") + 1);
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId,
      method: endpoint,
      payload: { args: Array.isArray(args) ? { values: args } : args },
    }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) return { http: response.status, raw: text.slice(0, 600) };
  if (parsed.result?.ok === false) return { error: parsed.result.error };
  return { value: parsed.result?.value ?? parsed.result };
}

const describe = () =>
  call("@deepseek-ai/dsh-api-settings-controller#settings/describe", {});

/** Apply one live-field patch, retrying once on a revision conflict. */
async function patch(fields) {
  const ops = Object.entries(fields).map(([field, value]) => ({ op: "set", path: [field], value }));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const described = await describe();
    const entry = described.error === undefined ? described.value?.namespaces?.find((row) => row.ns === namespace) : undefined;
    if (entry === undefined) {
      console.log(`mutate: namespace "${namespace}" is not configurable`);
      console.log(`describe: ${JSON.stringify(described).slice(0, 900)}`);
      return false;
    }
    const response = await call("@deepseek-ai/dsh-api-settings-controller#settings/mutate", {
      ns: namespace,
      ops,
      expectedRevision: entry.revision,
    });
    if (response.error === undefined) return true;
    if (response.error.code !== "settings/conflict") {
      console.log(`mutate refused: ${JSON.stringify(response.error)}`);
      return false;
    }
  }
  return false;
}

/** GET one plugin route with the browser cookie. */
async function api(path) {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  const text = await response.text();
  return { status: response.status, type: response.headers.get("content-type"), text };
}

console.log(`verify: ${base} (namespace ${namespace})`);

const described = await describe();
if (described.error !== undefined) {
  console.log(`describe failed: ${JSON.stringify(described.error).slice(0, 400)}`);
} else {
  const namespaces = described.value?.namespaces ?? [];
  console.log(`describe: writable=${String(described.value?.writable)} hasDocument=${String(described.value?.hasDocument)} namespaces=${namespaces.length}`);
  const entry = namespaces.find((row) => row.ns === namespace);
  console.log(
    entry === undefined
      ? `namespace "${namespace}": MISSING`
      : `namespace "${namespace}": revision=${String(entry.revision)} value=${JSON.stringify(entry.value)}`,
  );
}

if (has("write")) {
  const wanted = { stickerReply: true, emojiReply: true };
  if (packDir !== undefined) wanted.paths = [packDir];
  const written = await patch(wanted);
  console.log(`settings write ${written ? "accepted" : "FAILED"}`);
  await new Promise((settle) => setTimeout(settle, 900));
}

const config = await api("/api/emote-chat/config");
console.log(`config ${config.status}: ${config.text.slice(0, 500)}`);

let parsed;
try {
  parsed = JSON.parse(config.text);
} catch {
  parsed = undefined;
}
const first = parsed?.packs?.[0]?.stickers?.[0];
if (first !== undefined) {
  const image = await api(`/api/emote-chat/sticker?id=${encodeURIComponent(first.id)}`);
  console.log(`sticker ${image.status} ${image.type} ${image.text.length} bytes (id ${first.id})`);
} else {
  console.log("sticker: no sticker in the catalog yet");
}
