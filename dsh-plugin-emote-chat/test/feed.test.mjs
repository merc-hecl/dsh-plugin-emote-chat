/**
 * [INPUT]: node:test、浏览器 bundle 与可控计时器/HTTP
 * [OUTPUT]: 客户端快照、重启、节流和取消行为回归
 * [POS]: 订阅协议的消费者测试，模拟实际响应而非复刻 Host 实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBundle } from "./dom-fixture.mjs";
const drain = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function feedHarness(payloads) {
  const { exports, sandbox } = loadBundle();
  let calls = 0;
  const timers = new Map();
  let timerId = 0;
  sandbox.setTimeout = (cb, ms) => {
    const id = ++timerId;
    timers.set(id, { cb, ms });
    return id;
  };
  sandbox.clearTimeout = (id) => timers.delete(id);
  sandbox.fetch = async () => {
    const payload = payloads[Math.min(calls++, payloads.length - 1)];
    return { ok: true, json: async () => payload };
  };
  const feed = exports.internals.createReactionFeed();
  return {
    feed,
    timers,
    calls: () => calls,
    next: async () => {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.cb();
      await drain();
    },
  };
}
test("feed replaces clear snapshots and resets live status on process epoch changes", async () => {
  const row = (seq, emoji) => ({
    seq,
    emoji,
    messageId: "abc",
    at: Date.now(),
  });
  const app = feedHarness([
    { epoch: "a", seq: 1, enabled: true, reactions: [row(1, "✅")] },
    {
      epoch: "a",
      seq: 2,
      enabled: true,
      reactions: [row(1, "✅"), row(2, "🎉")],
    },
    { epoch: "a", seq: 3, enabled: true, reactions: [] },
    { epoch: "b", seq: 1, enabled: true, reactions: [row(1, "👍")] },
  ]);
  try {
    await drain();
    assert.equal(app.feed.store.get().entries[0].live, false);
    await app.next();
    assert.equal(app.feed.store.get().entries[1].live, true);
    await app.next();
    assert.equal(app.feed.store.get().entries.length, 0);
    await app.next();
    assert.equal(app.feed.store.get().entries[0].live, false);
    assert.equal(app.feed.store.get().entries[0].key, "b:1");
  } finally {
    app.feed.dispose();
  }
});
test("disabled response is throttled and disposing cancels its timer", async () => {
  const app = feedHarness([
    { epoch: "a", seq: 0, enabled: false, reactions: [] },
  ]);
  await drain();
  assert.equal(app.calls(), 1);
  assert.ok([...app.timers.values()][0].ms >= 2400);
  app.feed.dispose();
  await drain();
  assert.equal(app.timers.size, 0);
  assert.equal(app.calls(), 1);
});
test("dispose aborts an in-flight request", async () => {
  const { exports, sandbox } = loadBundle();
  let signal;
  sandbox.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      ),
    );
  };
  const feed = exports.internals.createReactionFeed();
  assert.equal(signal.aborted, false);
  feed.dispose();
  await drain();
  assert.equal(signal.aborted, true);
});
