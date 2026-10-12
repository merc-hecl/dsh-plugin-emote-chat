/**
 * [INPUT]: connection、Loader fiber.entry、可选 tools/systemPrompt/settings 与本包业务模块
 * [OUTPUT]: Config、inject、apply，发布配置/素材/reaction API、emote_reply 与 list_stickers
 * [POS]: 当前 Loader 条目与 settings 契约；单包服务组装，不使用旧命名空间回退
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { promises as fs } from "node:fs";
import { readConfig, Config } from "./config.js";
import { buildCatalog, findStickerById, MAX_STICKER_BYTES } from "./catalog.js";
import { createReactionStore } from "./reactions.js";
import { emoteReplyTool, promptTextFor } from "./tool.js";
import { listStickersTool } from "./discovery.js";
export { Config };
export const name = "emote-chat";
export const inject = ["connection"];
const API_ROOT = "/api/emote-chat";

export async function apply(ctx, config = {}) {
  const store = createReactionStore({ logger: ctx.logger });
  const state = { catalog: undefined };
  let catalogKey;
  let catalogAt = 0;
  let pending;
  let registered = false;
  let settingsProvider;
  let disposed = false;
  const settings = () => readConfig(config);
  async function catalog(force = false) {
    const current = settings();
    const key = JSON.stringify(current.paths);
    if (
      !force &&
      key === catalogKey &&
      state.catalog &&
      Date.now() - catalogAt < 15000
    )
      return state.catalog;
    if (pending?.key === key) return pending.promise;
    const promise = buildCatalog(current)
      .then((result) => {
        if (!disposed && JSON.stringify(settings().paths) === key) {
          catalogKey = key;
          state.catalog = result;
          catalogAt = Date.now();
        }
        return result;
      })
      .finally(() => {
        if (pending?.promise === promise) pending = undefined;
      });
    pending = { key, promise };
    return promise;
  }
  const service = {
    settings,
    rescan: () => catalog(true),
    react: (agent, emoji) => store.add(agent, emoji),
    toolRegistered: () => registered,
  };
  ctx.provide("emoteChat", service);
  ctx.inject(["tools"], (scope) =>
    scope.effect(() => {
      const disposers = [];
      try {
        for (const definition of [
          emoteReplyTool(service),
          listStickersTool(service),
        ]) {
          disposers.push(scope.tools.register(definition));
        }
      } catch (error) {
        for (const dispose of disposers.reverse()) dispose?.();
        throw error;
      }
      registered = true;
      return () => {
        registered = false;
        for (const dispose of disposers.reverse()) dispose?.();
      };
    }, "emote-chat: tool"),
  );
  ctx.inject(["systemPrompt"], (scope) =>
    scope.effect(
      () =>
        scope.systemPrompt.section({
          name: "emote-chat:stickers",
          order: 176,
          text: () => {
            return promptTextFor(registered, settings);
          },
        }),
      "emote-chat: prompt",
    ),
  );
  ctx.inject(["settings"], (scope) =>
    scope.effect(() => {
      settingsProvider = scope.settings;
      return () => {
        settingsProvider = undefined;
      };
    }, "emote-chat: settings"),
  );

  const json = (body, status = 200) =>
    Response.json(body, { status, headers: { "cache-control": "no-store" } });
  function route(suffix, methods, fetch) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: API_ROOT + suffix,
          methods,
          requestBody: "buffered",
          fetch: async (request) => {
            try {
              return await fetch(request);
            } catch (error) {
              ctx.logger?.warn?.(`emote-chat${suffix}: ${error.message}`);
              return json({ ok: false, message: error.message }, 500);
            }
          },
        }),
      `emote-chat: ${suffix}`,
    );
  }
  route("/settings", ["POST"], async (request) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, message: "invalid-json" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ ok: false, message: "invalid-settings" }, 400);
    if (!settingsProvider)
      return json(
        { ok: false, message: "host settings service unavailable" },
        503,
      );
    const next = readConfig({ ...settings(), ...body });
    // Desktop 0.2.0-rc.2 / Cordis 4.0.4: Loader metadata belongs to the fiber.
    const ns = ctx.fiber.entry.options.id;
    await settingsProvider.update(ns, next);
    state.catalog = undefined;
    catalogAt = 0;
    return json({ ok: true });
  });
  route("/config", ["GET", "HEAD"], async (request) => {
    if (request.method === "HEAD") return new Response(null);
    const current = settings();
    const known = current.stickerReply
      ? await catalog()
      : { packs: [], errors: [] };
    return json({
      ...current,
      packs: known.packs.map((pack) => ({
        ...pack,
        stickers: pack.stickers.map(({ file, ...sticker }) => sticker),
      })),
      errors: known.errors,
      ...(new URL(request.url).searchParams.get("debug") === "1"
        ? {
            debug: {
              toolRegistered: registered,
              store: { reactions: store.snapshot().reactions.length },
            },
          }
        : {}),
    });
  });
  route("/reactions", ["GET"], async (request) => {
    const url = new URL(request.url);
    if (!settings().emojiReply)
      return json({
        ...store.snapshot(),
        reactions: [],
        enabled: false,
      });
    if (url.searchParams.get("wait") === "1")
      await store.wait(
        Number(url.searchParams.get("since") ?? 0),
        url.searchParams.get("epoch"),
        request.signal,
      );
    return json({
      ...store.snapshot(),
      enabled: settings().emojiReply,
      ...(!settings().emojiReply ? { reactions: [] } : {}),
    });
  });
  route("/clean", ["POST"], async () =>
    json({ ok: true, removed: store.clear(), stored: 0 }),
  );
  route("/sticker", ["GET", "HEAD"], async (request) => {
    if (!settings().stickerReply)
      return new Response("stickers disabled", { status: 404 });
    const id = new URL(request.url).searchParams.get("id");
    const sticker = findStickerById(await catalog(), id);
    if (!sticker) return new Response("not found", { status: 404 });
    let bytes;
    try {
      bytes = await fs.readFile(sticker.file);
    } catch {
      return new Response("not found", { status: 404 });
    }
    if (bytes.length > MAX_STICKER_BYTES)
      return new Response("sticker too large", { status: 413 });
    return new Response(request.method === "HEAD" ? null : bytes, {
      headers: {
        "content-type": sticker.mime,
        "content-length": String(bytes.length),
        "cache-control": "private, no-cache",
        "content-security-policy":
          "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      },
    });
  });
  ctx.effect(
    () => () => {
      disposed = true;
      store.dispose();
    },
    "emote-chat: lifecycle",
  );
}
