/**
 * [INPUT]: node:test 与 Host/config/catalog/reaction 模块
 * [OUTPUT]: 单包生命周期、配置契约、存储和消息身份回归测试
 * [POS]: 宿主适配回归；使用临时目录，禁止读取真实用户存储
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apply } from "../lib/index.js";
import { buildCatalog, findStickerById } from "../lib/catalog.js";
import {
  createReactionStore,
  assertReactionEmoji,
  reactionTarget,
} from "../lib/reactions.js";

function agent(extra = []) {
  return {
    id: "session",
    session: {
      snapshotEvents: () => [
        { type: "turn/start", seq: 1, data: { turn: 1 } },
        { type: "step/start", seq: 2 },
        {
          type: "user/message",
          seq: 3,
          data: { id: "message", source: { kind: "user" } },
        },
        ...extra,
      ],
    },
  };
}
async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), "emote-regression-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function mount(t, initial = {}, options = {}) {
  const dir = await scratch(t);
  const old = process.env.DSH_EMOTE_STORAGE_DIR;
  process.env.DSH_EMOTE_STORAGE_DIR = dir;
  const values = {
    stickerReply: false,
    paths: [],
    emojiReply: true,
    emojiRain: false,
    ...initial,
  };
  const config = Object.fromEntries(
    Object.keys(values).map((key) => [key, { get: () => values[key] }]),
  );
  const routes = new Map(),
    tools = new Map(),
    sections = [],
    disposers = [];
  let writes = 0;
  const effect = (cb) => {
    const result = cb();
    if (typeof result === "function") disposers.push(result);
    return result;
  };
  const services = {
    tools: {
      register(def) {
        tools.set(def.name, def);
        return () => tools.delete(def.name);
      },
    },
    systemPrompt: {
      section(def) {
        sections.push(def);
        return () => {};
      },
    },
    settings: {
      async update(ns, next) {
        assert.equal(ns, "emote-chat");
        if (options.failWrite) throw new Error("disk refused");
        writes++;
        Object.assign(values, next);
      },
    },
  };
  let service;
  await apply(
    {
      effect,
      provide: (_name, value) => (service = value),
      inject(names, cb) {
        if (names.some((name) => options.missing === name)) return;
        return cb({ ...services, effect });
      },
      connection: {
        fetch: {
          register(route) {
            routes.set(route.path, route);
            return () => routes.delete(route.path);
          },
        },
      },
      logger: { warn() {} },
    },
    config,
  );
  function dispose() {
    for (const cb of disposers.splice(0).reverse()) cb();
  }
  t.after(() => {
    dispose();
    if (old === undefined) delete process.env.DSH_EMOTE_STORAGE_DIR;
    else process.env.DSH_EMOTE_STORAGE_DIR = old;
  });
  const request = (path, body) =>
    routes
      .get("/api/emote-chat/" + path.split("?")[0])
      .fetch(
        new Request(
          "http://local/api/emote-chat/" + path,
          body === undefined
            ? {}
            : { method: "POST", body: JSON.stringify(body) },
        ),
      );
  return {
    dir,
    values,
    routes,
    tools,
    sections,
    service,
    request,
    dispose,
    writes: () => writes,
  };
}

test("one package registers tool, routes, and truthful synchronous guidance", async (t) => {
  const app = await mount(t);
  assert.equal(app.tools.size, 1);
  assert.equal(app.service.toolRegistered(), true);
  const definition = app.tools.get("emote_reply");
  assert.equal(definition.parameters.type, "object");
  assert.equal(definition.parameters.properties.emoji.type, "string");
  assert.equal(definition.parameters.properties.sticker.type, "string");
  assert.deepEqual(definition.output.schema.required, [
    "ok",
    "kind",
    "message",
  ]);
  assert.match(app.sections[0].text(), /through the `emote_reply` tool/);
  app.dispose();
  assert.equal(app.tools.size, 0);
});
test("UI routes still activate without tools", async (t) => {
  const app = await mount(t, {}, { missing: "tools" });
  assert.equal(app.tools.size, 0);
  assert.match(app.sections[0].text(), /no `emote_reply`/);
  assert.equal((await app.request("config")).status, 200);
});
test("settings delegate to host and preserve paths; volatile changes stay live", async (t) => {
  const app = await mount(t);
  const dir = join(app.dir, "cats");
  await mkdir(dir);
  await writeFile(join(dir, "ok.png"), "png");
  assert.equal(
    (await app.request("settings", { stickerReply: true, paths: [dir] }))
      .status,
    200,
  );
  assert.equal(app.writes(), 1);
  const configured = await (await app.request("config")).json();
  assert.deepEqual(configured.paths, [dir]);
  assert.equal(configured.packs[0].stickers[0].id, "cats/ok");
  app.values.emojiReply = false;
  assert.equal(app.service.settings().emojiReply, false);
  await assert.rejects(
    app.tools.get("emote_reply").execute({ emoji: "✅" }, { agent: agent() }),
    /disabled/,
  );
});
test("missing or refusing host settings return an explicit error", async (t) => {
  const missing = await mount(t, {}, { missing: "settings" });
  assert.equal(
    (await missing.request("settings", { emojiReply: false })).status,
    503,
  );
  const failed = await mount(t, {}, { failWrite: true });
  const response = await failed.request("settings", { emojiReply: false });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).ok, false);
  assert.equal(failed.values.emojiReply, true);
});
test("tool binds full emoji to first-step message, not steering", async (t) => {
  const app = await mount(t);
  const steering = [
    { type: "step/start", seq: 4 },
    {
      type: "user/message",
      seq: 5,
      data: { id: "steering", source: { kind: "user" } },
    },
  ];
  const result = await app.tools
    .get("emote_reply")
    .execute({ emoji: "👨‍👩‍👧‍👦" }, { agent: agent(steering) });
  assert.equal(result.emoji, "👨‍👩‍👧‍👦");
  const payload = await (await app.request("reactions")).json();
  assert.equal(payload.reactions[0].messageId, "message");
  app.dispose();
  const saved = JSON.parse(
    await readFile(join(app.dir, "emote-chat-reactions.json"), "utf8"),
  );
  assert.deepEqual(saved.rows, [["message", 1, "👨‍👩‍👧‍👦"]]);
});
test("identity refuses absent, finished and non-human turns", () => {
  assert.throws(() => reactionTarget({}), /session event/);
  assert.throws(() => reactionTarget(agent([{ type: "turn/end" }])), /ended/);
  assert.throws(
    () => reactionTarget(agent([{ type: "step/start" }, { type: "turn/end" }])),
    /ended/,
  );
  assert.throws(
    () =>
      reactionTarget({
        session: {
          snapshotEvents: () => [
            { type: "turn/start" },
            {
              type: "user/message",
              data: { id: "x", source: { kind: "runtime-context" } },
            },
          ],
        },
      }),
    /human/,
  );
});
test("emoji validation preserves flags, keycaps, ZWJ and rejects multiple clusters", () => {
  for (const emoji of ["🇨🇳", "1️⃣", "👍🏽", "👩‍💻", "👨‍👩‍👧‍👦"])
    assert.equal(assertReactionEmoji(emoji), emoji);
  for (const emoji of ["hello", "👍🎉", "a😊", ""])
    assert.throws(() => assertReactionEmoji(emoji));
});
test("clear wakes subscription, replaces snapshot and persists revision", async (t) => {
  const app = await mount(t);
  await app.tools
    .get("emote_reply")
    .execute({ emoji: "✅" }, { agent: agent() });
  const before = await (await app.request("reactions")).json();
  const waiting = app.request(
    `reactions?wait=1&since=${before.seq}&epoch=${before.epoch}`,
  );
  const clear = await (await app.request("clean", {})).json();
  assert.equal(clear.removed, 1);
  const after = await (await waiting).json();
  assert.equal(after.reset, true);
  assert.ok(after.seq > before.seq);
  assert.deepEqual(after.reactions, []);
  const restored = createReactionStore({
    file: join(app.dir, "emote-chat-reactions.json"),
  });
  t.after(() => restored.dispose());
  assert.equal(restored.snapshot().seq, after.seq);
  assert.deepEqual(restored.snapshot().reactions, []);
});
test("store bounds, restores without duplication, and creates directory on teardown", async (t) => {
  const dir = await scratch(t),
    file = join(dir, "new", "reactions.json");
  const store = createReactionStore({ file });
  for (let n = 0; n < 505; n++) store.add(agent(), "🎉");
  store.dispose();
  const restored = createReactionStore({ file });
  t.after(() => restored.dispose());
  assert.equal(restored.snapshot().reactions.length, 500);
  assert.equal(restored.snapshot().seq, 505);
  assert.notEqual(store.snapshot().epoch, restored.snapshot().epoch);
});
test("disabled endpoint returns retry policy and no reactions", async (t) => {
  const app = await mount(t, { emojiReply: false });
  const result = await (await app.request("reactions?wait=1")).json();
  assert.equal(result.enabled, false);
  assert.equal(result.retryAfterMs, 2500);
});
test("duplicate pack roots are rejected instead of aliasing images", async (t) => {
  const dir = await scratch(t);
  const paths = [join(dir, "a", "cats"), join(dir, "b", "cats")];
  for (const path of paths) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "ok.png"), "png");
  }
  const catalog = await buildCatalog({ paths });
  assert.equal(catalog.packs.length, 1);
  assert.equal(catalog.errors[0].reason, "duplicate-pack");
  assert.equal(
    findStickerById(catalog, "cats/ok").file,
    join(paths[0], "ok.png"),
  );
});
test("unknown sticker fails and known sticker returns the transcript token", async (t) => {
  const app = await mount(t, { stickerReply: true });
  const dir = join(app.dir, "cats");
  await mkdir(dir);
  await writeFile(join(dir, "ok.png"), "png");
  app.values.paths = [dir];
  const tool = app.tools.get("emote_reply");
  await assert.rejects(
    tool.execute({ sticker: "cats/missing" }, {}),
    /unknown sticker/,
  );
  assert.match(
    (await tool.execute({ sticker: "cats/ok" }, {})).message,
    /\[\[sticker:cats\/ok\]\]/,
  );
});
