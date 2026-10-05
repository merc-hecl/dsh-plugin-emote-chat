/**
 * [INPUT]: node:test、生成 bundle 与 dom-fixture
 * [OUTPUT]: 可逆贴纸投影的 DOM 回归
 * [POS]: 贴纸展示验证；用共享 DOM 夹具覆盖重渲染和原文还原
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

test("splitTokens separates prose from sticker tokens", () => {
  const { exports } = loadBundle();
  const { splitTokens } = exports.internals;
  // The bundle runs in its own VM realm, so compare structurally.
  assert.deepEqual(JSON.parse(JSON.stringify(splitTokens("hello"))), [
    { text: "hello" },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(splitTokens("hi [[sticker:whale/happy]] bye"))),
    [{ text: "hi " }, { token: "whale/happy" }, { text: " bye" }],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(splitTokens("[[sticker:a/b]][[sticker:c/d]]"))),
    [{ token: "a/b" }, { token: "c/d" }],
  );
});

test("findSticker resolves a pack/name id against the catalog", () => {
  const { exports } = loadBundle();
  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/happy", name: "happy" }],
      },
    ],
  };
  assert.equal(
    exports.internals.findSticker(catalog, "whale/happy")?.name,
    "happy",
  );
  assert.equal(
    exports.internals.findSticker(catalog, "whale/missing"),
    undefined,
  );
  assert.equal(
    exports.internals.findSticker(undefined, "whale/happy"),
    undefined,
  );
});

test("the sticker keeps the text intact and hoists its image", () => {
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "assistant-step");
  const paragraph = makeElement("p");
  const carrier = makeText("here you go [[sticker:whale/happy]]");
  carrier.closest = (selector) =>
    selector === "[data-chat-flow-kind]" ? root : null;
  paragraph.appendChild(carrier);
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/happy", name: "happy" }],
      },
    ],
  };
  exports.internals
    .createStickerPainter({
      t: (key) => key,
      getCatalog: () => catalog,
      isEnabled: () => true,
    })
    .scan();

  const figures = stickerFigures(root);
  assert.equal(figures.length, 1, "exactly one figure for one token");
  assert.equal(figures[0].getAttribute("data-emote-sticker"), "whale/happy");
  assert.equal(figures[0].getAttribute("data-side"), "left");

  // Invariant 1 — THE one that matters. Any surface comparing textContent to decide
  // "this message was modified" rewrites the DOM otherwise, and the image is lost.
  assert.equal(
    root.textContent,
    "here you go [[sticker:whale/happy]]",
    "textContent is byte-identical to what the user sent",
  );
  const ghost =
    [...(root.childNodes ?? [])].find(
      (node) => node.getAttribute?.("data-emote-hidden") != null,
    ) ??
    [...allElements(root)].find(
      (node) => node.getAttribute?.("data-emote-hidden") != null,
    );
  assert.ok(ghost, "the token survives in a hidden ghost");
  assert.equal(ghost.style.display, "none", "and the ghost is not visible");
  assert.equal(
    ghost.textContent,
    "[[sticker:whale/happy]]",
    "carrying the original tag verbatim",
  );

  // Invariant 2 — the image is hoisted, so it does not depend on where the token sat.
  assert.equal(
    root.childNodes[0],
    figures[0],
    "the figure is the first thing in the row",
  );
  assert.equal(
    visibleText(paragraph),
    "here you go ",
    "the paragraph keeps only the prose",
  );
});

test("a sticker followed by a sentence keeps the sentence", () => {
  // Reported live: \`[[sticker:memes/daily/ganfan]] 你能看到我发的表情包吗？\` showed only
  // the sticker. Both parts are ONE text node, so hiding or replacing the node itself
  // swallowed the question with the token.
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "user");
  const stack = makeElement("div");
  stack.className = "_userStack_abc123";
  const bubble = makeElement("div");
  bubble.className = "_bubble_abc123";
  const paragraph = makeElement("p");
  const carrier = makeText(
    "[[sticker:whale/happy]]\ncan you see this sticker?",
  );
  carrier.closest = (selector) =>
    selector === "[data-chat-flow-kind]" ? root : null;
  paragraph.appendChild(carrier);
  bubble.appendChild(paragraph);
  stack.appendChild(bubble);
  root.appendChild(stack);
  sandbox.document = chatDocument([root]);

  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/happy", name: "happy" }],
      },
    ],
  };
  exports.internals
    .createStickerPainter({
      t: (key) => key,
      getCatalog: () => catalog,
      isEnabled: () => true,
    })
    .scan();

  assert.equal(stickerFigures(root).length, 1, "the sticker is painted");
  assert.equal(
    visibleText(bubble),
    "can you see this sticker?",
    "the sentence survives, and the token's own line break goes with the token",
  );
  // The tag survives in the ghost; the newline that followed it is dropped from the
  // visible run, which is what removes the blank first line. Keeping the tag is the
  // property that matters: a surface comparing content still finds what the user sent,
  // so it has no reason to rewrite the DOM.
  assert.equal(
    bubble.textContent,
    "[[sticker:whale/happy]]\ncan you see this sticker?",
    "the tag is still there, minus the line break that caused the blank line",
  );
});

test("a token the catalog does not know stays as text", () => {
  // Hiding an unknown token would delete the user's words with nothing to replace
  // them, so only tokens that resolve are dropped from the visible text.
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "user");
  const paragraph = makeElement("p");
  paragraph.closest = (selector) =>
    selector === "[data-chat-flow-kind]" ? root : null;
  paragraph.appendChild(makeText("look [[sticker:ghost/missing]] here"));
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  exports.internals
    .createStickerPainter({
      t: (key) => key,
      getCatalog: () => ({ packs: [] }),
      isEnabled: () => true,
    })
    .scan();

  assert.equal(stickerFigures(root).length, 0, "nothing is painted");
  assert.equal(
    paragraph.textContent,
    "look [[sticker:ghost/missing]] here",
    "and the text is untouched",
  );
});

test("a scan before the settings load does not retire the message", () => {
  // This is the regression that left sticker tokens visible as raw text: the
  // first scan ran while settings were still loading, and the node was marked
  // as painted anyway, so it was never revisited. The user flow kind is also
  // what decides the sticker's side, so this asserts both.
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "user");
  const paragraph = makeElement("p");
  const carrier = makeText("[[sticker:whale/thanks]]");
  paragraph.appendChild(carrier);
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/thanks", name: "thanks" }],
      },
    ],
  };
  let enabled = false;
  let loaded = false;
  const painter = exports.internals.createStickerPainter({
    t: (key) => key,
    getCatalog: () => (loaded ? catalog : undefined),
    isEnabled: () => enabled,
  });

  painter.scan(); // settings not loaded yet
  assert.equal(stickerFigures(root).length, 0);

  enabled = true;
  painter.scan(); // settings loaded, catalog still missing
  assert.equal(stickerFigures(root).length, 0);
  assert.equal(
    carrier.parentElement,
    paragraph,
    "the carrier must not be wrapped before a sticker is placed",
  );

  loaded = true;
  // `closest` is only consulted once a sticker can actually be placed.
  carrier.closest = (selector) =>
    selector === "[data-chat-flow-kind]" ? root : null;
  painter.scan(); // both ready now
  const figures = stickerFigures(root);
  assert.equal(
    figures.length,
    1,
    "the message must still be painted once the catalog arrives",
  );
  assert.equal(figures[0].getAttribute("data-side"), "right");
});

test("a token the catalog does not know stays eligible for a later scan", () => {
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "assistant-step");
  const paragraph = makeElement("p");
  paragraph.closest = (selector) =>
    selector === "[data-chat-flow-kind]" ? root : null;
  paragraph.appendChild(makeText("[[sticker:whale/notyet]]"));
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  const empty = { packs: [] };
  const full = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/notyet", name: "notyet" }],
      },
    ],
  };
  let catalog = empty;
  const painter = exports.internals.createStickerPainter({
    t: (key) => key,
    getCatalog: () => catalog,
    isEnabled: () => true,
  });
  painter.scan();
  assert.equal(stickerFigures(root).length, 0);
  catalog = full;
  painter.scan();
  assert.equal(
    stickerFigures(root).length,
    1,
    "a newly added sticker folder must be able to paint an existing message",
  );
});

test("the painter ignores tokens inside code blocks", () => {
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "assistant-step");
  const pre = makeElement("pre");
  pre.closest = (selector) =>
    selector === "pre, code" ? pre : makeElement("div").closest(selector);
  const code = makeElement("code");
  code.closest = (selector) => (selector === "pre, code" ? pre : null);
  code.appendChild(makeText("[[sticker:whale/happy]]"));
  pre.appendChild(code);
  root.appendChild(pre);
  sandbox.document = chatDocument([root]);

  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/happy", name: "happy" }],
      },
    ],
  };
  exports.internals
    .createStickerPainter({
      t: (key) => key,
      getCatalog: () => catalog,
      isEnabled: () => true,
    })
    .scan();
  assert.equal(stickerFigures(root).length, 0);
});

test("the painter only paints message flow kinds", () => {
  // Verified against the desktop build: every flow item carries its node kind in
  // data-chat-flow-kind, and the process surfaces are NOT messages. The reasoning
  // preview legitimately mentions [[sticker:…]] while discussing it, which is how
  // a sticker once appeared inside the thinking block.
  const { exports, sandbox } = loadBundle();
  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/happy", name: "happy" }],
      },
    ],
  };
  const painter = () =>
    exports.internals.createStickerPainter({
      t: (key) => key,
      getCatalog: () => catalog,
      isEnabled: () => true,
    });

  for (const kind of [
    "turn-process",
    "turn-trigger",
    "turn-error",
    "turn-max-tokens",
    "turn-tail",
    "system-prompt",
    "tool-call",
    "unknown-surface",
  ]) {
    const flow = makeElement("div");
    flow.setAttribute("data-chat-flow-kind", kind);
    const paragraph = makeElement("p");
    paragraph.closest = (selector) =>
      selector === "[data-chat-flow-kind]" ? flow : null;
    paragraph.appendChild(makeText("here you go [[sticker:whale/happy]]"));
    flow.appendChild(paragraph);
    sandbox.document = chatDocument([flow]);
    painter().scan();
    assert.equal(
      stickerFigures(flow).length,
      0,
      `${kind} is not a message and must stay unpainted`,
    );
  }

  for (const kind of ["user", "steering", "assistant-step"]) {
    const flow = makeElement("div");
    flow.setAttribute("data-chat-flow-kind", kind);
    const paragraph = makeElement("p");
    paragraph.closest = (selector) =>
      selector === "[data-chat-flow-kind]" ? flow : null;
    paragraph.appendChild(makeText("here you go [[sticker:whale/happy]]"));
    flow.appendChild(paragraph);
    sandbox.document = chatDocument([flow]);
    painter().scan();
    assert.equal(
      stickerFigures(flow).length,
      1,
      `${kind} is a message and must be painted`,
    );
  }
});

test("a sticker on its own line leaves no blank line above the text", () => {
  // Reported live with an image attached: the bubble rendered an empty first line,
  // because a sticker is normally sent on a line of its own and the newline stayed
  // behind when the token was removed from the visible run.
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "user");
  const bubble = makeElement("div");
  bubble.className = "_bubble_abc123";
  const paragraph = makeElement("p");
  const carrier = makeText(
    "[[sticker:whale/happy]]\nI sent another sticker, take a look",
  );
  carrier.closest = (selector) =>
    selector === "[data-chat-flow-kind]" ? root : null;
  paragraph.appendChild(carrier);
  bubble.appendChild(paragraph);
  root.appendChild(bubble);
  sandbox.document = chatDocument([root]);

  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/happy", name: "happy" }],
      },
    ],
  };
  exports.internals
    .createStickerPainter({
      t: (key) => key,
      getCatalog: () => catalog,
      isEnabled: () => true,
    })
    .scan();

  const shown = visibleText(bubble);
  assert.equal(
    shown,
    "I sent another sticker, take a look",
    "no blank line above the text",
  );
  assert.ok(
    !shown.startsWith("\n"),
    "and the bubble does not open with a line break",
  );
});

test("an unresolvable tag keeps its own spacing", () => {
  // The trim only applies when every token resolved. A tag that stays visible must
  // keep the whitespace around it, or the tag would be glued to the prose.
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "user");
  const paragraph = makeElement("p");
  const carrier = makeText("look [[sticker:ghost/missing]] here");
  carrier.closest = (selector) =>
    selector === "[data-chat-flow-kind]" ? root : null;
  paragraph.appendChild(carrier);
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  exports.internals
    .createStickerPainter({
      t: (key) => key,
      getCatalog: () => ({ packs: [] }),
      isEnabled: () => true,
    })
    .scan();

  assert.equal(
    paragraph.textContent,
    "look [[sticker:ghost/missing]] here",
    "the tag and its spacing are untouched",
  );
});

test("a reclaimed sticker image is restored on the next scan", () => {
  // The image is inserted into DOM the chat renders, and a re-render can drop it. The
  // timing is not predictable from the plugin, so the painter keeps a record and puts
  // the image back — needed because the token now lives in a hidden ghost, so a later
  // scan cannot find it in the visible text any more.
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "user");
  const bubble = makeElement("div");
  bubble.className = "_bubble_abc123";
  const paragraph = makeElement("p");
  const carrier = makeText("[[sticker:whale/happy]]\ntake a look");
  carrier.closest = (selector) =>
    selector === "[data-chat-flow-kind]" ? root : null;
  paragraph.appendChild(carrier);
  bubble.appendChild(paragraph);
  root.appendChild(bubble);
  sandbox.document = chatDocument([root]);

  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/happy", name: "happy" }],
      },
    ],
  };
  const painter = exports.internals.createStickerPainter({
    t: (key) => key,
    getCatalog: () => catalog,
    isEnabled: () => true,
  });
  painter.scan();

  assert.equal(
    stickerFigures(root).length,
    1,
    "the first scan places the image",
  );
  const figure = stickerFigures(root)[0];

  // Stand in for the chat dropping it.
  figure.remove();
  assert.equal(stickerFigures(root).length, 0, "the row is now bare");
  assert.ok(
    root.textContent.includes("[[sticker:whale/happy]]"),
    "the tag is still in the text, via the ghost, so a rescan has something to find",
  );

  painter.scan();
  const restored = stickerFigures(root);
  assert.equal(restored.length, 1, "the next scan puts the image back");
  assert.equal(restored[0].getAttribute("data-emote-sticker"), "whale/happy");
  assert.equal(
    painter.hasWork(),
    true,
    "and the pass reports that it did something",
  );
  assert.equal(stickerFigures(root).length, 1, "with no duplicate");
});

test("a rebuilt row is painted from scratch", () => {
  // If the whole row is replaced, the remembered host is detached too; the painter
  // must drop the stale record and treat the new row as unprocessed.
  const { exports, sandbox } = loadBundle();
  const build = () => {
    const root = makeElement("div");
    root.setAttribute("data-chat-flow-kind", "user");
    const stack = makeElement("div");
    stack.className = "_userStack_abc123";
    const bubble = makeElement("div");
    bubble.className = "_bubble_abc123";
    const paragraph = makeElement("p");
    const carrier = makeText("[[sticker:whale/happy]] take a look");
    carrier.closest = (selector) =>
      selector === "[data-chat-flow-kind]" ? root : null;
    paragraph.appendChild(carrier);
    bubble.appendChild(paragraph);
    stack.appendChild(bubble);
    root.appendChild(stack);
    return { root, stack };
  };

  const first = build();
  sandbox.document = chatDocument([first.root]);
  const catalog = {
    packs: [
      {
        id: "whale",
        name: "whale",
        stickers: [{ id: "whale/happy", name: "happy" }],
      },
    ],
  };
  const painter = exports.internals.createStickerPainter({
    t: (key) => key,
    getCatalog: () => catalog,
    isEnabled: () => true,
  });
  painter.scan();
  assert.equal(
    stickerFigures(first.root).length,
    1,
    "the first row is painted",
  );

  // A different row object with the token still in its text, as a fresh render gives.
  const second = build();
  sandbox.document = chatDocument([second.root]);
  painter.scan();

  assert.equal(
    stickerFigures(second.root).length,
    1,
    "the rebuilt row is painted too",
  );
  assert.equal(
    stickerFigures(second.root).length,
    1,
    "exactly one figure — no duplicate from the stale record",
  );
  assert.equal(
    stickerFigures(first.root).length,
    1,
    "and the old row is untouched",
  );
});

test("sticker disable and unload restore exact original text including whitespace", () => {
  const { exports, sandbox } = loadBundle();
  const row = makeElement("div");
  row.setAttribute("data-chat-flow-kind", "user");
  const paragraph = makeElement("p");
  const original = "[[sticker: whale/happy ]]\n  hello\n";
  paragraph.appendChild(makeText(original));
  row.appendChild(paragraph);
  sandbox.document = chatDocument([row]);
  let enabled = true;
  const painter = exports.internals.createStickerPainter({
    getCatalog: () => ({
      packs: [{ id: "whale", stickers: [{ id: "whale/happy" }] }],
    }),
    isEnabled: () => enabled,
    t: (key) => key,
  });
  painter.scan();
  assert.equal(row.textContent, original);
  assert.equal(stickerFigures(row).length, 1);
  enabled = false;
  painter.scan();
  assert.equal(row.textContent, original);
  assert.equal(stickerFigures(row).length, 0);
  enabled = true;
  painter.scan();
  painter.dispose();
  assert.equal(row.textContent, original);
  assert.equal(stickerFigures(row).length, 0);
});
