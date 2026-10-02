/**
 * [INPUT]: 依赖 node:test 与文件系统夹具，消费 lib/index.js 的工具注册入口
 * [OUTPUT]: 验证注册参数的对象契约、输出 schema 与设置驱动的执行行为
 * [POS]: 工具插件的回归边界；直接检查注册定义，避免替实现补齐 schema 掩盖错误
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply, inject, name } from "../lib/index.js";

/** A profile patch shaped like the real one, with the plugin row present. */
const PATCH = `# Your patch layer for this dsh profile.
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: zh
- id: emote-chat
  config:
    stickerReply: true
    paths:
      - 'D:\\stickers\\cats'
      - "D:\\stickers with space\\dogs"
    emojiReply: true
    emojiRain: true
    emojiList: []
  disabled: false
- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
`;

test("the tool half declares the tool registry as a hard dependency", () => {
  assert.equal(name, "emote-chat-tool");
  assert.deepEqual(inject, ["tools"]);
});

test("apply registers emote_reply with the injected registry", () => {
  const registered = [];
  const ctx = {
    provide: () => {},
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    tools: {
      register: (definition) => {
        registered.push(definition);
        return () => {};
      },
    },
  };
  apply(ctx);
  assert.equal(registered.length, 1);
  const tool = registered[0];
  assert.equal(tool.name, "emote_reply");
  assert.equal(typeof tool.execute, "function");
  assert.equal(typeof tool.output.render, "function");
  assert.equal(tool.parameters.type, "object");
  assert.ok(tool.parameters.properties.emoji);
  assert.ok(tool.parameters.properties.sticker);
  assert.equal(tool.parameters.required, undefined);
  // The harness schema rejects `required` on scalar members — only object and
  // array nodes may carry it. Getting this wrong fails the whole plugin row
  // with `JsonSchemaError: unsupported JSON schema`.
  for (const [key, schema] of Object.entries(tool.output.schema.properties)) {
    assert.equal(schema.required, undefined, `output.properties.${key} must not declare required`);
  }
  for (const [key, schema] of Object.entries(tool.parameters.properties)) {
    if (schema.type === "object" || schema.type === "array") continue;
    assert.equal(schema.required, undefined, `parameters.${key} must not declare required`);
  }
});

/**
 * The harness's enforced JSON-Schema subset: a keyword is only legal on the
 * node type that owns it, and `required` is an object-only array of property
 * names. Both mistakes below failed the plugin row at activation time with a
 * `JsonSchemaError`, so the suite checks the definition the way the registry
 * does before it ever reaches a running harness.
 *
 * @param node - a raw schema node.
 * @param path - diagnostic path.
 * @param violations - accumulator.
 */
function checkSchemaSubset(node, path, violations) {
  if (node === null || typeof node !== "object") return;
  if (path === "parameters" && node.type !== "object") {
    violations.push("parameters must declare an object root");
  }
  const scalar = ["string", "number", "integer", "boolean", "null"];
  const owners = {
    properties: ["object"],
    required: ["object"],
    additionalProperties: ["object"],
    items: ["array"],
    enum: scalar,
    const: scalar,
  };
  for (const [key, types] of Object.entries(owners)) {
    if (Object.hasOwn(node, key) && !types.includes(node.type)) {
      violations.push(`${path}.${key} is not supported on type "${node.type}"`);
    }
  }
  if (node.type === "object" && Object.hasOwn(node, "required")) {
    if (!Array.isArray(node.required) || node.required.length === 0) {
      violations.push(`${path}.required must be a non-empty array of property names`);
    } else {
      for (const name of node.required) {
        if (!Object.hasOwn(node.properties ?? {}, name)) {
          violations.push(`${path}.required names an undeclared property "${name}"`);
        }
      }
    }
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    checkSchemaSubset(child, `${path}.properties.${key}`, violations);
  }
}

test("the tool definition satisfies the harness JSON-Schema subset", () => {
  let tool;
  apply({
    effect: (callback) => {
      callback();
      return () => {};
    },
    tools: { register: (definition) => ((tool = definition), () => {}) },
  });
  const violations = [];
  checkSchemaSubset(tool.output.schema, "output.schema", violations);
  checkSchemaSubset(tool.parameters, "parameters", violations);
  assert.deepEqual(violations, []);
  assert.deepEqual(tool.output.schema.required, ["ok", "kind", "message"]);
});

test("the schema check rejects the old property-map registration", () => {
  const violations = [];
  checkSchemaSubset({ emoji: { type: "string" }, sticker: { type: "string" } }, "parameters", violations);
  assert.deepEqual(violations, ["parameters must declare an object root"]);
});

test("execute validates stickers against the catalog the UI half publishes", async () => {
  // The tool no longer scans folders itself: the UI half owns the one scanner,
  // and a second copy in the tool drifted from it — it flattened nested folders,
  // so the tool rejected every sticker the picker offered. The catalog now
  // arrives over the process bridge, exactly as it does at runtime.
  const home = await mkdtemp(join(tmpdir(), "emote-tool-"));
  const profile = join(home, "profiles", "desktop");
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "cordis.patch.yml"), PATCH, "utf8");

  const previousHome = process.env.DSH_HOME;
  const previousProfile = process.env.DSH_EMOTE_PROFILE_DIR;
  process.env.DSH_HOME = home;
  process.env.DSH_EMOTE_PROFILE_DIR = profile;
  const bridge = await import("../lib/bridge.js");
  bridge.publish({
    catalog: () => ({
      packs: [
        // A nested pack: its ids carry two slashes, which is the shape that used
        // to fail here.
        { id: "memes/happy", name: "memes/happy", stickers: [{ id: "memes/happy/ok", name: "ok" }] },
        { id: "cats", name: "cats", stickers: [{ id: "cats/happy", name: "happy" }] },
      ],
    }),
  });
  try {
    let tool;
    apply({
      provide: () => {},
      effect: (callback) => {
        callback();
        return () => {};
      },
      tools: { register: (definition) => ((tool = definition), () => {}) },
    });

    const nested = await tool.execute({ sticker: "memes/happy/ok" }, { agent: { id: "s1" } });
    assert.equal(nested.ok, true);
    assert.equal(nested.kind, "sticker");
    assert.equal(nested.sticker, "memes/happy/ok", "a nested id survives untouched");

    // The sticker costs one token, and the result must ask for exactly that.
    //
    // It used to answer with an `/api/emote-chat/sticker?id=…` URL and tell the model to
    // write image Markdown. That instruction could not work — a user bubble is rendered
    // as plain text, and painting is what turns a token into an image on both sides —
    // and a session store showed the model writing the token and never the URL. So the
    // result now names the token, and this pins both halves: the token is asked for, and
    // no URL or Markdown form is offered as an alternative.
    assert.match(nested.message, /\[\[sticker:memes\/happy\/ok\]\]/u, "the result asks for the token");
    assert.doesNotMatch(nested.message, /!\[/u, "no Markdown image form");
    assert.doesNotMatch(nested.message, /\/api\/emote-chat/u, "and no URL to write instead");
    assert.equal(nested.image, undefined, "the URL field is gone, not merely unused");

    const flat = await tool.execute({ sticker: "cats/happy" }, { agent: { id: "s1" } });
    assert.equal(flat.ok, true, "a flat pack still resolves");

    const emoji = await tool.execute({ emoji: "🎉" }, { agent: { id: "s1" } });
    assert.equal(emoji.kind, "emoji");

    await assert.rejects(() => tool.execute({ sticker: "cats/missing" }, { agent: { id: "s1" } }), /unknown sticker/u);
    await assert.rejects(() => tool.execute({ sticker: "memes/happy" }, { agent: { id: "s1" } }), /unknown sticker/u, "a pack name alone is not a sticker");
    await assert.rejects(() => tool.execute({}, { agent: { id: "s1" } }), /pass either/u);

    // Any emoji reacts; there is no allow-list.
    //
    // This used to assert the opposite — that an emoji outside the list was rejected
    // with "not allowed" — which meant the suite was guarding the very restriction the
    // user had asked to remove. The restriction survived because the settings file
    // names no emoji list, so a 40-emoji fallback was silently in force. Now that the
    // check is gone, the test asserts the behaviour that was actually requested.
    for (const anyEmoji of ["🚫", "⭐", "🫠", "🧿", "🇯🇵"]) {
      const reaction = await tool.execute({ emoji: anyEmoji }, { agent: { id: "s1" } });
      assert.equal(reaction.kind, "emoji", `${anyEmoji} is accepted`);
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousProfile === undefined) delete process.env.DSH_EMOTE_PROFILE_DIR;
    else process.env.DSH_EMOTE_PROFILE_DIR = previousProfile;
    await rm(home, { recursive: true, force: true });
  }
});

test("a sticker send fails loudly when the UI half is absent", async () => {
  const bridge = await import("../lib/bridge.js");
  const slot = process[Symbol.for("dsh-plugin-emote-chat/bridge@1")];
  const saved = slot.catalog;
  delete slot.catalog;
  try {
    let tool;
    apply({
      provide: () => {},
      effect: (callback) => {
        callback();
        return () => {};
      },
      tools: { register: (definition) => ((tool = definition), () => {}) },
    });
    await assert.rejects(
      () => tool.execute({ sticker: "cats/happy" }, { agent: { id: "s1" } }),
      /catalog is not available/u,
      "without a catalog the tool must refuse rather than send an unverified id",
    );
  } finally {
    slot.catalog = saved;
  }
});

test("execute records the reaction through the process bridge", async () => {
  // This is the step that actually makes the chip appear: returning a message
  // alone painted nothing because the browser reads reactions from the UI half's
  // channel. The two halves are separate plugin rows, so they meet on `process`.
  const home = await mkdtemp(join(tmpdir(), "emote-bridge-"));
  const profile = join(home, "profiles", "desktop");
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, "cordis.patch.yml"),
    "- id: emote-chat\n  config:\n    stickerReply: true\n    emojiReply: true\n    emojiList: []\n",
    "utf8",
  );
  const previous = process.env.DSH_EMOTE_PROFILE_DIR;
  process.env.DSH_EMOTE_PROFILE_DIR = profile;
  const recorded = [];
  const bridge = await import("../lib/bridge.js");
  bridge.publish({ react: (sessionId, emoji) => (recorded.push([sessionId, emoji]), { seq: 1 }) });
  try {
    let tool;
    apply({
      provide: () => {},
      effect: (callback) => {
        callback();
        return () => {};
      },
      tools: { register: (definition) => ((tool = definition), () => {}) },
    });
    await tool.execute({ emoji: "🎉" }, { agent: { id: "agent-7" } });
    assert.deepEqual(recorded, [["agent-7", "🎉"]], "the reaction must reach the UI half's sink");
    await tool.execute({ sticker: "cats/happy" }, { agent: { id: "agent-7" } }).catch(() => {});
    assert.equal(recorded.length, 1, "a sticker is not a reaction");
  } finally {
    if (previous === undefined) delete process.env.DSH_EMOTE_PROFILE_DIR;
    else process.env.DSH_EMOTE_PROFILE_DIR = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test("apply advertises tool presence on the bridge", async () => {
  const bridge = await import("../lib/bridge.js");
  let release;
  apply({
    provide: () => {},
    effect: (callback) => {
      release = callback();
      return release;
    },
    tools: { register: () => () => {} },
  });
  assert.equal(bridge.toolRegistered(), true, "the UI half words its prompt from this flag");
  release();
  assert.equal(bridge.toolRegistered(), false, "unloading the row must clear the flag");
});
