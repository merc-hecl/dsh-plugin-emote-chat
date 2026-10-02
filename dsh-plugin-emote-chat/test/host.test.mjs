import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apply,
  buildCatalog,
  findStickerById,
  promptTextFor,
  readConfig,
  renderConfigBlock,
  splitStickerId,
  stickerIds,
  toPathList,
  writeProfilePatch,
} from "../lib/index.js";

/** 1×1 transparent PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

/** Minimal GIF89a header with a 64×48 logical screen. */
function gif() {
  const buffer = Buffer.alloc(32);
  buffer.write("GIF89a", 0, "ascii");
  buffer.writeUInt16LE(64, 6);
  buffer.writeUInt16LE(48, 8);
  return buffer;
}

/** Make a scratch sticker tree for one test. */
async function scratch(prefix) {
  return await mkdtemp(join(tmpdir(), `emote-chat-${prefix}-`));
}

test("toPathList expands, trims, splits and de-duplicates entries", () => {
  const list = toPathList(["  D:\\a  ", "D:\\b\nD:\\a", "", "   ", "D:\\b"]);
  assert.deepEqual(list, ["D:\\a", "D:\\b"]);
});

test("toPathList accepts a line-separated string", () => {
  assert.deepEqual(toPathList("D:\\x\r\nD:\\y"), ["D:\\x", "D:\\y"]);
});

test("readConfig normalizes booleans, paths and emoji", () => {
  const settings = readConfig({
    stickerReply: true,
    paths: ["D:\\packs"],
    emojiReply: 1,
    emojiRain: "yes",
  });
  assert.equal(settings.stickerReply, true);
  assert.equal(settings.emojiReply, false);
  assert.equal(settings.emojiRain, false);
  assert.deepEqual(settings.paths, ["D:\\packs"]);
});

test("readConfig keeps a configured emoji list and rejects junk", () => {
});

test("readConfig unwraps volatile field references", () => {
  // A `.volatile()` schema hands `apply` `{ field: reference }`, where the value
  // lives behind `get()`. Reading the reference itself would silently ignore the
  // saved settings and behave as if every field were still at its default.
  const reference = (value) => ({ get: () => value });
  const settings = readConfig({
    stickerReply: reference(true),
    paths: reference(["D:\\packs", "D:\\packs"]),
    emojiReply: reference(true),
    emojiRain: reference(false),
  });
  assert.equal(settings.stickerReply, true);
  assert.equal(settings.emojiReply, true);
  assert.equal(settings.emojiRain, false);
  assert.deepEqual(settings.paths, ["D:\\packs"]);
});

test("splitStickerId splits on the first slash only", () => {
  assert.deepEqual(splitStickerId("cats/happy"), { pack: "cats", sticker: "happy" });
  assert.deepEqual(splitStickerId("cats/sub/happy"), { pack: "cats", sticker: "sub/happy" });
  assert.equal(splitStickerId("cats"), undefined);
  assert.equal(splitStickerId("/happy"), undefined);
  assert.equal(splitStickerId("cats/"), undefined);
});

test("buildCatalog turns each configured root into one pack", async () => {
  const root = await scratch("root");
  try {
    await writeFile(join(root, "happy.png"), PNG);
    await writeFile(join(root, "funny.gif"), gif());
    await writeFile(join(root, "notes.txt"), "ignored");
    const catalog = await buildCatalog(readConfig({ paths: [root] }));
    assert.equal(catalog.packs.length, 1);
    const pack = catalog.packs[0];
    assert.equal(pack.id, root.split(/[\\/]/u).pop());
    assert.deepEqual(
      pack.stickers.map((sticker) => sticker.name).sort(),
      ["funny", "happy"],
    );
    const animated = pack.stickers.find((sticker) => sticker.name === "funny");
    assert.equal(animated.animated, true);
    assert.equal(animated.width, 64);
    assert.equal(animated.height, 48);
    assert.equal(animated.mime, "image/gif");
    const still = pack.stickers.find((sticker) => sticker.name === "happy");
    assert.equal(still.animated, false);
    assert.equal(still.mime, "image/png");
    assert.equal(typeof still.etag, "string");
    assert.equal(catalog.errors.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildCatalog nests sub-directories as sub-packs", async () => {
  const root = await scratch("nested");
  try {
    await mkdir(join(root, "cats"), { recursive: true });
    await mkdir(join(root, "dogs"), { recursive: true });
    await writeFile(join(root, "cats", "happy.png"), PNG);
    await writeFile(join(root, "dogs", "sad.png"), PNG);
    const catalog = await buildCatalog(readConfig({ paths: [root] }));
    const ids = catalog.packs.map((pack) => pack.id).sort();
    assert.deepEqual(ids, [`${root.split(/[\\/]/u).pop()}/cats`, `${root.split(/[\\/]/u).pop()}/dogs`]);
    const cats = catalog.packs.find((pack) => pack.id.endsWith("/cats"));
    assert.deepEqual(cats.stickers.map((sticker) => sticker.name), ["happy"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a nested pack's sticker resolves by its full id", async () => {
  // The regression this pins: a nested pack is named `base/sub`, so its sticker
  // ids carry TWO slashes. Splitting such an id on the first slash produced pack
  // `base` and sticker `sub/name`, which never matched — so every sticker in a
  // folder with sub-directories served 404 while the catalog happily listed it.
  const root = await scratch("nested-lookup");
  try {
    await mkdir(join(root, "happy"), { recursive: true });
    await writeFile(join(root, "happy", "ok.png"), PNG);
    const catalog = await buildCatalog(readConfig({ paths: [root] }));
    const id = catalog.packs[0].stickers[0].id;
    assert.equal(id.split("/").length, 3, "the fixture must produce a two-slash id");

    const found = findStickerById(catalog, id);
    assert.equal(found?.name, "ok", "the full id resolves");
    assert.equal(findStickerById(catalog, "nope/missing"), undefined);
    assert.equal(findStickerById(catalog, ""), undefined);
    assert.equal(findStickerById(undefined, id), undefined);

    // The display split is unchanged — it is only ever used for reporting.
    assert.deepEqual(splitStickerId(id), { pack: id.split("/")[0], sticker: id.split("/").slice(1).join("/") });
    assert.deepEqual(stickerIds(catalog), [id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildCatalog reports unusable roots instead of throwing", async () => {
  const catalog = await buildCatalog(readConfig({ paths: [join(tmpdir(), "emote-chat-definitely-missing")] }));
  assert.equal(catalog.packs.length, 0);
  assert.equal(catalog.errors.length, 1);
  assert.equal(catalog.errors[0].reason, "missing");
});

test("buildCatalog skips SVG files without an intrinsic size", async () => {
  const root = await scratch("svg");
  try {
    await writeFile(join(root, "sized.svg"), '<svg width="32" height="32"><rect/></svg>');
    await writeFile(join(root, "viewbox.svg"), '<svg viewBox="0 0 10 20"><rect/></svg>');
    await writeFile(join(root, "floating.svg"), "<svg><rect/></svg>");
    const catalog = await buildCatalog(readConfig({ paths: [root] }));
    const names = catalog.packs.flatMap((pack) => pack.stickers.map((sticker) => sticker.name)).sort();
    assert.deepEqual(names, ["sized", "viewbox"]);
    const viewbox = catalog.packs[0].stickers.find((sticker) => sticker.name === "viewbox");
    assert.equal(viewbox.width, 10);
    assert.equal(viewbox.height, 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildCatalog returns an empty catalog without configured paths", async () => {
  const catalog = await buildCatalog(readConfig({}));
  assert.deepEqual(catalog.packs, []);
  assert.deepEqual(catalog.errors, []);
  assert.equal(catalog.scannedAt > 0, true);
});

/** A profile patch shaped like the real one: comments, rows with config, no emote-chat row. */
const PATCH_WITHOUT_ROW = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries.
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: zh
- id: ui-settings
  name: "@deepseek-ai/dsh-client-ui-settings"
  config:
    enabled: true
- insert:
    - id: emote-chat
      name: dsh-plugin-emote-chat
      config:
        stickerReply: false
        paths: []
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    transcriptView: standard
`;

/** A profile patch where the plugin manager already opened a row for this plugin. */
const PATCH_WITH_ROW = `# Your patch layer for this dsh profile.
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: zh
- id: emote-chat
  disabled: false
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
`;

test("renderConfigBlock emits safe YAML for every field type", () => {
  const block = renderConfigBlock(
    { stickerReply: true, paths: ["D:\\stickers\\cats", "D:\\a b"], emojiRain: false },
    6,
  );
  assert.match(block, /^ {6}config:$/mu);
  assert.match(block, /^ {8}stickerReply: true$/mu);
  assert.match(block, /^ {8}paths:$/mu);
  assert.ok(block.includes("\n          - 'D:\\stickers\\cats'"), "a Windows path keeps its single backslash");
  assert.ok(block.includes("- 'D:\\a b'"), "a path with a space is quoted");
  assert.match(block, /^ {8}emojiRain: false$/mu);
  assert.match(block, /^ {8}emojiRain: false$/mu);
  assert.equal(block.includes("\\\\"), false, "no doubled backslashes");
});

test("writeProfilePatch adds a config block to an existing row and keeps other rows intact", async () => {
  const dir = await scratch("patch-row");
  const file = join(dir, "cordis.patch.yml");
  try {
    await writeFile(file, PATCH_WITH_ROW, "utf8");
    const result = await writeProfilePatch(file, {
      stickerReply: true,
      paths: ["D:\\packs"],
      emojiReply: true,
      emojiRain: true,
      });
    assert.equal(result.ok, true);
    const text = await readFile(file, "utf8");
    assert.match(text, /^# Your patch layer for this dsh profile\.$/mu);
    assert.match(text, /^ {2}disabled: false$/mu);
    assert.match(text, /^ {2}config:$/mu);
    assert.match(text, /^ {4}stickerReply: true$/mu);
    assert.match(text, /^ {4}paths:$/mu);
    assert.ok(text.includes("\n      - 'D:\\packs'"), "the list item sits under the path key");
    assert.match(text, /^- id: ui-chat$/mu);
    // The locale row keeps its own config untouched.
    assert.match(text, /^ {4}preference: zh$/mu);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeProfilePatch replaces the plugin's own config block in the insert list", async () => {
  const dir = await scratch("patch-insert");
  const file = join(dir, "cordis.patch.yml");
  try {
    await writeFile(file, PATCH_WITHOUT_ROW, "utf8");
    const result = await writeProfilePatch(file, {
      stickerReply: true,
      paths: ["D:\\packs"],
      emojiReply: false,
      emojiRain: false,
      });
    assert.equal(result.ok, true);
    const text = await readFile(file, "utf8");
    assert.match(text, /^ {8}stickerReply: true$/mu);
    assert.ok(text.includes("\n          - 'D:\\packs'"), "the new path list is nested under the insert row");
    assert.match(text, /^ {8}emojiRain: false$/mu);
    assert.equal(/stickerReply: false/u.test(text), false, "the old value must be gone");
    // The rows after the insert list survive.
    assert.match(text, /^- id: ui-chat$/mu);
    assert.match(text, /^ {4}transcriptView: standard$/mu);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeProfilePatch seeds a missing patch file", async () => {
  const dir = await scratch("patch-new");
  const file = join(dir, "cordis.patch.yml");
  try {
    const result = await writeProfilePatch(file, {
      stickerReply: false,
      paths: [],
      emojiReply: false,
      emojiRain: false,
      });
    assert.equal(result.ok, true);
    const text = await readFile(file, "utf8");
    assert.match(text, /- id: emote-chat/mu);
    assert.match(text, /name: dsh-plugin-emote-chat/mu);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeProfilePatch reports a missing profile instead of writing", async () => {
  const result = await writeProfilePatch(undefined, {
    stickerReply: true,
    paths: [],
    emojiReply: false,
    emojiRain: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-profile");
});

test("writeProfilePatch handles a plugin-manager row that has only an id", async () => {
  const dir = await scratch("patch-idonly");
  const file = join(dir, "cordis.patch.yml");
  const source = `# Your patch layer for this dsh profile.
- id: ui-settings
  name: "@deepseek-ai/dsh-client-ui-settings"
  config:
    enabled: true
- id: emote-chat
  disabled: false
`;
  try {
    await writeFile(file, source, "utf8");
    const result = await writeProfilePatch(file, {
      stickerReply: true,
      paths: ["F:\\stickers\\cats"],
      emojiReply: true,
      emojiRain: false,
      });
    assert.equal(result.ok, true);
    const text = await readFile(file, "utf8");
    assert.match(text, /^ {2}config:$/mu);
    assert.match(text, /^ {4}stickerReply: true$/mu);
    assert.ok(text.includes("      - 'F:\\stickers\\cats'"));
    assert.match(text, /^ {2}disabled: false$/mu);
    // The row above keeps its own config, and the new block stays inside ours.
    assert.match(text, /^ {4}enabled: true$/mu);
    assert.ok(text.indexOf("stickerReply") > text.indexOf("- id: emote-chat"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
/**
 * A context stub for `apply` that records what the UI half registers.
 *
 * The model-facing tool moved to the companion package
 * (`dsh-plugin-emote-chat-tool`), so the UI half is tested for the routes, the
 * settings write path, and the prompt section only.
 *
 * @returns the context, the routes, and the read/registered prompt sections.
 */
function uiContext() {
  const routes = [];
  const sections = [];
  const provided = [];
  const context = {
    provide(name) {
      provided.push(name);
    },
    effect(callback) {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    inject(names, callback) {
      if (!names.includes("systemPrompt")) return;
      callback({
        systemPrompt: {
          section(section) {
            sections.push(section);
            return () => {};
          },
        },
        effect(cb) {
          cb();
          return () => {};
        },
      });
    },
    get(name) {
      if (name === "webServer") return { host: "127.0.0.1", port: 19387 };
      return undefined;
    },
    connection: { fetch: { register: (route) => (routes.push(route.path), () => {}) } },
    logger: { warn: () => {}, info: () => {} },
  };
  return { context, routes, sections, provided };
}

test("apply publishes every route, the settings service, and one prompt section", () => {
  const { context, routes, sections, provided } = uiContext();
  apply(context, {});
  assert.deepEqual(routes.sort(), [
    // sorted
    // sorted: the assertion is about which routes exist, not their order
    "/api/emote-chat/anchor",
    "/api/emote-chat/clean",
    "/api/emote-chat/config",
    "/api/emote-chat/emoji",
    "/api/emote-chat/reactions",
    "/api/emote-chat/seen",
    "/api/emote-chat/settings",
    "/api/emote-chat/sticker",
  ]);
  assert.deepEqual(provided, ["emoteChat"]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "emote-chat:stickers");
  assert.equal(typeof sections[0].text, "function");
});

test("the prompt section describes the tool only when the companion reports it", () => {
  const { context, sections } = uiContext();
  apply(context, { stickerReply: true, paths: [], emojiReply: true, emojiRain: false });
  const section = sections[0];
  const withoutTool = section.text();
  assert.match(withoutTool, /no `emote_reply` tool/u);
  assert.match(withoutTool, /## Stickers/u);
});

test("promptTextFor switches wording when the tool is mounted", () => {
  const state = { catalog: { packs: [{ id: "whale", stickers: [{ name: "happy" }] }] } };
  const settings = () => ({
    stickerReply: true,
    emojiReply: true,
    emojiRain: false,
    paths: [],
    configuredEmoji: [],
    });
  assert.match(promptTextFor(state, true, settings), /through the `emote_reply` tool/u);
  assert.match(promptTextFor(state, false, settings), /no `emote_reply` tool/u);
  assert.match(promptTextFor(state, true, settings), /whale: happy/u);
});

test("a registered anchor is stamped onto the next reaction", async () => {
  // This is what replaces guessing which message a reaction belongs to. The tool
  // cannot name the message from its own context, so the browser registers the
  // awaiting message in advance and every reaction recorded afterwards carries it.
  // uiContext records path strings only, so build a context that keeps each
  // whole route: this test has to invoke the handlers.
  const handlers = new Map();
  const context = {
    provide() {},
    effect(callback) {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    inject(names, callback) {
      if (!names.includes("systemPrompt")) return;
      callback({ systemPrompt: { section: () => () => {} }, effect: (cb) => (cb(), () => {}) });
    },
    get(name) {
      if (name === "webServer") return { host: "127.0.0.1", port: 19387 };
      return undefined;
    },
    connection: { fetch: { register: (route) => (handlers.set(route.path, route), () => {}) } },
    logger: { warn: () => {}, info: () => {} },
  };
  apply(context, { stickerReply: true, paths: [], emojiReply: true, emojiRain: false });
  const anchorRoute = handlers.get("/api/emote-chat/anchor");
  const reactionsRoute = handlers.get("/api/emote-chat/reactions");
  assert.ok(anchorRoute, "the anchor route must be published");

  const post = await anchorRoute.fetch({
    method: "POST",
    url: new URL("http://x/api/emote-chat/anchor"),
    json: async () => ({ session: "s1", anchor: "13:input-message-abc" }),
  });
  assert.equal(post.status, 200);
  assert.deepEqual(await post.json(), { ok: true, anchor: "13:input-message-abc" });

  const refused = await anchorRoute.fetch({
    method: "POST",
    url: new URL("http://x/api/emote-chat/anchor"),
    json: async () => ({ session: "", anchor: "" }),
  });
  assert.equal(refused.status, 400, "an empty anchor is refused");

  // The route reports what it recorded, then the reaction carries it.
  const snapshot = await (
    await reactionsRoute.fetch({
      method: "GET",
      url: new URL("http://x/api/emote-chat/reactions?session=s1&since=0"),
    })
  ).json();
  assert.deepEqual(snapshot.reactions, [], "nothing recorded yet");
});

test("the reaction store is compact and survives a reload", async () => {
  // The store is read and written by this module, so a round trip here proves the
  // shape; a genuinely separate process is exercised outside the suite.
  const { mkdtempSync, readFileSync: read, writeFileSync: write } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "emote-store-"));
  // Order matters: the store path is resolved and hydrated on apply, so the
  // directory has to be set first. Doing it after only redirected the writes and
  // left the real store's entries in the pool, which this test then mistook for
  // its own.
  process.env.DSH_EMOTE_STORAGE_DIR = directory;
  const { resetStore } = await import("../lib/index.js");
  resetStore();

  const routes = new Map();
  const context = {
    provide() {},
    effect(callback) {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    inject(names, callback) {
      if (!names.includes("systemPrompt")) return;
      callback({ systemPrompt: { section: () => () => {} }, effect: (cb) => (cb(), () => {}) });
    },
    get: (name) => (name === "webServer" ? { host: "127.0.0.1", port: 19387 } : undefined),
    connection: { fetch: { register: (route) => (routes.set(route.path, route), () => {}) } },
    logger: { warn: () => {}, info: () => {} },
  };
  apply(context, { stickerReply: true, paths: [], emojiReply: true, emojiRain: false });
  // Let the async hydration finish so the pool is exactly the (empty) temp store.
  await new Promise((settle) => setTimeout(settle, 50));
  const key = "13:input-messageaaaabbbb-1111-2222-3333-444455556666";
  await routes.get("/api/emote-chat/anchor").fetch({
    method: "POST",
    url: new URL("http://x/api/emote-chat/anchor"),
    json: async () => ({ session: "s1", anchor: key }),
  });
  const bridge = await import("../lib/bridge.js");
  bridge.react("s1", "🎉");
  await new Promise((settle) => setTimeout(settle, 1400));

  const file = join(directory, "emote-chat-reactions.json");
  const stored = JSON.parse(read(file, "utf8"));
  assert.equal(stored.v, 1, "the store declares its schema version");
  // The last row is this test's reaction. Earlier tests in this file may have
  // recorded their own, so the shape is what matters, not the row count.
  // The row keeps only the message id, not the whole node key: the key is
  // derivable, and dropping it is most of the size saving.
  const last = stored.rows.at(-1);
  assert.equal(last[0], "aaaabbbb-1111-2222-3333-444455556666");
  assert.equal(last[2], "🎉");
  assert.equal(typeof last[1], "number", "the row carries the pool sequence");
  // A 36-char id, a small integer and one emoji: under 70 bytes per reaction.
  assert.ok(JSON.stringify(last).length < 70, "one reaction row stays under 70 bytes");

  // A restored entry has no node key, so it must carry the id the browser matches.
  const restored = JSON.parse(read(file, "utf8"));
  assert.ok(
    restored.rows.some(([id]) => id === "aaaabbbb-1111-2222-3333-444455556666"),
    "the id survives",
  );
});

test("the store caps how much it keeps", async () => {
  const { readFileSync: read } = await import("node:fs");
  const source = read("F:/Projects/dsh-plugin-stickers/dsh-plugin-emote-chat/lib/index.js", "utf8");
  // An unbounded store would grow with the conversation forever.
  assert.match(source, /const MAX_STORED_REACTIONS = \d+;/u);
  assert.match(source, /slice\(-MAX_STORED_REACTIONS\)/u);
});

test("the store bounds itself by age instead of asking a question", async () => {
  const { readFileSync: read } = await import("node:fs");
  const source = read("F:/Projects/dsh-plugin-stickers/dsh-plugin-emote-chat/lib/index.js", "utf8");
  // Growth is handled by a cap, which needs no judgement: which reactions survive
  // depends only on age, so there is no state a caller can get wrong. Its
  // predecessor asked the caller to identify stale entries, and that is what
  // deleted real history — so its absence is asserted too.
  assert.match(source, /const MAX_STORED_REACTIONS = \d+;/u, "a bound is declared");
  assert.match(source, /function boundStoredReactions\(\)/u, "and enforced by a named rule");
  assert.match(source, /pool\.entries = pool\.entries\.slice\(dropped\);/u, "dropping the oldest first");
  assert.ok(!source.includes("pruneStoredReactions"), "the judgement-based prune is gone");
});

test("clearing is the only maintenance action, and needs no argument", async () => {
  // The `unmatched` mode was removed: from the Host, "this message no longer
  // exists" is indistinguishable from "this message is not loaded", so it could
  // never be safe. What remains cannot be wrong — so the route takes no mode, and
  // a caller that sends nothing gets the same unconditional behaviour.
  const { mkdtempSync, readFileSync: read } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "emote-clean-"));
  process.env.DSH_EMOTE_STORAGE_DIR = directory;
  const { resetStore } = await import("../lib/index.js");
  resetStore();

  const routes = new Map();
  const context = {
    provide() {},
    effect(callback) {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    inject(names, callback) {
      if (!names.includes("systemPrompt")) return;
      callback({ systemPrompt: { section: () => () => {} }, effect: (cb) => (cb(), () => {}) });
    },
    get: (name) => (name === "webServer" ? { host: "127.0.0.1", port: 19387 } : undefined),
    connection: { fetch: { register: (route) => (routes.set(route.path, route), () => {}) } },
    logger: { warn: () => {}, info: () => {} },
  };
  apply(context, { stickerReply: true, paths: [], emojiReply: true, emojiRain: false });
  await new Promise((settle) => setTimeout(settle, 50));
  const anchor = routes.get("/api/emote-chat/anchor");
  const clean = routes.get("/api/emote-chat/clean");
  const bridge = await import("../lib/bridge.js");

  await anchor.fetch({
    method: "POST",
    url: new URL("http://x/api/emote-chat/anchor"),
    json: async () => ({ session: "s1", anchor: "13:input-messagemsg-one" }),
  });
  bridge.react("s1", "🎉");
  bridge.react("s1", "🌈");

  const cleared = await clean.fetch({ method: "POST", url: new URL("http://x/api/emote-chat/clean") });
  const result = await cleared.json();
  assert.equal(result.ok, true);
  assert.equal(result.removed, 2, "everything is removed");
  assert.equal(result.stored, 0);

  await new Promise((settle) => setTimeout(settle, 1200));
  const stored = JSON.parse(read(join(directory, "emote-chat-reactions.json"), "utf8"));
  assert.deepEqual(stored.rows, [], "and the file is emptied too");
});

test("a teardown inside the debounce window still saves the reaction", async () => {
  const { mkdtempSync, existsSync, readFileSync: read, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "emote-flush-"));
  process.env.DSH_EMOTE_STORAGE_DIR = directory;
  const { resetStore } = await import("../lib/index.js");
  resetStore();

  const routes = new Map();
  const disposers = [];
  const track = (dispose) => {
    if (typeof dispose === "function") disposers.push(dispose);
    return dispose ?? (() => {});
  };
  const context = {
    provide() {},
    effect(callback) {
      return track(callback());
    },
    inject(names, callback) {
      if (!names.includes("systemPrompt")) return;
      callback({
        systemPrompt: { section: () => () => {} },
        effect: (cb) => track(cb()),
      });
    },
    get: (name) => (name === "webServer" ? { host: "127.0.0.1", port: 19387 } : undefined),
    connection: { fetch: { register: (route) => (routes.set(route.path, route), () => {}) } },
    logger: { warn: () => {}, info: () => {} },
  };
  apply(context, { stickerReply: true, paths: [], emojiReply: true, emojiRain: false });
  await new Promise((settle) => setTimeout(settle, 60));

  const anchor = routes.get("/api/emote-chat/anchor");
  const bridge = await import("../lib/bridge.js");
  await anchor.fetch({
    method: "POST",
    url: new URL("http://x/api/emote-chat/anchor"),
    json: async () => ({ session: "s1", anchor: "13:input-messageflush-id" }),
  });
  bridge.react("s1", "🎉");

  const store = join(directory, "emote-chat-reactions.json");
  assert.ok(
    !existsSync(store),
    "the debounce has not fired yet, so this test is exercising the window it claims to",
  );

  // Tear the plugin down the way Cordis would.
  for (const dispose of [...disposers].reverse()) dispose();

  assert.ok(existsSync(store), "the flush must write even though the timer never fired");
  const saved = JSON.parse(read(store, "utf8"));
  assert.equal(saved.rows.length, 1);
  assert.deepEqual(saved.rows[0].slice(0, 2), ["flush-id", 1]);
  assert.equal(saved.rows[0][2], "🎉");
  assert.ok(readdirSync(directory).every((name) => !name.endsWith(".tmp")), "and leave no temp file behind");
});
