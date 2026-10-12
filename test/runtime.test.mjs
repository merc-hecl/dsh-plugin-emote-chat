/**
 * [INPUT]: node:test、真实客户端 apply 与受控宿主/网络/计时器
 * [OUTPUT]: 卸载释放、重新加载、配置订阅和在途请求取消回归
 * [POS]: 客户端生命周期集成测试；观察实际资源，不以注册数量代替清理验证
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeHarness, flush } from "./runtime-fixture.mjs";
import { makeElement, makeText, stickerFigures, chipRows, allElements } from "./dom-fixture.mjs";

test("unload releases resources and reload creates one fresh subscription", async (t) => {
  const app = runtimeHarness({ fetch: async (url, { signal }) => {
    if (url.includes("/reactions?")) return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new DOMException("unloaded", "AbortError")), { once: true }));
    return { ok: true, json: async () => ({ emojiReply: true, paths: [], packs: [] }) };
  } });
  t.after(() => app.dispose());
  const first = app.mount();
  await flush();
  app.tick(1200);
  await flush();
  assert.equal(app.observers.filter((o) => o.active).length, 1);
  assert.equal(app.intervals.size, 2);
  assert.equal(app.frames.size, 1);
  assert.equal(app.slots.length, 3);
  assert.equal(app.dictionaries.size, 1);
  assert.equal(app.head.childNodes.length, 1);
  assert.equal(first.debug().reactions.feedCount, 1);
  const firstRequests = [...app.requests];
  app.dispose();
  await flush();
  assert.ok(firstRequests.every(({ options }) => options.signal.aborted));
  assert.equal(app.observers.filter((o) => o.active).length, 0);
  assert.equal(app.intervals.size, 0);
  assert.equal(app.timers.size, 0);
  assert.equal(app.frames.size, 0);
  assert.equal(app.slots.length, 0);
  assert.equal(app.dictionaries.size, 0);
  assert.equal(app.head.childNodes.length, 0);
  assert.equal(app.sandbox.window.__emoteChat, undefined);
  first.configStore.set({ data: { emojiReply: true } });
  assert.equal(app.frames.size, 0, "the old store no longer schedules DOM work");
  const second = app.mount();
  assert.notEqual(second, first);
  await flush();
  app.tick(1200);
  app.tick(1200);
  await flush();
  assert.equal(app.observers.filter((o) => o.active).length, 1);
  assert.equal(app.intervals.size, 2);
  assert.equal(app.slots.length, 3);
  assert.equal(app.head.childNodes.length, 1);
  assert.equal(second.debug().reactions.feedCount, 1);
  assert.equal(app.requests.filter(({ url }) => url.includes("/reactions?")).length, 2);
  assert.ok(app.requests.slice(firstRequests.length).every(({ options }) => !options.signal.aborted));
});

test("unload removes projected stickers, reaction chips and rain while preserving message text", async (t) => {
  const row = makeElement("div");
  row.setAttribute("data-chat-flow-kind", "user");
  row.setAttribute("data-chat-node-key", "1:input-messageabc");
  const original = "[[sticker:cats/happy]]\n hello";
  const stack = makeElement("div"), bubble = makeElement("div"), paragraph = makeElement("p");
  stack.className = "cJsG2q_userStack";
  bubble.className = "cJsG2q_bubble";
  paragraph.appendChild(makeText(original));
  bubble.appendChild(paragraph);
  stack.appendChild(bubble);
  row.appendChild(stack);
  const app = runtimeHarness({ roots: [row], fetch: async (url) => ({
    ok: true, json: async () => url.includes("/reactions?")
      ? { epoch: "test", seq: 1, reactions: [{ seq: 1, messageId: "abc", emoji: "🎉" }] }
      : { stickerReply: true, emojiReply: true, packs: [{ id: "cats", stickers: [{ id: "cats/happy" }] }] },
  }) });
  t.after(() => app.dispose());
  app.mount();
  await flush();
  app.frame();
  await flush();
  app.frame();
  app.exports.internals.rain("🎉", 2);
  assert.equal(stickerFigures(row).length, 1);
  assert.equal(chipRows(row).length, 1);
  assert.ok(allElements(row).some((node) => node.hasAttribute?.("data-emote-hidden")));
  assert.equal(app.body.childNodes.length, 2, "the message and rain layer are mounted");
  app.dispose();
  await flush();
  assert.equal(stickerFigures(row).length, 0);
  assert.equal(chipRows(row).length, 0);
  assert.ok(!allElements(row).some((node) => node.hasAttribute?.("data-emote-hidden")));
  assert.equal(row.textContent, original);
  assert.equal(app.body.childNodes.length, 1);
  assert.equal(app.timers.size, 0);
});

test("unload cancels feed backoff and disables future polling", async (t) => {
  const app = runtimeHarness({ fetch: async (url) => ({
    ok: true, json: async () => url.includes("/reactions?")
      ? { epoch: "test", seq: 0, reactions: [] }
      : { emojiReply: true, paths: [], packs: [] },
  }) });
  t.after(() => app.dispose());
  app.mount();
  await flush();
  app.tick(1200);
  await flush();
  app.frame();
  assert.equal(app.timers.size, 1, "the live feed is waiting to poll again");
  const before = app.requests.length;
  app.dispose();
  await flush();
  app.tick(1200);
  app.tick(5000);
  app.frame();
  assert.equal(app.timers.size, 0);
  assert.equal(app.requests.length, before);
});

test("a late config response after unload cannot overwrite the reloaded runtime", async (t) => {
  let complete;
  const app = runtimeHarness({ fetch: () => app.requests.length === 1
    ? new Promise((resolve) => { complete = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ paths: ["new"], emojiReply: false }) }),
  });
  t.after(() => app.dispose());
  const first = app.mount();
  app.dispose();
  assert.equal(app.requests[0].options.signal.aborted, true);
  const second = app.mount();
  await flush();
  complete({ ok: true, json: async () => ({ paths: ["stale"], emojiReply: true }) });
  await flush();
  assert.equal(first.configStore.get().data, undefined);
  assert.deepEqual(Array.from(second.configStore.get().data.paths), ["new"]);
  assert.equal(app.sandbox.window.__emoteChat, second);
});
