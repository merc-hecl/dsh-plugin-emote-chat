/**
 * [INPUT]: node:test、系统原生路径、临时文件系统与 Host 业务模块
 * [OUTPUT]: 跨平台路径归一化与素材扫描边界测试
 * [POS]: Host 单元测试；不读取真实用户配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildCatalog,
  findStickerById,
  splitStickerId,
  stickerIds,
} from "../lib/catalog.js";
import { readConfig, toPathList } from "../lib/config.js";

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
  const a = join(tmpdir(), "emote-chat-a");
  const b = join(tmpdir(), "emote-chat-b");
  const list = toPathList([
    `  ${a}  `,
    `${b}\n${a}`,
    "",
    "   ",
    `"${b}"`,
    "~",
    "~/emote-chat-packs",
  ]);
  assert.deepEqual(list, [a, b, homedir(), join(homedir(), "emote-chat-packs")]);
});

test("toPathList accepts a line-separated string", () => {
  const x = join(tmpdir(), "emote-chat-x");
  const y = join(tmpdir(), "emote-chat-y");
  assert.deepEqual(toPathList(`${x}\r\n${y}`), [x, y]);
});

test("readConfig normalizes booleans, paths and emoji", () => {
  const packs = join(tmpdir(), "emote-chat-packs");
  const settings = readConfig({
    stickerReply: true,
    paths: [packs],
    emojiReply: 1,
    emojiRain: "yes",
  });
  assert.equal(settings.stickerReply, true);
  assert.equal(settings.emojiReply, false);
  assert.equal(settings.emojiRain, false);
  assert.deepEqual(settings.paths, [packs]);
});

test("readConfig unwraps volatile field references", () => {
  // A `.volatile()` schema hands `apply` `{ field: reference }`, where the value
  // lives behind `get()`. Reading the reference itself would silently ignore the
  // saved settings and behave as if every field were still at its default.
  const reference = (value) => ({ get: () => value });
  const packs = join(tmpdir(), "emote-chat-packs");
  const settings = readConfig({
    stickerReply: reference(true),
    paths: reference([packs, packs]),
    emojiReply: reference(true),
    emojiRain: reference(false),
  });
  assert.equal(settings.stickerReply, true);
  assert.equal(settings.emojiReply, true);
  assert.equal(settings.emojiRain, false);
  assert.deepEqual(settings.paths, [packs]);
});

test("splitStickerId splits on the first slash only", () => {
  assert.deepEqual(splitStickerId("cats/happy"), {
    pack: "cats",
    sticker: "happy",
  });
  assert.deepEqual(splitStickerId("cats/sub/happy"), {
    pack: "cats",
    sticker: "sub/happy",
  });
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
    assert.deepEqual(pack.stickers.map((sticker) => sticker.name).sort(), [
      "funny",
      "happy",
    ]);
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
    assert.deepEqual(ids, [
      `${root.split(/[\\/]/u).pop()}/cats`,
      `${root.split(/[\\/]/u).pop()}/dogs`,
    ]);
    const cats = catalog.packs.find((pack) => pack.id.endsWith("/cats"));
    assert.deepEqual(
      cats.stickers.map((sticker) => sticker.name),
      ["happy"],
    );
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
    assert.equal(
      id.split("/").length,
      3,
      "the fixture must produce a two-slash id",
    );

    const found = findStickerById(catalog, id);
    assert.equal(found?.name, "ok", "the full id resolves");
    assert.equal(findStickerById(catalog, "nope/missing"), undefined);
    assert.equal(findStickerById(catalog, ""), undefined);
    assert.equal(findStickerById(undefined, id), undefined);

    // The display split is unchanged — it is only ever used for reporting.
    assert.deepEqual(splitStickerId(id), {
      pack: id.split("/")[0],
      sticker: id.split("/").slice(1).join("/"),
    });
    assert.deepEqual(stickerIds(catalog), [id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildCatalog reports unusable roots instead of throwing", async () => {
  const catalog = await buildCatalog(
    readConfig({ paths: [join(tmpdir(), "emote-chat-definitely-missing")] }),
  );
  assert.equal(catalog.packs.length, 0);
  assert.equal(catalog.errors.length, 1);
  assert.equal(catalog.errors[0].reason, "missing");
});

test("buildCatalog skips SVG files without an intrinsic size", async () => {
  const root = await scratch("svg");
  try {
    await writeFile(
      join(root, "sized.svg"),
      '<svg width="32" height="32"><rect/></svg>',
    );
    await writeFile(
      join(root, "viewbox.svg"),
      '<svg viewBox="0 0 10 20"><rect/></svg>',
    );
    await writeFile(join(root, "floating.svg"), "<svg><rect/></svg>");
    const catalog = await buildCatalog(readConfig({ paths: [root] }));
    const names = catalog.packs
      .flatMap((pack) => pack.stickers.map((sticker) => sticker.name))
      .sort();
    assert.deepEqual(names, ["sized", "viewbox"]);
    const viewbox = catalog.packs[0].stickers.find(
      (sticker) => sticker.name === "viewbox",
    );
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
