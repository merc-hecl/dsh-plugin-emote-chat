/**
 * [INPUT]: 当前 DSH browser-session grant、Node fs/crypto 与目标 authority
 * [OUTPUT]: browserCookie、readSecret、signCookie
 * [POS]: 三个本地诊断脚本共享的当前认证协议；缺失 grant 时明确失败
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readSecret(text) {
  let inRecord = false;
  for (const line of text.split(/\r?\n/u)) {
    if ((/^\S/u.test(line) || /^\s{2}\S/u.test(line)) && line.trim() !== "") inRecord = false;
    if (/^\s{2}client-connection\/browser-session:\s*$/u.test(line)) {
      inRecord = true;
      continue;
    }
    if (!inRecord) continue;
    const match = /^\s+secret\s*:\s*(\S+)\s*$/u.exec(line);
    if (match !== null) return match[1].replace(/^["']|["']$/gu, "");
  }
  throw new Error("DSH browser-session grant has no secret");
}

export function signCookie(secretRaw, authority, now = Date.now()) {
  const secret = Buffer.from(secretRaw, "base64url");
  if (secret.length === 0) throw new Error("DSH browser-session secret is empty");
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 3_600_000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  const name = "dsh-auth-" + createHash("sha256").update(authority).digest("base64url");
  return `${name}=v1.${body}.${signature}`;
}

export function browserCookie(base) {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const secret = readSecret(readFileSync(join(home, ".credentials.yaml"), "utf8"));
  return signCookie(secret, new URL(base).host);
}
