/**
 * [INPUT]: node:test、共享诊断认证模块与固定测试 grant
 * [OUTPUT]: grant 隔离、签名、authority 与过期时间的当前协议回归
 * [POS]: 诊断脚本协议测试；不读取用户凭据，不连接实际宿主
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readSecret, signCookie } from "../scripts/auth.mjs";

test("diagnostics read only the browser-session grant and reject missing secrets", () => {
  const yaml = 'grants:\n  other/grant:\n    secret: wrong\n  client-connection/browser-session:\n    secret: "c2VjcmV0"\n  next/grant:\n    secret: another\n';
  assert.equal(readSecret(yaml), "c2VjcmV0");
  assert.equal(readSecret(yaml.replaceAll("\n", "\r\n")), "c2VjcmV0");
  assert.throws(() => readSecret('grants:\n  client-connection/browser-session:\n    other: value\n  next/grant:\n    secret: unrelated\n'), /no secret/);
  assert.throws(() => readSecret('grants:\n  other/grant:\n    secret: unrelated\n'), /no secret/);
});

test("diagnostic cookie binds its signed payload to authority and lifetime", () => {
  const authority = "127.0.0.1:19387", now = 1_000;
  const secret = Buffer.from("test-only-key");
  const cookie = signCookie(secret.toString("base64url"), authority, now);
  const [name, token] = cookie.split("=");
  assert.equal(name, "dsh-auth-" + createHash("sha256").update(authority).digest("base64url"));
  const [version, body, signature] = token.split(".");
  assert.equal(version, "v1");
  assert.deepEqual(JSON.parse(Buffer.from(body, "base64url").toString()), {
    version: 1, authority, issuedAt: now, expiresAt: now + 3_600_000,
  });
  assert.equal(signature, createHmac("sha256", secret).update(body).digest("base64url"));
  assert.notEqual(signCookie(secret.toString("base64url"), "localhost:19387", now), cookie);
  assert.throws(() => signCookie("", authority), /empty/);
});
