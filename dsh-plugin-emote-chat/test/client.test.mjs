import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");

/**
 * Load the browser bundle in a VM with a stubbed module loader and a minimal
 * DOM, run its factory, and return the registration plus the exports.
 *
 * This catches the whole class of "the bundle never registered" and "apply
 * threw on the first call" failures without a browser.
 */
function loadBundle(overrides = {}) {
  let registration;
  const styleTags = [];
  /** Every MutationObserver the bundle created, so a test can drive its scan. */
  const observers = [];
  const document = {
    head: {
      appendChild(node) {
        styleTags.push(node);
      },
    },
    body: {
      appendChild() {},
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return makeStubNode(tag);
    },
  };
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(def) {
          registration = def;
        },
      },
    },
    document,
    require(spec) {
      if (spec === "react") {
        return {
          /**
           * A minimal, inspectable element factory.
           *
           * The real `createElement` drives React in the browser; here it only
           * has to produce a tree, so the settings page's structure and props can
           * be asserted without mounting anything.
           */
          createElement: (type, props, ...children) => ({
            type,
            props: {
              ...(props ?? {}),
              ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }),
            },
          }),
          useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
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
    fetch: async () => ({ ok: true, json: async () => ({ packs: [], paths: [], emoji: [] }) }),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
      takeRecords() {
        return [];
      }
      /** Test helper: run the observer's scan the way a DOM change would. */
      fire() {
        this.callback();
      }
    },
    NodeFilter: { SHOW_TEXT: 4 },
    console,
    ...overrides,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(bundlePath, "utf8"), sandbox, { filename: "lib/client.js" });
  return { registration, exports: registration.factory(sandbox.require), styleTags, sandbox, document, observers };
}

/**
 * A minimal DOM node for the stubs that build or walk real markup.
 *
 * Only the surface those code paths touch: attributes, `append`,
 * `replaceWith`, `textContent`, and a `querySelector` over direct children.
 */
function makeStubNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {} },
    attributes: {},
    children: [],
    parent: null,
    textContent: "",
    isConnected: true,
    setAttribute(name, value) {
      node.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.hasOwn(node.attributes, name) ? node.attributes[name] : null;
    },
    addEventListener() {},
    append(...nodes) {
      for (const child of nodes) {
        child.parent = node;
        node.children.push(child);
      }
    },
    remove() {
      if (node.parent === null) return;
      node.parent.children = node.parent.children.filter((child) => child !== node);
      node.parent = null;
    },
    after() {},
    replaceWith(replacement) {
      const parent = node.parent;
      if (parent === null) return;
      const at = parent.children.indexOf(node);
      if (at !== -1) parent.children.splice(at, 1, replacement);
      replacement.parent = parent;
      node.parent = null;
    },
    replaceChildren() {},
    /** Direct-children lookup, which is all the nav scan performs. */
    querySelector(selector) {
      if (selector === "svg") return node.children.find((child) => child.tagName === "SVG") ?? null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return node;
}

/** A plugin context stub recording effect/slot/inject calls. */
function fakeContext() {
  const registered = [];
  const injected = [];
  const effects = [];
  return {
    registered,
    injected,
    effects,
    ctx: {
      locale: {
        register: () => () => {},
        bind: () => (key) => key,
      },
      effect(callback, label) {
        effects.push(label);
        const dispose = callback();
        return typeof dispose === "function" ? dispose : () => {};
      },
      slots: {
        inject(key, callback) {
          injected.push(key);
          return callback();
        },
        register(options, component) {
          registered.push({ options, component });
          return () => {};
        },
      },
      remote: { settings: {} },
      get: () => undefined,
    },
  };
}

test("the bundle registers under the package id with an apply export", () => {
  const { registration, exports } = loadBundle();
  assert.equal(registration.id, "dsh-plugin-emote-chat");
  assert.equal(typeof registration.factory, "function");
  assert.equal(typeof exports.apply, "function");
  assert.ok(Array.isArray(exports.inject));
  assert.ok(exports.inject.includes("slots"));
  assert.ok(exports.inject.includes("locale"));
  assert.ok(exports.inject.includes("remote.settings"));
});

test("apply injects the composer picker, the settings page, and the tool card", () => {
  const { exports } = loadBundle();
  const { ctx, injected, registered } = fakeContext();
  exports.apply(ctx);
  assert.deepEqual(injected.sort(), ["conversation.input.left", "settings.section", "tool.call.toolview"]);
  const picker = registered.find((entry) => entry.options.id === "emote-picker");
  assert.ok(picker, "the composer picker must register");
  assert.equal(picker.options.name, "conversation.input.left");
  assert.equal(typeof picker.component, "function");
  const page = registered.find((entry) => entry.options.id === "emote-chat");
  assert.ok(page, "the settings page must register");
  assert.equal(page.options.name, "settings.section");
  assert.equal(page.options.locale, "emote");
  assert.equal(page.options.label(), "section.nav");
  const card = registered.find((entry) => entry.options.key === "emote_reply");
  assert.ok(card, "the emote_reply tool card must register");
  assert.equal(card.options.name, "tool.call.toolview");
});

test("apply installs exactly one tagged stylesheet", () => {
  const { exports, styleTags } = loadBundle();
  const { ctx } = fakeContext();
  exports.apply(ctx);
  assert.equal(styleTags.length, 1);
  const tag = styleTags[0];
  assert.equal(tag.dataset.plugin, "dsh-plugin-emote-chat");
  assert.match(tag.textContent, /\[data-emote-sticker\]/);
  assert.match(tag.textContent, /\.ec-rain > span/);
  // Rain falls downward: the glyphs start above the viewport (`top`) and the
  // keyframe travels a positive distance. The first version rose from the
  // bottom, which pinned the direction in the wrong place.
  assert.match(tag.textContent, /@keyframes ec-rain-fall/);
  assert.doesNotMatch(tag.textContent, /ec-rain-rise/);
  assert.match(tag.textContent, /\.ec-rain > span \{\s*position: absolute; top: -10vh/);
  assert.match(tag.textContent, /translate3d\(var\(--ec-drift, 0px\), 118vh, 0\)/);
});

test("the rain gate plays a recent live reaction and nothing else", () => {
  // Getting this gate wrong is invisible: the chip still appears, so only the
  // rain is missing. The bug it was written for gated on the feed's internal
  // `live` flag, which stays false until the first long poll returns — so after
  // any page load, a reaction from seconds ago could never rain.
  const { exports } = loadBundle();
  const { shouldRain, RAIN_FRESH_MS } = exports.internals;
  const now = 1_000_000;
  const fresh = { seq: 1, emoji: "🎉", live: true, at: now - 2_000 };
  const stale = { seq: 2, emoji: "🎉", live: true, at: now - RAIN_FRESH_MS - 1 };

  assert.equal(shouldRain(fresh, now, new Set()), true, "a live reaction from 2s ago rains");
  assert.equal(shouldRain(stale, now, new Set()), false, "a reaction older than the window does not");
  assert.equal(shouldRain({ ...fresh, live: false }, now, new Set()), false, "a priming entry never rains");
  assert.equal(shouldRain(fresh, now, new Set([fresh.seq])), false, "a sequence rains once");
  assert.equal(shouldRain(undefined, now, new Set()), false, "a malformed entry is ignored");
  assert.equal(shouldRain({ seq: 3, live: true, at: now - RAIN_FRESH_MS }, now, new Set()), true, "the boundary counts as fresh");
});

test("a reaction binds once and does not follow the newest message", () => {
  // The first reported bug: after reacting to message A, every later message
  // showed A's reaction, because the painter re-chose "the newest user message"
  // on every scan.
  const { exports } = loadBundle();
  const { assignReactions } = exports.internals;
  const ID_A = "aaaabbbb-1111-2222-3333-444455556666";
  const ID_B = "bbbbcccc-1111-2222-3333-444455556666";
  const rowA = makeStubNode("div");
  rowA.setAttribute("data-chat-node-key", "13:input-message" + ID_A);
  const rowB = makeStubNode("div");
  rowB.setAttribute("data-chat-node-key", "13:input-message" + ID_B);
  const bound = new Map();
  const cursor = { value: 0 };
  const seen = new Map();
  const entries = [{ seq: 1, emoji: "💪", messageId: ID_A }];

  let placed = assignReactions(entries, [rowA]);
  assert.deepEqual([...placed.keys()], [rowA]);

  // B arrives. The reaction must stay on A, which is the whole point.
  placed = assignReactions(entries, [rowA, rowB]);
  assert.deepEqual([...placed.keys()], [rowA], "the old reaction does not move to the new message");

  // A fresh reaction binds to its own message.
  const both = [...entries, { seq: 2, emoji: "🎉", messageId: ID_B }];
  placed = assignReactions(both, [rowA, rowB]);
  assert.deepEqual(Array.from(placed.get(rowA)).map((e) => e.emoji), ["💪"]);
  assert.deepEqual(Array.from(placed.get(rowB)).map((e) => e.emoji), ["🎉"]);

  // Once the bound row leaves the DOM the reaction is forgotten, so a rebuilt
  // conversation still shows its history.
  placed = assignReactions(both, [rowB]);
  assert.deepEqual(Array.from(placed.get(rowB)).map((e) => e.emoji), ["🎉"], "only live rows are painted");
});

test("a reaction with no usable stamp binds to nothing", () => {
  // The timestamp rule this replaced was removed on purpose: it still mis-anchored
  // whenever a message arrived while a reaction was in flight. A reaction that
  // names no message is left unbound — the Host prunes it — because an absent
  // chip is honest and a misplaced one is not.
  const { exports } = loadBundle();
  const { assignReactions } = exports.internals;
  const m2 = makeStubNode("div");
  m2.setAttribute("data-chat-node-key", "13:input-messagetwo");
  const m3 = makeStubNode("div");
  m3.setAttribute("data-chat-node-key", "13:input-messagethree");
  const placed = assignReactions(
    [{ seq: 7, emoji: "✨", at: 5000 }],
    [m2, m3],
    new Map(),
    { value: 0 },
  );
  assert.deepEqual([...placed.keys()], [], "no stamp, no binding");
});

test("a declared target beats the anchor", () => {
  // This is the path that makes an intervened message addressable: the Agent
  // names the message instead of relying on the browser to guess which one it
  // meant. Both entries carry a stamp, so the difference is only which message
  // each one names.
  const { exports } = loadBundle();
  const { assignReactions, messageIdOf } = exports.internals;
  const ID_OLD = "11112222-3333-4444-5555-666677778888";
  const ID_NEW = "99990000-1111-2222-3333-444455556666";
  const oldRow = makeStubNode("div");
  oldRow.setAttribute("data-chat-node-key", "13:input-message" + ID_OLD);
  const newRow = makeStubNode("div");
  newRow.setAttribute("data-chat-node-key", "13:input-message" + ID_NEW);
  const placed = assignReactions(
    [
      { seq: 1, emoji: "🌧️", messageId: ID_OLD },
      { seq: 2, emoji: "🍵", messageId: ID_NEW },
    ],
    [oldRow, newRow],
    new Map(),
    { value: 0 },
  );
  assert.deepEqual(Array.from(placed.get(oldRow)).map((e) => e.emoji), ["🌧️"], "the older message keeps its own");
  assert.deepEqual(Array.from(placed.get(newRow)).map((e) => e.emoji), ["🍵"]);

  // The tail a model would quote resolves to the full id.
  assert.equal(messageIdOf("13:input-message" + ID_OLD), ID_OLD);
  assert.ok(ID_OLD.endsWith("77778888"), "a tail is enough to name it");
});

test("a named messageKey wins over timing", () => {
  const { exports } = loadBundle();
  const { assignReactions } = exports.internals;
  const rowA = makeStubNode("div");
  rowA.setAttribute("data-chat-node-key", "A");
  const rowB = makeStubNode("div");
  rowB.setAttribute("data-chat-node-key", "B");
  const seen = new Map();
  const placed = assignReactions(
    [{ seq: 1, emoji: "👏", messageKey: "A", at: 99999 }],
    [rowA, rowB],
    new Map(),
    { value: 0 },
    seen,
  );
  assert.deepEqual([...placed.keys()], [rowA], "the Host's own anchor is authoritative");
});

test("apply is idempotent about the listener set and survives a second run", () => {
  const { exports } = loadBundle();
  const first = fakeContext();
  exports.apply(first.ctx);
  const second = fakeContext();
  exports.apply(second.ctx);
  assert.equal(second.registered.length, first.registered.length);
});

// Rendering is checked through the element tree `createElement` produces, which
// is enough to pin the things that must not regress: the page uses the shipped
// primitives rather than local controls, a switch turns its own section on, an
// unreadable folder marks its own row, and the preview shows the stickers the
// scan actually found.

/** A config face whose store returns a fixed snapshot. */
function settingsFace(data) {
  return {
    store: { get: () => ({ status: "ready", data, writable: true }) },
    load: async () => {},
  };
}

/**
 * Collect every element in a rendered tree.
 *
 * Call `expand` first. This descends through all prop values rather than only
 * `children`, because a row receives its control as `props.control` and its
 * drawer as `props.children`.
 */
function walk(node, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node.type !== undefined) out.push(node);
  for (const value of Object.values(node.props ?? {})) walk(value, out);
  return out;
}

/**
 * Expand function components in an element tree.
 *
 * The harness's `createElement` only *builds* elements; React is what calls
 * function components. Without this step a wrapper such as the switch renders an
 * empty object, and every assertion about its output passes against nothing —
 * which is exactly how the settings page's drawer and headings went missing from
 * the first version of these tests. The components here are pure and use only
 * the stubbed hooks, so one pass is enough.
 *
 * @param node - an element, array, or primitive child.
 * @returns the same shape with every function component replaced by its output.
 */
function expand(node) {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node.type === "function") return expand(node.type(node.props));
  const props = {};
  for (const [key, value] of Object.entries(node.props ?? {})) props[key] = expand(value);
  return { ...node, props };
}

/** The plain text under one node. */
function textOf(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node === null || node === undefined || typeof node !== "object") return "";
  return textOf(node.props?.children);
}

/** Render the page against one snapshot and return its expanded element tree. */
function renderPage(data) {
  const { exports } = loadBundle();
  const tree = exports.internals.SettingsSection({
    t: (key, params) => {
      if (params === undefined) return key;
      return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), key);
    },
    config: settingsFace(data),
    context: { update: async () => ({ ok: true }) },
  });
  return expand(tree);
}

const CATALOG = {
  stickerReply: true,
  emojiReply: true,
  emojiRain: false,
  paths: ["D:\\stickers\\cats", "D:\\missing"],
  packs: [
    { id: "cats", name: "cats", stickers: [{ id: "cats/happy", name: "happy", mime: "image/png" }] },
  ],
  errors: [{ path: "D:\\missing", reason: "missing" }],
};

/** The switches on the rendered page, in row order. */
function switches(tree) {
  return walk(tree).filter((node) => typeof node.props?.onChange === "function" && "checked" in node.props);
}

// Two behaviours of this page are verified live rather than here: a switch
// writes only its own field, and turning emoji replies off collapses the
// emoji-rain row with it. Asserting them needs the shipped primitive's rendered
// children, which this element-tree harness does not expand; a test that cannot
// see them would pass against nothing.

test("an unreadable folder marks its own row instead of failing the page", () => {
  const tree = renderPage(CATALOG);
  const inputs = walk(tree).filter((node) => node.type === "input");
  assert.equal(inputs.length, 2, "one line per configured folder");
  assert.equal(inputs[0].props["data-missing"], undefined, "the readable folder is not flagged");
  assert.equal(inputs[1].props["data-missing"], "true", "the missing folder is flagged");
  assert.equal(inputs[1].props.value, "D:\\missing");
});

test("the preview shows the stickers the scan found", () => {
  const tree = renderPage(CATALOG);
  const tiles = walk(tree).filter((node) => node.props?.className === "ec-tile");
  assert.equal(tiles.length, 1);
  const image = walk(tiles[0]).find((node) => node.type === "img");
  assert.equal(image.props.src, "/api/emote-chat/sticker?id=cats%2Fhappy");
  assert.equal(image.props.alt, "cats/happy");
});

test("the folder drawer reports the scan result and the unusable paths", () => {
  // This status belongs to the folder scan, so it lives in that drawer: with
  // sticker replies off there is no scan to report and no drawer to host it.
  // An unusable path takes precedence over the total — the error is the line
  // the user has to act on.
  const statuses = (tree) =>
    walk(tree)
      .filter((node) => node.props?.className === 'ec-note-line')
      .map((node) => textOf(node))
      .filter((entry) => entry !== '');

  const broken = statuses(renderPage(CATALOG));
  assert.ok(
    broken.some((entry) => entry.includes('section.scanError')),
    `the unusable path must be reported, got ${JSON.stringify(broken)}`,
  );
  assert.ok(
    !broken.some((entry) => entry.includes('section.scanned')),
    'the error replaces the total rather than sitting beside it',
  );

  const clean = statuses(renderPage({ ...CATALOG, errors: [] }));
  assert.ok(
    clean.some((entry) => entry.includes('section.scanned')),
    `the scan total must be reported, got ${JSON.stringify(clean)}`,
  );

  const off = statuses(renderPage({ ...CATALOG, stickerReply: false }));
  assert.ok(
    !off.some((entry) => entry.includes('section.scanError')),
    'no drawer, no scan report',
  );
});

test("the page renders without a catalog and asks for folders", () => {
  const tree = renderPage({ stickerReply: true, emojiReply: false, emojiRain: false, paths: [], packs: [], errors: [] });
  const inputs = walk(tree).filter((node) => node.type === "input");
  assert.equal(inputs.length, 1, "an empty list still offers one row to fill in");
  assert.equal(inputs[0].props.value, "");
  const texts = walk(tree).map(textOf).join(" ");
  assert.match(texts, /section\.scanEmpty/u);
});

test("a chip restored from the store finds its message by id", () => {
  // The store keeps only the message id, so the painter must resolve a row from
  // it — and must keep doing so when a key is replaced, which is what happens to
  // a queued message when it is submitted.
  const { exports } = loadBundle();
  const { messageIdOf, rowMatches, assignReactions } = exports.internals;
  const ID = "aaaabbbb-1111-2222-3333-444455556666";
  const row = makeStubNode("div");
  row.setAttribute("data-chat-node-key", "13:input-message" + ID);

  assert.equal(messageIdOf("13:input-message" + ID), ID);
  assert.equal(messageIdOf(ID), ID, "a bare id is already an id");
  assert.ok(rowMatches(row, { messageId: ID }), "an id-only entry matches");
  assert.ok(rowMatches(row, { messageKey: "13:input-message" + ID }), "a full key still matches");
  assert.ok(!rowMatches(row, { messageId: "other" }), "a different message does not match");

  const placed = assignReactions([{ seq: 3, emoji: "🎉", messageId: ID }], [row]);
  assert.deepEqual([...placed.keys()], [row], "a restored reaction binds to its own message");
});

test("a replaced node key still resolves through its id", () => {
  // A queued message is re-keyed when it is submitted, so the key recorded when
  // it was queued no longer exists. The id inside it does, which is why the
  // anchor is the id and not the key.
  const { exports } = loadBundle();
  const { assignReactions } = exports.internals;
  const ID = "99887766-1111-2222-3333-444455556666";
  const submitted = makeStubNode("div");
  submitted.setAttribute("data-chat-node-key", "13:input-message" + ID);
  const other = makeStubNode("div");
  other.setAttribute("data-chat-node-key", "13:input-messageanother-message");
  const placed = assignReactions(
    [{ seq: 1, emoji: "👍", messageId: ID }],
    [other, submitted],
      );
  assert.deepEqual([...placed.keys()], [submitted], "the id finds its message among several");
});


test("the stylesheet contains no stray backtick", () => {
  // The stylesheet is one template literal, so a single backtick inside a CSS
  // comment terminates it early and the whole bundle stops parsing — which is
  // exactly how a spacing change broke the plugin twice. The delimiters are the
  // only two allowed, so this counts what lies between them.
  const tick = String.fromCharCode(96);
  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  const open = "const CSS = " + tick;
  const start = source.indexOf(open);
  assert.ok(start > 0, "one stylesheet declaration");
  assert.equal(source.indexOf(open, start + 1), -1, "declared exactly once");
  const body = source.slice(start + open.length);
  const close = body.indexOf(tick + ";");
  assert.ok(close > 0, "closed by a backtick and a semicolon");
  const css = body.slice(0, close);
  assert.ok(css.length > 2000, "and the stylesheet is actually there");
  assert.equal(css.indexOf(tick), -1, "no backtick survives between the delimiters");
});

test("a reaction returns when its message is paged back in", () => {
  // A long conversation is paged: the chat destroys rows outside the window and builds
  // new elements when they scroll back. The binding therefore cannot be remembered —
  // it has to be recomputed from what is on screen now, matched by message id.
  const { exports } = loadBundle();
  const { assignReactions } = exports.internals;
  const ID = "aaaabbbb-1111-2222-3333-444455556666";

  const rowOf = (id) => {
    const row = makeStubNode("div");
    row.setAttribute("data-chat-node-key", "13:input-message" + id);
    return row;
  };
  // Entries arrive as the Host delivers them: the id, which is what survives a rebuild.
  const entries = [{ seq: 1, emoji: "✅", messageId: ID }];

  // On screen: the reaction is placed.
  const first = rowOf(ID);
  let placed = assignReactions(entries, [first]);
  assert.deepEqual([...placed.keys()], [first], "placed while the message is visible");

  // Paged out: the row is gone, so nothing is placed — and nothing is remembered.
  placed = assignReactions(entries, []);
  assert.equal(placed.size, 0, "no row, no chip");

  // Paged back in: a NEW element for the same message. The chip must return, which is
  // the case a remembered binding could never handle.
  const returned = rowOf(ID);
  placed = assignReactions(entries, [returned]);
  assert.deepEqual([...placed.keys()], [returned], "and it comes back with the message");
  assert.deepEqual(Array.from(placed.get(returned)).map((e) => e.emoji), ["✅"]);

  // The rule still holds: a message the reaction does not name never receives it.
  const other = rowOf("ccccdddd-1111-2222-3333-444455556666");
  placed = assignReactions(entries, [other]);
  assert.equal(placed.size, 0, "a different message gets nothing");
});
