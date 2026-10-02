import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");

/** Load the browser bundle in a VM and return its exports. */
function loadBundle() {
  let registration;
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => (registration = def) } },
    document: {
      head: { appendChild() {} },
      body: { appendChild() {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeElement(tag),
      createTextNode: (value) => makeText(value),
    },
    require: (spec) => {
      if (spec === "react") {
        return {
          createElement: () => null,
          useState: (v) => [v, () => {}],
          useEffect: () => {},
          useRef: () => ({ current: null }),
          useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        };
      }
      if (spec === "@deepseek-ai/dsh-client-ui-primitives") {
        // The bundle uses the shipped Switch / Button / icon primitives. The vm
        // has no DOM to mount them into, so the stub only has to exist and be
        // callable; the real elements are the harness's own components.
        const passthrough = (tag) => (props) => ({ tag, props });
        return {
          Switch: passthrough("button"),
          Button: passthrough("button"),
          Input: passthrough("input"),
          IconCloseOutlineRegular: passthrough("svg"),
          IconPlusOutlineRegular: passthrough("svg"),
        };
      }
      if (spec === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      throw new Error(`unexpected require("${spec}")`);
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    NodeFilter: { SHOW_TEXT: 4 },
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(bundlePath, "utf8"), sandbox, { filename: "lib/client.js" });
  return { exports: registration.factory(sandbox.require), sandbox };
}

// ───────────────────────────── a very small DOM ──────────────────────────────

/** Create a stub element. */
function makeElement(tag) {
  const classes = new Set();
  const element = {
    tagName: String(tag).toUpperCase(),
    /** A real element node. Declared so mixed content can be inspected by type. */
    nodeType: 1,
    childNodes: [],
    attributes: {},
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    // `className` and `classList` are two views of one set, like a real element:
    // the painter assigns `className` while the tests (and `dispose`) read
    // `classList`.
    get className() {
      return [...classes].join(" ");
    },
    set className(value) {
      classes.clear();
      for (const name of String(value).split(/\s+/u)) if (name !== "") classes.add(name);
    },
    style: { setProperty() {} },
    get parentElement() {
      return element.__parent ?? null;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    hasAttribute(name) {
      return Object.hasOwn(element.attributes, name);
    },
    getAttribute(name) {
      return Object.hasOwn(element.attributes, name) ? element.attributes[name] : null;
    },
    appendChild(child) {
      child.__parent = element;
      element.childNodes.push(child);
      return child;
    },
    insertBefore(child, before) {
      // A fragment contributes its children, not itself.
      if (child.nodeType === 11) {
        for (const inner of [...child.childNodes]) element.insertBefore(inner, before);
        return child;
      }
      // Moving a node detaches it from where it was, exactly like the real DOM.
      // Without this the same node sits in two parents at once, so hoisting an image
      // to the row left a duplicate behind in the bubble.
      if (child.__parent != null && child.__parent !== element) {
        child.__parent.childNodes = child.__parent.childNodes.filter((c) => c !== child);
      }
      child.__parent = element;
      const at = element.childNodes.indexOf(before);
      if (at === -1) element.childNodes.push(child);
      else element.childNodes.splice(at, 0, child);
      return child;
    },
    append(...children) {
      for (const child of children) element.appendChild(child);
      return undefined;
    },
    after(sibling) {
      const parent = element.parentElement;
      if (parent === null) return;
      parent.insertBefore(sibling, element.nextSibling());
    },
    before(sibling) {
      const parent = element.parentElement;
      if (parent === null) return;
      parent.insertBefore(sibling, element);
    },
    nextSibling() {
      const parent = element.parentElement;
      if (parent === null) return null;
      const at = parent.childNodes.indexOf(element);
      return parent.childNodes[at + 1] ?? null;
    },
    remove() {
      const parent = element.parentElement;
      if (parent === null) return;
      parent.childNodes = parent.childNodes.filter((child) => child !== element);
      // Detach completely. Leaving __parent set made a removed node still answer
      // parentElement, which defeated every "is it still attached?" check.
      element.__parent = null;
    },
    replaceChildren(...children) {
      element.childNodes = [];
      for (const child of children) element.appendChild(child);
    },
    replaceChild(next, previous) {
      const at = element.childNodes.indexOf(previous);
      if (at === -1) return previous;
      previous.__parent = null;
      const incoming = next.nodeType === 11 ? [...next.childNodes] : [next];
      for (const inner of incoming) inner.__parent = element;
      element.childNodes.splice(at, 1, ...incoming);
      return previous;
    },
    addEventListener() {},
    set textContent(value) {
      element.childNodes = [];
      if (value !== "") element.appendChild(makeText(value));
    },
    get textContent() {
      return element.childNodes.map((child) => child.textContent ?? "").join("");
    },
    get firstChild() {
      return element.childNodes[0] ?? null;
    },
    get firstElementChild() {
      return element.childNodes.find((child) => child.tagName !== undefined) ?? null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      // Real traversal for the one selector this code looks up: descendants by
      // tag name. Answering everything with an empty list silently disabled
      // findClassFragment, so a host lookup that should have found the bubble
      // always took its fallback branch instead.
      const tag = String(selector).toUpperCase();
      return allElements(element).filter(
        (node) => typeof node.tagName === "string" && node.tagName === tag,
      );
    },
    closest(selector) {
      // The painter's lookups, in the selectors it actually uses. Anything else
      // must miss, like a real DOM with no matching ancestor.
      if (selector === "p") {
        let node = element;
        while (node !== null && node !== undefined) {
          if (node.tagName === "P") return node;
          node = node.__parent ?? null;
        }
        return null;
      }
      const attributeOf = (node) => {
        if (selector === "pre, code") return node.tagName === "PRE" || node.tagName === "CODE" ? node : undefined;
        if (selector === "[data-chat-flow-kind]") return node.hasAttribute?.("data-chat-flow-kind") ? node : undefined;
        if (selector === "[data-emote-sticker]") return node.hasAttribute?.("data-emote-sticker") ? node : undefined;
        if (selector === "[data-emote-chips]") return node.hasAttribute?.("data-emote-chips") ? node : undefined;
        if (selector === "div[class*=\"_userStack\"]") {
          return typeof node.className === "string" && node.className.includes("_userStack") ? node : undefined;
        }
        // The non-message region list, plus the tool-card anchor prefix.
        if (selector.includes("data-step-process")) {
          for (const name of ["data-step-process", "data-step-process-body", "data-step-process-content"]) {
            if (node.hasAttribute?.(name)) return node;
          }
          return undefined;
        }
        if (selector.includes("data-chat-anchor-key")) {
          const anchor = node.getAttribute?.("data-chat-anchor-key");
          return typeof anchor === "string" && anchor.startsWith("call:") ? node : undefined;
        }
        return undefined;
      };
      let node = element;
      while (node !== null) {
        const hit = attributeOf(node);
        if (hit !== undefined) return hit;
        node = node.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      // The stub keeps an explicit child tree; a descendant sweep covers every
      // selector the painters use.
      for (const child of allElements(element)) {
        if (selector === "div") {
          if (child.tagName === "DIV") return child;
          continue;
        }
        if (selector === "[data-emote-sticker]" && child.hasAttribute?.("data-emote-sticker")) return child;
        if (selector === "[data-emote-chips]" && child.hasAttribute?.("data-emote-chips")) return child;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== "div") return [];
      return allElements(element).filter((child) => child.tagName === "DIV");
    },
  };
  element.ownerDocument = null;
  return element;
}

/** Create a stub text node. */
function makeText(value) {
  const node = {
    nodeType: 3,
    /** Text nodes are leaves, but traversal helpers read this uniformly. */
    childNodes: [],
    __parent: null,
    get parentElement() {
      return node.__parent ?? null;
    },
    get textContent() {
      return node.nodeValue;
    },
    nodeValue: value,
  };
  return node;
}

/**
 * Install a document whose `[data-chat-flow-kind]` query returns the given
 * roots, and whose TreeWalker walks each root's text nodes in order.
 */
function chatDocument(roots) {
  return {
    querySelectorAll(selector) {
      if (selector === "[data-chat-flow-kind]") return roots;
      if (selector === '[data-chat-flow-kind="user"]') {
        return roots.filter((root) => root.getAttribute("data-chat-flow-kind") === "user");
      }
      if (selector === ".ec-hidden-token") {
        return roots.flatMap((root) => hiddenCarriers(root));
      }
      if (selector === "[data-emote-sticker]") {
        return roots.flatMap((root) => stickerFigures(root));
      }
      return [];
    },
    createElement: (tag) => makeElement(tag),
    createDocumentFragment() {
      // A fragment is inserted by its children, like the real thing. The painter
      // rebuilds one text node as prose + image + ghost through this.
      const fragment = makeElement("#fragment");
      fragment.nodeType = 11;
      return fragment;
    },

    createTextNode: (value) => makeText(value),
    createTreeWalker(root) {
      const texts = allElements(root).filter((node) => node.nodeType === 3);
      let index = -1;
      return {
        nextNode() {
          index += 1;
          return texts[index] ?? null;
        },
      };
    },
  };
}

/** Every DESCENDANT of one node (the node itself excluded), plus text nodes. */
function allElements(root) {
  const out = [];
  const visit = (node) => {
    for (const child of node.childNodes ?? []) {
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/**
 * The text a reader sees, with this plugin's hidden ghosts left out.
 *
 * The ghost deliberately keeps the token inside \`textContent\`, so a test that wants
 * to assert "the user does not see the tag" has to exclude it — and a test that wants
 * to assert "textContent is unchanged" must NOT.
 */
function visibleText(element) {
  let out = "";
  for (const child of element.childNodes ?? []) {
    if (child.nodeType === 3) {
      out += child.nodeValue ?? "";
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (child.getAttribute?.("data-emote-hidden") !== null) continue;
    out += visibleText(child);
  }
  return out;
}

/** Descendants of one node carrying a sticker figure. */
function stickerFigures(root) {
  return allElements(root).filter((node) => node.hasAttribute?.("data-emote-sticker"));
}

/** Descendants of one node carrying a chip row. */
function chipRows(root) {
  return allElements(root).filter((node) => node.hasAttribute?.("data-emote-chips"));
}

/** Descendants of one node wrapped as a hidden token carrier. */
function hiddenCarriers(root) {
  return allElements(root).filter((node) => node.classList?.contains("ec-hidden-token"));
}

// ─────────────────────────────────── tests ───────────────────────────────────

test("splitTokens separates prose from sticker tokens", () => {
  const { exports } = loadBundle();
  const { splitTokens } = exports.internals;
  // The bundle runs in its own VM realm, so compare structurally.
  assert.deepEqual(
    JSON.parse(JSON.stringify(splitTokens("hello"))),
    [{ text: "hello" }],
  );
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
  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/happy", name: "happy" }] }] };
  assert.equal(exports.internals.findSticker(catalog, "whale/happy")?.name, "happy");
  assert.equal(exports.internals.findSticker(catalog, "whale/missing"), undefined);
  assert.equal(exports.internals.findSticker(undefined, "whale/happy"), undefined);
});

test("the sticker keeps the text intact and hoists its image", () => {
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "assistant-step");
  const paragraph = makeElement("p");
  const carrier = makeText("here you go [[sticker:whale/happy]]");
  carrier.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
  paragraph.appendChild(carrier);
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/happy", name: "happy" }] }] };
  exports.internals
    .createStickerPainter({ t: (key) => key, getCatalog: () => catalog, isEnabled: () => true })
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
  const ghost = [...(root.childNodes ?? [])].find((node) => node.getAttribute?.("data-emote-hidden") != null)
    ?? [...allElements(root)].find((node) => node.getAttribute?.("data-emote-hidden") != null);
  assert.ok(ghost, "the token survives in a hidden ghost");
  assert.equal(ghost.style.display, "none", "and the ghost is not visible");
  assert.equal(ghost.textContent, "[[sticker:whale/happy]]", "carrying the original tag verbatim");

  // Invariant 2 — the image is hoisted, so it does not depend on where the token sat.
  assert.equal(root.childNodes[0], figures[0], "the figure is the first thing in the row");
  assert.equal(visibleText(paragraph), "here you go ", "the paragraph keeps only the prose");
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
  const carrier = makeText("[[sticker:whale/happy]]\ncan you see this sticker?");
  carrier.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
  paragraph.appendChild(carrier);
  bubble.appendChild(paragraph);
  stack.appendChild(bubble);
  root.appendChild(stack);
  sandbox.document = chatDocument([root]);

  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/happy", name: "happy" }] }] };
  exports.internals
    .createStickerPainter({ t: (key) => key, getCatalog: () => catalog, isEnabled: () => true })
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
    "[[sticker:whale/happy]]can you see this sticker?",
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
  paragraph.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
  paragraph.appendChild(makeText("look [[sticker:ghost/missing]] here"));
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  exports.internals
    .createStickerPainter({ t: (key) => key, getCatalog: () => ({ packs: [] }), isEnabled: () => true })
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

  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/thanks", name: "thanks" }] }] };
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
  assert.equal(carrier.parentElement, paragraph, "the carrier must not be wrapped before a sticker is placed");

  loaded = true;
  // `closest` is only consulted once a sticker can actually be placed.
  carrier.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
  painter.scan(); // both ready now
  const figures = stickerFigures(root);
  assert.equal(figures.length, 1, "the message must still be painted once the catalog arrives");
  assert.equal(figures[0].getAttribute("data-side"), "right");
});

test("a token the catalog does not know stays eligible for a later scan", () => {
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "assistant-step");
  const paragraph = makeElement("p");
  paragraph.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
  paragraph.appendChild(makeText("[[sticker:whale/notyet]]"));
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  const empty = { packs: [] };
  const full = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/notyet", name: "notyet" }] }] };
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
  pre.closest = (selector) => (selector === "pre, code" ? pre : makeElement("div").closest(selector));
  const code = makeElement("code");
  code.closest = (selector) => (selector === "pre, code" ? pre : null);
  code.appendChild(makeText("[[sticker:whale/happy]]"));
  pre.appendChild(code);
  root.appendChild(pre);
  sandbox.document = chatDocument([root]);

  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/happy", name: "happy" }] }] };
  exports.internals
    .createStickerPainter({ t: (key) => key, getCatalog: () => catalog, isEnabled: () => true })
    .scan();
  assert.equal(stickerFigures(root).length, 0);
});

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
  exports.internals.createReactionPainter({ t: (key) => key, getEntries: () => entries }).scan();

  const chips = chipRows(second.bubble);
  assert.equal(chips.length, 1, "the chip row lives inside the bubble");
  assert.equal(chips[0].textContent, "🎉");
  assert.equal(chips[0].parentElement, second.bubble, "inside the bubble, not beside it");
  assert.equal(second.bubble.childNodes.length, 2, "the message text and the reaction row");
  assert.equal(chipRows(first.bubble).length, 0, "an unrelated message stays clean");
  assert.equal(chipRows(first.stack).length, 0, "and nothing lands outside a bubble either");
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
  assert.equal(reactionHost(flow), bubble, "the bubble is the host, so the row sits at the foot of the message");
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
  assert.equal(reactionHost(named), namedStack, "a stack is used when no bubble is found");
});

test("the painter only paints message flow kinds", () => {
  // Verified against the desktop build: every flow item carries its node kind in
  // data-chat-flow-kind, and the process surfaces are NOT messages. The reasoning
  // preview legitimately mentions [[sticker:…]] while discussing it, which is how
  // a sticker once appeared inside the thinking block.
  const { exports, sandbox } = loadBundle();
  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/happy", name: "happy" }] }] };
  const painter = () =>
    exports.internals.createStickerPainter({ t: (key) => key, getCatalog: () => catalog, isEnabled: () => true });

  for (const kind of ["turn-process", "turn-trigger", "turn-error", "turn-max-tokens", "turn-tail", "system-prompt", "tool-call", "unknown-surface"]) {
    const flow = makeElement("div");
    flow.setAttribute("data-chat-flow-kind", kind);
    const paragraph = makeElement("p");
    paragraph.closest = (selector) => (selector === "[data-chat-flow-kind]" ? flow : null);
    paragraph.appendChild(makeText("here you go [[sticker:whale/happy]]"));
    flow.appendChild(paragraph);
    sandbox.document = chatDocument([flow]);
    painter().scan();
    assert.equal(stickerFigures(flow).length, 0, `${kind} is not a message and must stay unpainted`);
  }

  for (const kind of ["user", "steering", "assistant-step"]) {
    const flow = makeElement("div");
    flow.setAttribute("data-chat-flow-kind", kind);
    const paragraph = makeElement("p");
    paragraph.closest = (selector) => (selector === "[data-chat-flow-kind]" ? flow : null);
    paragraph.appendChild(makeText("here you go [[sticker:whale/happy]]"));
    flow.appendChild(paragraph);
    sandbox.document = chatDocument([flow]);
    painter().scan();
    assert.equal(stickerFigures(flow).length, 1, `${kind} is a message and must be painted`);
  }
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
  assert.equal(exports.internals.reactionHost(flow), bubble, "the bubble holds the reaction row");
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

test("an intervention does not claim the anchor", () => {
  // The declared contract: a message the user sends while the Agent is working is
  // an intervention in the running turn, so it must NOT become the message a
  // reaction is anchored to. The consequence is accepted deliberately — the Agent
  // cannot react to an intervention specifically.
  //
  // The build marks such a message itself, so the rule is written against those
  // markers rather than against "which message happens to be newest".
  const { exports, sandbox } = loadBundle();
  const build = (key, marker) => {
    const flow = makeElement("div");
    flow.setAttribute("data-chat-flow-kind", "user");
    flow.setAttribute("data-chat-node-key", key);
    if (marker !== undefined) flow.setAttribute(marker, "true");
    const row = makeElement("div");
    const stack = makeElement("div");
    stack.className = "_userStack_abc123";
    const bubble = makeElement("div");
    bubble.className = "_bubble_abc123";
    bubble.appendChild(makeText("hi"));
    stack.appendChild(bubble);
    row.appendChild(stack);
    flow.appendChild(row);
    return { flow, stack };
  };
  const ordinary = build("13:input-messageordinary-message");
  const intervention = build("13:input-messagesteering-message", "data-pending-steering");
  sandbox.document = chatDocument([ordinary.flow, intervention.flow]);

  const anchors = [];
  const painter = exports.internals.createReactionPainter({
    t: (key) => key,
    getEntries: () => [],
    onNewMessage: (anchor) => anchors.push(anchor),
  });
  painter.scan();

  assert.deepEqual(anchors, ["13:input-messageordinary-message"], "the intervention is skipped");
  assert.ok(!anchors.includes("13:input-messagesteering-message"), "an intervention never becomes the anchor");
});

test("a reaction row is kept out of the message's text", () => {
  // The row now lives inside the bubble, so it is unavoidably part of that
  // element's text content — and anything that reads the message as text (a screen
  // reader, a selection, an extraction) would report the emoji as part of what the
  // user said. `aria-hidden` is what keeps it out of that text while leaving it on
  // screen, and it is the only thing standing between the two.
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
      getEntries: () => [{ seq: 1, emoji: "✅", messageKey: "13:input-messageaaaabbbb" }],
    })
    .scan();

  const chips = chipRows(only.bubble);
  assert.equal(chips.length, 1, "the row is created inside the bubble");
  assert.equal(chips[0].getAttribute("aria-hidden"), "true", "and is hidden from the message's text");
  assert.equal(chips[0].parentElement, only.bubble, "the row sits at the foot of the message");
  assert.equal(
    [...(only.bubble.childNodes ?? [])].filter((node) => node.className === "_bubble_abc123").length,
    0,
    "no nested bubble was created",
  );
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
  const carrier = makeText("[[sticker:whale/happy]]\nI sent another sticker, take a look");
  carrier.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
  paragraph.appendChild(carrier);
  bubble.appendChild(paragraph);
  root.appendChild(bubble);
  sandbox.document = chatDocument([root]);

  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/happy", name: "happy" }] }] };
  exports.internals
    .createStickerPainter({ t: (key) => key, getCatalog: () => catalog, isEnabled: () => true })
    .scan();

  const shown = visibleText(bubble);
  assert.equal(shown, "I sent another sticker, take a look", "no blank line above the text");
  assert.ok(!shown.startsWith("\n"), "and the bubble does not open with a line break");
});

test("an unresolvable tag keeps its own spacing", () => {
  // The trim only applies when every token resolved. A tag that stays visible must
  // keep the whitespace around it, or the tag would be glued to the prose.
  const { exports, sandbox } = loadBundle();
  const root = makeElement("div");
  root.setAttribute("data-chat-flow-kind", "user");
  const paragraph = makeElement("p");
  const carrier = makeText("look [[sticker:ghost/missing]] here");
  carrier.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
  paragraph.appendChild(carrier);
  root.appendChild(paragraph);
  sandbox.document = chatDocument([root]);

  exports.internals
    .createStickerPainter({ t: (key) => key, getCatalog: () => ({ packs: [] }), isEnabled: () => true })
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
  carrier.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
  paragraph.appendChild(carrier);
  bubble.appendChild(paragraph);
  root.appendChild(bubble);
  sandbox.document = chatDocument([root]);

  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/happy", name: "happy" }] }] };
  const painter = exports.internals.createStickerPainter({
    t: (key) => key,
    getCatalog: () => catalog,
    isEnabled: () => true,
  });
  painter.scan();

  assert.equal(stickerFigures(root).length, 1, "the first scan places the image");
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
  assert.equal(painter.hasWork(), true, "and the pass reports that it did something");
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
    carrier.closest = (selector) => (selector === "[data-chat-flow-kind]" ? root : null);
    paragraph.appendChild(carrier);
    bubble.appendChild(paragraph);
    stack.appendChild(bubble);
    root.appendChild(stack);
    return { root, stack };
  };

  const first = build();
  sandbox.document = chatDocument([first.root]);
  const catalog = { packs: [{ id: "whale", name: "whale", stickers: [{ id: "whale/happy", name: "happy" }] }] };
  const painter = exports.internals.createStickerPainter({
    t: (key) => key,
    getCatalog: () => catalog,
    isEnabled: () => true,
  });
  painter.scan();
  assert.equal(stickerFigures(first.root).length, 1, "the first row is painted");

  // A different row object with the token still in its text, as a fresh render gives.
  const second = build();
  sandbox.document = chatDocument([second.root]);
  painter.scan();

  assert.equal(stickerFigures(second.root).length, 1, "the rebuilt row is painted too");
  assert.equal(stickerFigures(second.root).length, 1, "exactly one figure — no duplicate from the stale record");
  assert.equal(stickerFigures(first.root).length, 1, "and the old row is untouched");
});

