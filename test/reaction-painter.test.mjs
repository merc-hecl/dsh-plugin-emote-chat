/**
 * [INPUT]: node:test、生成 bundle 与 dom-fixture
 * [OUTPUT]: 消息回应胶囊与 emoji 雨的 DOM 回归
 * [POS]: 回应展示验证；用共享 DOM 夹具覆盖身份、重启和释放
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadBundle,
  makeElement,
  makeText,
  chatDocument,
  visibleText,
  stickerFigures,
  chipRows,
  hiddenCarriers,
  allElements,
} from "./dom-fixture.mjs";

test("the reaction painter puts chips inside the user bubble", () => {
  // The chat renders flow > userRow > userStack > bubble, and the bubble reports
  // `display: block` with its own padding — so appending the row INSIDE it gives
  // the row its own line under the message, aligned with the text, with no
  // positioning needed. That is what the design calls for: a reaction strip at the
  // foot of the message, like a card.
  const { exports, sandbox } = loadBundle();
  const build = (key) => {
    const flow = makeElement("div");
    flow.setAttribute("data-chat-flow-kind", "user");
    flow.setAttribute("data-chat-node-key", key);
    const row = makeElement("div");
    const stack = makeElement("div");
    stack.className = "_userStack_abc123";
    const bubble = makeElement("div");
    bubble.className = "_bubble_abc123";
    bubble.appendChild(makeText("hello"));
    stack.appendChild(bubble);
    row.appendChild(stack);
    flow.appendChild(row);
    return { flow, stack, bubble };
  };
  const first = build("n1");
  const second = build("n2");
  sandbox.document = chatDocument([first.flow, second.flow]);

  // A reaction binds only to the message it names.
  const entries = [{ seq: 1, emoji: "🎉", messageKey: "n2", at: Date.now() }];
  exports.internals
    .createReactionPainter({ t: (key) => key, getEntries: () => entries })
    .scan();

  const chips = chipRows(second.bubble);
  assert.equal(chips.length, 1, "the chip row lives inside the bubble");
  assert.equal(chips[0].textContent, "🎉");
  assert.equal(
    chips[0].parentElement,
    second.bubble,
    "inside the bubble, not beside it",
  );
  assert.equal(
    second.bubble.childNodes.length,
    2,
    "the message text and the reaction row",
  );
  assert.equal(
    chipRows(first.bubble).length,
    0,
    "an unrelated message stays clean",
  );
  assert.equal(
    chipRows(first.stack).length,
    0,
    "and nothing lands outside a bubble either",
  );
});

test("reactionHost is the bubble, with sensible fallbacks", () => {
  const { exports } = loadBundle();
  const { reactionHost } = exports.internals;
  const flow = makeElement("div");
  const row = makeElement("div");
  const stack = makeElement("div");
  stack.className = "_userStack_xyz";
  const bubble = makeElement("div");
  // The lookup is by class fragment, so a fixture without a class is not a bubble
  // as far as this code is concerned — that omission is what made the assertion
  // below fail while the implementation was correct.
  bubble.className = "_bubble_xyz";
  bubble.appendChild(makeText("hi"));
  stack.appendChild(bubble);
  row.appendChild(stack);
  flow.appendChild(row);
  assert.equal(
    reactionHost(flow),
    bubble,
    "the bubble is the host, so the row sits at the foot of the message",
  );
  const bare = makeElement("div");
  assert.equal(reactionHost(bare), bare, "a bare flow item is its own host");
  const shallow = makeElement("div");
  const only = makeElement("div");
  shallow.appendChild(only);
  assert.equal(reactionHost(shallow), only, "one level down is the fallback");
  const named = makeElement("div");
  const namedStack = makeElement("div");
  namedStack.className = "_userStack_abc";
  named.appendChild(namedStack);
  assert.equal(
    reactionHost(named),
    namedStack,
    "a stack is used when no bubble is found",
  );
});

test("reactionHost anchors on the bubble with the desktop build's class names", () => {
  // The desktop bundle uses CSS-module hashes of the shape `cJsG2q_bubble`
  // (prefix, no leading underscore), and its user row nests as
  // `flow > userRow > userStack > bubble`. The first version matched
  // `_bubble_` and dived by firstElementChild, so the chips landed in the row
  // BESIDE the bubble — reported live as host "cJsG2q_userRow".
  const { exports } = loadBundle();
  const flow = makeElement("div");
  const row = makeElement("div");
  row.className = "cJsG2q_userRow";
  const stack = makeElement("div");
  stack.className = "cJsG2q_userStack";
  const bubble = makeElement("div");
  bubble.className = "cJsG2q_bubble";
  bubble.appendChild(makeText("hello"));
  stack.appendChild(bubble);
  row.appendChild(stack);
  flow.appendChild(row);
  assert.equal(
    exports.internals.reactionHost(flow),
    bubble,
    "the bubble holds the reaction row",
  );
});

test("reactionHost falls back to the row when no bubble element is found", () => {
  // Some layouts skip the bubble wrapper; the row is then the best available host.
  const { exports } = loadBundle();
  const flow = makeElement("div");
  const row = makeElement("div");
  row.className = "cJsG2q_userRow";
  const inner = makeElement("div");
  inner.appendChild(makeText("hi"));
  row.appendChild(inner);
  flow.appendChild(row);
  assert.equal(exports.internals.reactionHost(flow), row);
});

test("reaction decoration is hidden from the accessibility tree", () => {
  // 胶囊位于消息容器内；aria-hidden 只隔离读屏，不改变 DOM textContent。
  const { exports, sandbox } = loadBundle();
  const build = (key) => {
    const flow = makeElement("div");
    flow.setAttribute("data-chat-flow-kind", "user");
    flow.setAttribute("data-chat-node-key", key);
    const row = makeElement("div");
    const stack = makeElement("div");
    stack.className = "_userStack_abc123";
    const bubble = makeElement("div");
    bubble.className = "_bubble_abc123";
    bubble.appendChild(makeText("hello"));
    stack.appendChild(bubble);
    row.appendChild(stack);
    flow.appendChild(row);
    return { flow, stack, bubble };
  };
  const only = build("13:input-messageaaaabbbb");
  sandbox.document = chatDocument([only.flow]);

  exports.internals
    .createReactionPainter({
      t: (key) => key,
      getEntries: () => [
        { seq: 1, emoji: "✅", messageKey: "13:input-messageaaaabbbb" },
      ],
    })
    .scan();

  const chips = chipRows(only.bubble);
  assert.equal(chips.length, 1, "the row is created inside the bubble");
  assert.equal(
    chips[0].getAttribute("aria-hidden"),
    "true",
    "and is hidden from the message's text",
  );
  assert.equal(
    chips[0].parentElement,
    only.bubble,
    "the row sits at the foot of the message",
  );
  assert.equal(
    [...(only.bubble.childNodes ?? [])].filter(
      (node) => node.className === "_bubble_abc123",
    ).length,
    0,
    "no nested bubble was created",
  );
});

test("cleared snapshot removes a chip from a still-visible message", () => {
  const { exports, sandbox } = loadBundle();
  const row = makeElement("div");
  row.setAttribute("data-chat-flow-kind", "user");
  row.setAttribute("data-chat-node-key", "1:input-messageabc");
  sandbox.document = chatDocument([row]);
  let entries = [{ seq: 1, emoji: "🎉", messageId: "abc" }];
  const painter = exports.internals.createReactionPainter({
    getEntries: () => entries,
    t: (key) => key,
  });
  painter.scan();
  assert.equal(chipRows(row).length, 1);
  entries = [];
  painter.scan();
  assert.equal(chipRows(row).length, 0);
});

test("restarted host with reused sequence updates the visible reaction", () => {
  const { exports, sandbox } = loadBundle();
  const row = makeElement("div");
  row.setAttribute("data-chat-flow-kind", "user");
  row.setAttribute("data-chat-node-key", "1:input-messageabc");
  sandbox.document = chatDocument([row]);
  let entries = [{ seq: 1, key: "old:1", emoji: "🎉", messageId: "abc" }];
  const painter = exports.internals.createReactionPainter({
    getEntries: () => entries,
  });
  painter.scan();
  entries = [{ seq: 1, key: "new:1", emoji: "✅", messageId: "abc" }];
  painter.scan();
  assert.equal(chipRows(row)[0].textContent, "✅");
});

test("rain keeps a complete emoji and releases its layers on unload", () => {
  const { exports, sandbox } = loadBundle();
  const body = makeElement("body");
  sandbox.document = { body, createElement: makeElement };
  const layer = exports.internals.rain("👨‍👩‍👧‍👦", 2);
  assert.deepEqual(
    layer.childNodes.map((node) => node.textContent),
    ["👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦"],
  );
  exports.internals.disposeRain();
  assert.equal(body.childNodes.length, 0);
});

test("reduced motion prevents rain from creating a layer", () => {
  const { exports, sandbox } = loadBundle();
  const body = makeElement("body");
  sandbox.document = { body, createElement: makeElement };
  sandbox.window.matchMedia = () => ({ matches: true });
  assert.equal(exports.internals.rain("🎉", 2), undefined);
  assert.equal(body.childNodes.length, 0);
});
