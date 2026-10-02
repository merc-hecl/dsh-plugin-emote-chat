/**
 * [INPUT]: 依赖 node 文件系统读取 profile 设置与素材目录，依赖注入的 tools 注册器
 * [OUTPUT]: 提供 name、inject、apply 与 mountState；发布 emote_reply 的 JSON Schema 和执行器
 * [POS]: 模型侧工具插件，与 UI 插件共享设置文档；不承担浏览器渲染和 HTTP 路由
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 *
 * dsh-plugin-emote-chat-tool — the model-facing half.
 *
 * This is a SEPARATE package on purpose. Its only job is to register
 * `emote_reply`, and it declares `tools` as a hard dependency so the Loader
 * activates it exactly where the tool registry exists — which is how every
 * shipped tool plugin works (`@deepseek-ai/dsh-tool-cordis` declares
 * `inject = ['tools', 'cordisInspect']` and is mounted inside the agent preset).
 *
 * Registering from the UI half was not possible: a context that merely
 * *inherits* the service cannot read it with `ctx.get('tools')`, and an inject
 * wait there never resolved — verified from the live trace of the UI half, where
 * both its own scope and every preset scope reported "no tools registry".
 *
 * The UI half (`dsh-plugin-emote-chat`) owns the settings, the catalog, the
 * routes, and the browser surface; this half only publishes the tool.
 *
 * @module dsh-plugin-emote-chat-tool
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as bridge from "./bridge.js";

/** Stable Cordis plugin name. */
export const name = "emote-chat-tool";

/** The tool registry and the settings document this row reads. */
export const inject = ["tools"];

/** Registration state, surfaced by the UI half's diagnostics route. */
const MOUNT = { registered: false, registeredAt: 0, error: null };

/** Route prefix owned by the UI half (relative URLs work in `fetch`). */
const API_ROOT = "/api/emote-chat";

/** The harness home: the launcher-provided value, else the default. */
function harnessHome() {
  const fromEnvironment = process.env.DSH_HOME;
  if (typeof fromEnvironment === "string" && fromEnvironment.trim() !== "") return fromEnvironment;
  return join(homedir(), ".dsh");
}

/** Unwrap one `.volatile()` field (a reference read through `.get()`). */
function unwrapField(value) {
  if (value !== null && typeof value === "object" && typeof value.get === "function") {
    try {
      return value.get();
    } catch {
      return undefined;
    }
  }
  return value;
}

/** Read the plugin's live fields out of a profile patch document. */
function parseSettingsDocument(text) {
  const region = findRowConfig(text, "emote-chat");
  if (region === undefined) return undefined;
  const value = (key) => {
    const match = new RegExp(`^[ \\t]+${key}:[ \\t]*(.*)$`, "mu").exec(region);
    return match?.[1]?.trim();
  };
  return {
    stickerReply: value("stickerReply") === "true",
    emojiReply: value("emojiReply") === "true",
    emojiRain: value("emojiRain") === "true",
  };
}

/** Extract one row's `config:` block text from a patch document. */
function findRowConfig(text, rowId) {
  const idMatch = new RegExp(`^([ \\t]*)-[ \\t]*id:[ \\t]*${rowId}[ \\t]*$`, "mu").exec(text);
  if (idMatch === null) return undefined;
  const rowStart = text.lastIndexOf("\n", idMatch.index) + 1;
  const configMatch = /^([ \t]*)config:[ \t]*$/mu.exec(text.slice(rowStart));
  if (configMatch === null) return undefined;
  const configAt = rowStart + configMatch.index;
  const indent = configMatch[1].length;
  const lines = text.slice(configAt).split("\n");
  let consumed = 1;
  while (consumed < lines.length) {
    const line = lines[consumed];
    if (line.trim() === "") {
      consumed += 1;
      continue;
    }
    if (line.length - line.trimStart().length < indent) break;
    consumed += 1;
  }
  return lines.slice(0, consumed).join("\n");
}

/**
 * Read the live settings, trying each profile in turn.
 *
 * The UI half resolves the same document through the Loader-provided profile
 * environment; this half is mounted in a preset scope where that environment is
 * not published, so it locates the profile that names the plugin instead.
 *
 * `DSH_EMOTE_PROFILE_DIR` pins the profile directory for tests and for
 * deployments that keep the profile outside `$DSH_HOME`.
 *
 * @returns the settings, or `undefined` when no patch file is readable.
 */
async function readSettings() {
  const explicit = process.env.DSH_EMOTE_PROFILE_DIR ?? process.env.DSH_PROFILE_DIR;
  const candidates = [];
  if (typeof explicit === "string" && explicit.trim() !== "") candidates.push(join(explicit, "cordis.patch.yml"));
  const root = join(harnessHome(), "profiles");
  try {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(root, entry.name, "cordis.patch.yml"));
    }
  } catch {
    /* no profiles directory: fall through to the explicit candidate */
  }
  for (const file of candidates) {
    try {
      const text = await fs.readFile(file, "utf8");
      const settings = parseSettingsDocument(text);
      if (settings !== undefined) return settings;
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

/**
 * The catalog of stickers the tool may send.
 *
 * Read from the UI half through the bridge, never scanned here. This module used
 * to carry its own walker, and the two drifted: the UI half names a pack built
 * from sub-directories `base/sub` with sticker ids `base/sub/name`, while this
 * walker flattened every nested folder into a single dash-joined name. So a
 * sticker the picker offered as `memes/happy/ok` was rejected by the tool as
 * unknown — the tool simply could not send anything from a nested pack.
 *
 * One scanner, one naming rule: the UI half owns it, and this module asks for it.
 *
 * @returns the catalog, or undefined when the UI half is not loaded.
 */
async function catalog() {
  const face = bridge.catalog();
  if (face === undefined) return undefined;
  return { packs: face.packs ?? [] };
}

/** Every sticker id the catalog holds, for the error message. */
function catalogIds(catalog) {
  return (catalog?.packs ?? []).flatMap((pack) =>
    (pack.stickers ?? []).map((sticker) => sticker.id ?? `${pack.id}/${sticker.name}`),
  );
}

/**
 * Build the `emote_reply` definition.
 *
 * @returns a tool definition accepted by `ctx.tools.register`.
 */
function reactionTool() {
  return {
    name: "emote_reply",
    description:
      "React to the user's latest message with one emoji, the way a chat app reaction works, or send a sticker from the configured packs. " +
      "Use it for tone — agreement, amusement, sympathy, a quick acknowledgement — instead of writing the emoji or the sticker into your reply. " +
      "The reaction appears under the user's message and is NOT part of the conversation, so it never replaces a substantive answer. " +
      "At most one call per user turn, and never on consecutive turns unless the user keeps reacting.",
    parameters: {
      // dsh-tools 0.2.0-rc.2：register 直接投影 JSON Schema；
      // 字段字典仅供 defineTool 使用，不能直接传给 register。
      type: "object",
      properties: {
        emoji: {
          type: "string",
          description: "A reaction emoji. Any emoji is accepted. Use alone for a plain reaction.",
        },
        sticker: {
          type: "string",
          description: "A sticker id in `pack/name` form, from the pack list in your instructions; it is posted into the conversation.",
        },
      },
      additionalProperties: false,
    },
    output: {
      // `required` is only supported on an OBJECT node, as an array of property
      // names. Writing `required: true` inside a scalar member is rejected at
      // registration time (JsonSchemaError) and fails the whole plugin row.
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          kind: { type: "string" },
          emoji: { type: "string" },
          sticker: { type: "string" },
          message: { type: "string" },
        },
        required: ["ok", "kind", "message"],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: "text", text: String(value?.message ?? "") }],
    },
    presentCall: (args) => ({
      card: "generic",
      title:
        typeof args?.sticker === "string" && args.sticker !== ""
          ? `Sticker ${args.sticker}`
          : `React ${String(args?.emoji ?? "")}`.trim(),
      kind: "other",
      rawInput: args,
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: String(result?.value?.message ?? ""),
      content: result?.content,
    }),
    execute: async (args, exec) => {
      const settings = await readSettings();
      if (settings === undefined) {
        throw new Error("the emote-chat settings document could not be read");
      }
      const stickerId = typeof args?.sticker === "string" ? args.sticker.trim() : "";
      if (stickerId !== "") {
        if (!settings.stickerReply) throw new Error("sticker replies are disabled in Settings → Stickers & emoji");
        // Ask the UI half, which owns the scanner, and match the full id — a
        // nested pack's ids carry two slashes, so a pack/name split never
        // matches them.
        const known = await catalog();
        if (known === undefined) {
          throw new Error("the sticker catalog is not available; the Stickers & emoji plugin row is not loaded");
        }
        const found = (known.packs ?? []).some((pack) =>
          (pack.stickers ?? []).some((sticker) => (sticker.id ?? `${pack.id}/${sticker.name}`) === stickerId),
        );
        if (!found) {
          const available = catalogIds(known).slice(0, 40).join(", ");
          throw new Error(`unknown sticker "${stickerId}"; available — ${available || "(no packs configured)"}`);
        }
        // The sticker is delivered by the TOKEN, not by an image URL.
        //
        // This message used to hand over an `image` URL and tell the model to write
        // `![id](url)`. That instruction was never followed, and it could not have
        // worked: a user bubble is rendered through the chat's plain-text projection,
        // so Markdown in it is shown literally, and painting is what turns a token into
        // an image — on both sides of the conversation. A session store confirms the
        // token is what the model writes and the URL never appears. Telling the model to
        // do the thing that works, in the same wording as the prompt section, is one
        // fewer contradictory instruction for it to reconcile.
        return {
          ok: true,
          kind: "sticker",
          sticker: stickerId,
          message:
            `Sticker sent: ${stickerId}. Write this token on its own line in your reply to show it: ` +
            `[[sticker:${stickerId}]] — the chat renders the image while the transcript keeps the token.`,
        };
      }
      const raw = typeof args?.emoji === "string" ? args.emoji.trim() : "";
      const emoji = [...raw].slice(0, 2).join("");
      if (emoji === "") throw new Error("pass either `emoji` (a reaction) or `sticker` (pack/name)");
      if (!settings.emojiReply) throw new Error("emoji reactions are disabled in Settings → Stickers & emoji");
      // No allow-list. There used to be one, with a 40-emoji fallback list when the
      // settings named none — and because the settings never name any, that fallback
      // was silently in force and the tool rejected anything outside it. The user's
      // requirement is that any emoji works; the Host already validates the character
      // with a Unicode property test before recording it, which is the only check the
      // feature needs.
      // This is the step that makes the chip appear. Returning a message alone
      // painted nothing: the browser reads reactions from the UI half's channel
      // with `session`, so without recording one here the chip had no source.
      // The bridge carries it across the two plugin rows in-process.
      const sessionId = typeof exec?.agent?.id === "string" && exec.agent.id !== "" ? exec.agent.id : undefined;
      bridge.react(sessionId, emoji);
      return {
        ok: true,
        kind: "emoji",
        emoji,
        message: `Reacted ${emoji}. Do not repeat the emoji in your reply text — the UI shows it under the user's message.`,
      };
    },
  };
}

/**
 * Register `emote_reply` into the tool registry this row was injected with.
 *
 * Kept deliberately minimal: this row exists to be activated exactly where the
 * tool registry lives, so it only declares its dependency and registers. The
 * registration is wrapped so a refusal is reported instead of failing the fiber
 * silently, and the outcome is exposed for diagnostics.
 *
 * @param ctx - the context carrying `tools`.
 */
export function apply(ctx) {
  ctx.effect(() => {
    try {
      const dispose = ctx.tools.register(reactionTool());
      MOUNT.registered = true;
      MOUNT.registeredAt = Date.now();
      MOUNT.error = null;
      bridge.setToolRegistered(true);
      ctx.logger?.info?.("emote-chat-tool: emote_reply registered");
      return () => {
        MOUNT.registered = false;
        bridge.setToolRegistered(false);
        dispose?.();
      };
    } catch (error) {
      MOUNT.error = String(error?.message ?? error);
      ctx.logger?.warn?.(`emote-chat-tool: emote_reply not registered: ${MOUNT.error}`);
      return () => {};
    }
  }, "emote-chat-tool: emote_reply");
}

/** Registration state for diagnostics (module state, so it needs no service). */
export const mountState = MOUNT;
