/**
 * dsh-plugin-emote-chat — Host half (UI, routes, settings, prompt guidance).
 *
 * Sticker and emoji reactions for the DeepSeek Harness Web (and Desktop) chat:
 *
 * - `/api/emote-chat/*` exact Fetch routes on the shared authenticated channel:
 *   the live settings projection, the sticker catalog scanned from the user's
 *   sticker directories, and the sticker image bytes themselves.
 * - one system-prompt section that teaches the model the sticker token
 *   (`[[sticker:pack/name]]`); the token stays in the transcript while the
 *   browser half paints the image.
 *
 * The model-facing `emote_reply` tool lives in the companion package
 * `dsh-plugin-emote-chat-tool`, which declares `inject: ['tools']` so the Loader
 * activates it exactly where the tool registry exists. A context that merely
 * *inherits* that service cannot register into it — verified live, where both
 * this plugin's own scope and every agent-preset scope reported no registry.
 *
 * The browser half (`lib/client.js`) owns every pixel: the Settings page, the
 * composer picker, sticker painting, the reaction chips, and the emoji rain.
 *
 * Verified against @deepseek-ai/dsh 0.2.0-rc.2 (desktop bundle).
 *
 * @module dsh-plugin-emote-chat
 */

import { createHash } from "node:crypto";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";

import * as bridge from "./bridge.js";

/**
 * Live configuration schema.
 *
 * Every field is `.volatile()`, which is what makes it editable from the Web
 * Settings page: `dsh-settings` projects only volatile fields into its forms,
 * and a form write lands back in this row inside the profile's own
 * `cordis.patch.yml`, so the value survives restarts and upgrades.
 *
 * The import stays optional on purpose: a profile that cannot resolve
 * `@deepseek-ai/schemastery` still gets every feature, just no declared schema,
 * and the row's own `config` remains the source of truth.
 */
let z;
try {
  z = (await import("@deepseek-ai/schemastery")).default;
} catch {
  z = undefined;
}

/** Live settings; the Settings page writes all five fields. */
export const Config = z?.object({
  stickerReply: z
    .boolean()
    .default(false)
    .description("Enable sticker / meme replies: the composer picker, the sticker folders, and the Agent's stickers.")
    .volatile(),
  paths: z
    .array(z.string())
    .default([])
    .description("Sticker folders. Each directory is one pack; nested folders become sub-packs.")
    .volatile(),
  emojiReply: z
    .boolean()
    .default(false)
    .description("Enable emoji replies: the Agent reacts to the newest user message with one emoji.")
    .volatile(),
  emojiRain: z
    .boolean()
    .default(false)
    .description("Draw each fresh emoji reaction as an emoji rain.")
    .volatile(),
});

/** Load-generation evidence shared by the diagnostics route. */
const MODULE_RUN = { loadedAt: Date.now(), applies: 0, appliedAt: 0, effects: [] };

/** Stable Cordis plugin name. */
export const name = "emote-chat";

/** The package that provides this row (the patch rows name it). */
const PACKAGE_NAME = "dsh-plugin-emote-chat";

/**
 * Hard service dependencies.
 *
 * Only `connection` is required, so the picker, the sticker painting and the
 * reaction chips never wait for anything else. The prompt section is registered
 * inside `ctx.inject(['systemPrompt'], …)`; the model-facing tool is a companion
 * package that injects `tools` itself.
 */
export const inject = ["connection"];

/** Public route prefix (must sit under `/api`). */
export const API_ROOT = "/api/emote-chat";

/** Sticker token the model and the picker both write. */
export const TOKEN_PREFIX = "[[sticker:";

/** Image extensions the catalog accepts; every one is a plain `<img>` source. */
const IMAGE_EXTENSIONS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".svg", "image/svg+xml"],
]);

/** Per-file size ceiling (a sticker is not a poster). */
const MAX_STICKER_BYTES = 12 * 1024 * 1024;

/** Directory-walk bounds: keep a first scan bounded even on a huge root. */
const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_ENTRIES = 4000;
const MAX_PACKS = 60;
const MAX_STICKERS_PER_PACK = 400;

/** Built-in reaction emoji, offered as the settings default. */
/**
 * What counts as an emoji reaction.
 *
 * Pictographic characters only, with the joiners and modifiers that build a
 * multi-codepoint emoji (a variation selector, a zero-width joiner, a skin tone,
 * a keycap). Plain text and the sticker token therefore fail, while any emoji the
 * model chooses succeeds — there is no list to keep up to date.
 *
 * A keycap (`1️⃣`) is the one exception worth spelling out: its base is an ASCII
 * digit, which is not pictographic, so it is matched by its own shape — digit or
 * `#`/`*`, then a variation selector, then the enclosing keycap mark.
 */
const EMOJI_PATTERN =
  /^(?:(?=.*\p{Extended_Pictographic})[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]+|[0-9#*]\u{FE0F}\u{20E3})$/u;

/** Reactions kept per session (ring buffer) and the long-poll ceiling. */
const MAX_REACTIONS_PER_SESSION = 200;
const MAX_SESSIONS_TRACKED = 200;
const REACTION_POLL_TIMEOUT_MS = 25000;

/** How long the catalog stays valid before a filesystem rescan. */
const CATALOG_TTL_MS = 15000;

// ─────────────────────────────── configuration ───────────────────────────────

/** @returns whether a value is a plain object (not an array, not null). */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Expand `~`/`~/…` and make a path absolute against the process directory. */
function expandPath(input) {
  const trimmed = String(input ?? "").trim().replace(/^"(.*)"$/u, "$1");
  if (trimmed === "") return "";
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

/** Split a stored path value that may be a list or a line-separated string. */
function toPathList(value) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/u) : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    for (const line of item.split(/\r?\n/u)) {
      const expanded = expandPath(line);
      if (expanded === "" || seen.has(expanded)) continue;
      seen.add(expanded);
      out.push(expanded);
    }
  }
  return out;
}

/**
 * Unwrap one configuration field.
 *
 * A `.volatile()` schema parses each field into a stable reference read through
 * `.get()`, so the object the Loader hands to `apply` is `{ field: ref }` rather
 * than `{ field: value }`. Reading the reference directly would silently yield
 * the schema defaults for every field — the settings page and the patch file
 * would look right while the plugin behaved as if nothing was configured.
 *
 * @param value - a field from the live config, or a plain value.
 * @returns the plain value.
 */
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

/** Read the effective settings from the row's live config. */
function readConfig(config) {
  const source = isRecord(config) ? config : {};
  return {
    stickerReply: unwrapField(source.stickerReply) === true,
    emojiReply: unwrapField(source.emojiReply) === true,
    emojiRain: unwrapField(source.emojiRain) === true,
    paths: toPathList(unwrapField(source.paths)),
  };
}

// ──────────────────────────────── sticker index ──────────────────────────────

/** Join a pack name and a sticker name into the wire id. */
function stickerId(pack, sticker) {
  return `${pack}/${sticker}`;
}

/**
 * Split a wire id for reporting; the first `/` separates pack from sticker name.
 *
 * This is a DISPLAY split only. Never use it to look a sticker up: a pack whose
 * folder contains sub-directories is named `base/sub` (see `buildCatalog`), so
 * its ids carry two slashes and splitting on the first one yields a pack that
 * does not exist. `findStickerById` matches the full id instead.
 */
function splitStickerId(id) {
  const at = String(id ?? "").indexOf("/");
  if (at <= 0 || at === String(id).length - 1) return undefined;
  return { pack: String(id).slice(0, at), sticker: String(id).slice(at + 1) };
}

/** Normalize any path segment into a safe, stable label. */
function labelOf(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

/** Sniff an animated GIF (`GIF87a`/`GIF89a`). */
function isGif(buffer) {
  return buffer.length > 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
}

/** Read a GIF's logical screen size, for natural-size painting in the browser. */
function gifSize(buffer) {
  if (!isGif(buffer) || buffer.length < 10) return undefined;
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

/**
 * Read a root SVG's fixed pixel size.
 *
 * An SVG without an intrinsic size paints unpredictably inside an `<img>`, so
 * only one with explicit numeric `width`/`height` (or a viewBox plus a numeric
 * width) enters the catalog.
 */
function svgSize(buffer) {
  const head = buffer.subarray(0, 4096).toString("utf8");
  const tag = /<svg\b[^>]*>/iu.exec(head)?.[0];
  if (tag === undefined) return undefined;
  const number = (name) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*["']?([0-9.]+)`, "iu").exec(tag);
    if (match === null) return undefined;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const declared = { width: number("width"), height: number("height") };
  if (declared.width !== undefined && declared.height !== undefined) return declared;
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1];
  if (viewBox === undefined) return undefined;
  const parts = viewBox.trim().split(/[\s,]+/u).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return undefined;
  const [, , width, height] = parts;
  if (!(width > 0) || !(height > 0)) return undefined;
  return { width: Math.round(width), height: Math.round(height) };
}

/** Depth-first walk with depth/entry bounds, returning image file paths. */
async function collectImages(root, state) {
  const found = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0 && state.entries < MAX_SCAN_ENTRIES) {
    const { dir, depth } = stack.pop();
    let children;
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (state.entries >= MAX_SCAN_ENTRIES) break;
      state.entries += 1;
      const full = join(dir, child.name);
      if (child.isDirectory()) {
        if (depth + 1 <= MAX_SCAN_DEPTH && !child.name.startsWith(".")) {
          stack.push({ dir: full, depth: depth + 1 });
        }
        continue;
      }
      if (!child.isFile()) continue;
      const extension = extname(child.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) continue;
      found.push({ path: full, relativePath: relative(root, full), extension });
    }
  }
  found.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return found;
}

/**
 * Build the sticker catalog from a settings snapshot.
 *
 * Each configured root becomes one pack, so `D:\stickers\cats` is the pack
 * `cats`. Nested folders inside a root become sub-packs (`cats/happy`) until
 * `MAX_PACKS` is reached; past that, folders flatten into the sticker name so a
 * deep tree still contributes images instead of vanishing.
 *
 * @param settings - the normalized settings snapshot.
 * @returns `{ packs, errors, scannedAt }`.
 */
async function buildCatalog(settings) {
  const packs = [];
  const errors = [];
  for (const root of settings.paths) {
    if (packs.length >= MAX_PACKS) break;
    let stat;
    try {
      stat = await fs.stat(root);
    } catch {
      errors.push({ path: root, reason: "missing" });
      continue;
    }
    if (!stat.isDirectory()) {
      errors.push({ path: root, reason: "not-directory" });
      continue;
    }
    const state = { entries: 0 };
    const images = await collectImages(root, state);
    /** @type {Map<string, {name: string, flattens: boolean}>} */
    const groups = new Map();
    const baseName = labelOf(root.split(/[\\/]/u).filter(Boolean).pop() ?? root);
    for (const image of images) {
      const segments = image.relativePath.split(sep).filter(Boolean);
      const fileLabel = labelOf(segments.pop()?.replace(/\.[^.]+$/u, "") ?? "sticker");
      const nested = segments.map(labelOf).filter(Boolean);
      const wanted = packs.length + groups.size + 1 <= MAX_PACKS;
      const groupName = wanted && nested.length > 0 ? `${baseName}/${nested.join("/")}` : baseName;
      const stickerName = wanted && nested.length > 0 ? fileLabel : [...nested, fileLabel].join("-");
      const group = groups.get(groupName) ?? { name: groupName, flattens: false };
      group.images ??= [];
      group.images.push({ name: stickerName, ...image });
      groups.set(groupName, group);
    }
    for (const group of groups.values()) {
      const stickers = [];
      const used = new Set();
      for (const image of group.images.slice(0, MAX_STICKERS_PER_PACK)) {
        let stickerName = image.name;
        let suffix = 2;
        while (used.has(stickerName)) stickerName = `${image.name}-${suffix++}`;
        used.add(stickerName);
        let bytes;
        try {
          const stat = await fs.stat(image.path);
          if (stat.size > MAX_STICKER_BYTES) continue;
          bytes = await fs.readFile(image.path);
        } catch {
          continue;
        }
        const size =
          image.extension === ".gif"
            ? gifSize(bytes)
            : image.extension === ".svg"
              ? svgSize(bytes)
              : undefined;
        if (image.extension === ".svg" && size === undefined) continue;
        stickers.push({
          id: stickerId(group.name, stickerName),
          name: stickerName,
          mime: IMAGE_EXTENSIONS.get(image.extension),
          animated: image.extension === ".gif",
          width: size?.width ?? null,
          height: size?.height ?? null,
          bytes: bytes.length,
          etag: createHash("sha1").update(bytes).digest("base64url"),
          file: image.path,
        });
      }
      if (stickers.length === 0) continue;
      packs.push({
        id: group.name,
        name: group.name,
        label: group.name,
        stickers,
      });
    }
  }
  return { packs, errors, scannedAt: Date.now() };
}

/**
 * Resolve one sticker by its full wire id.
 *
 * Matching the id outright is what makes nested packs work: a pack built from
 * sub-directories is named `base/sub`, so its sticker ids are `base/sub/name`.
 * Splitting such an id on the first slash produced pack `base` and sticker
 * `sub/name`, which never matched — every sticker in a nested pack served 404.
 *
 * @param catalog - the live catalog.
 * @param id - the full wire id, exactly as the catalog reports it.
 * @returns the sticker entry, or undefined.
 */
function findStickerById(catalog, id) {
  const wanted = String(id ?? "");
  if (wanted === "") return undefined;
  for (const pack of catalog?.packs ?? []) {
    for (const sticker of pack.stickers ?? []) {
      if (sticker.id === wanted) return sticker;
    }
  }
  return undefined;
}

/** Every sticker id the catalog can serve, for diagnostics and error messages. */
function stickerIds(catalog) {
  return (catalog?.packs ?? []).flatMap((pack) => (pack.stickers ?? []).map((sticker) => sticker.id));
}

// ───────────────────────── profile patch persistence ─────────────────────────

/** The harness home: the launcher-provided environment value, else the default. */
function harnessHome() {
  const fromEnvironment = process.env.DSH_HOME;
  if (typeof fromEnvironment === "string" && fromEnvironment.trim() !== "") return fromEnvironment;
  return join(homedir(), ".dsh");
}

/** The active profile directory, from the launcher-provided environment. */
function profileDirectory() {
  const explicit = process.env.DSH_PROFILE_DIR;
  if (typeof explicit === "string" && explicit.trim() !== "") return explicit;
  const name = process.env.DSH_PROFILE;
  if (typeof name !== "string" || name.trim() === "") return undefined;
  return join(harnessHome(), "profiles", name);
}

/**
 * Locate the profile patch that carries this row.
 *
 * `config.profilePatch` wins; otherwise the launcher-provided profile
 * environment is used. A desktop carrier does not always publish that
 * environment to the host process, so the last resort is a scan of
 * `$DSH_HOME/profiles/*`: the profile that already names this plugin (in its
 * patch or its manifest) is the one that loaded this code.
 *
 * @param config - the row's live configuration.
 * @returns a probe result with the chosen path and every candidate considered.
 */
async function resolvePatchFile(config) {
  const override = typeof config?.profilePatch === "string" ? config.profilePatch.trim() : "";
  if (override !== "") return { file: expandPath(override), via: "config" };
  const fromEnvironment = profileDirectory();
  if (fromEnvironment !== undefined) return { file: join(fromEnvironment, "cordis.patch.yml"), via: "environment" };
  const root = join(harnessHome(), "profiles");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return { file: undefined, via: "scan-failed", candidates: [], root };
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "cordis.patch.yml");
    let patch = "";
    let manifest = "";
    try {
      patch = await fs.readFile(file, "utf8");
    } catch {
      /* a profile without a patch file is still a candidate via its manifest */
    }
    try {
      manifest = await fs.readFile(join(root, entry.name, "package.json"), "utf8");
    } catch {
      /* nothing to read */
    }
    const mentions = patch.includes(`id: ${name}`) || manifest.includes(PACKAGE_NAME);
    candidates.push({ profile: entry.name, mentions });
    if (mentions && patch !== "") return { file, via: `scan:${entry.name}`, candidates };
  }
  const patchAmong = candidates.find((candidate) => candidate.mentions);
  if (patchAmong !== undefined) return { file: join(root, patchAmong.profile, "cordis.patch.yml"), via: "scan", candidates };
  return { file: undefined, via: "not-found", candidates };
}

/** Serialize one JSON value as YAML at the given indentation. */
function yamlValue(value, indent) {
  const pad = " ".repeat(indent);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Quote anything a YAML reader could read as a number, a comment, an
    // indicator, or a value with edge whitespace; this layer is written by the
    // plugin, but the profile patch is a hand-edited document.
    const safe =
      value !== "" &&
      value === value.trim() &&
      !/^[-?:,[\]{}#&*!|>'"%@`]/u.test(value) &&
      !/[\s:,[\]{}#"'\\]/u.test(value) &&
      !/^(?:true|false|null|yes|no|on|off|~)$/iu.test(value) &&
      !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/u.test(value);
    // JSON escaping would double a Windows backslash; a plain single-quoted
    // YAML scalar keeps the path readable and is still unambiguous.
    return safe ? value : `'${value.replaceAll("'", "''")}'`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) =>
      typeof item === "object" && item !== null
        ? `\n${pad}- ${yamlValue(item, indent + 2)}`
        : `\n${pad}- ${yamlValue(item, indent)}`,
    );
    return items.join("");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    if (entries.length === 0) return "{}";
    return entries
      .map(([key, child]) => {
        const rendered = yamlValue(child, indent + 2);
        return `\n${pad}${key}:${rendered.startsWith("\n") ? "" : " "}${rendered}`;
      })
      .join("");
  }
  return "null";
}

/** Render a complete `config:` block for the emote-chat row. */
function renderConfigBlock(fields, indent) {
  const pad = " ".repeat(indent);
  const body = yamlValue(fields, indent + 2);
  return `${pad}config:${body.startsWith("\n") ? "" : " "}${body}`;
}
/**
 * Persist the live fields into the active profile's patch file.
 *
 * This is where `dsh-settings` itself writes: the profile patch is the top
 * layer of the composed tree, so a change here wins over the bundle's own row
 * and is picked up live. The surrounding text — comments included — is
 * preserved; only this row's `config:` block is replaced.
 *
 * @param file - absolute profile patch path, or undefined when no profile is known.
 * @param fields - complete field set to store.
 * @returns `{ ok, path }` or `{ ok: false, reason }`.
 */
async function writeProfilePatch(file, fields) {
  if (file === undefined) return { ok: false, reason: "no-profile" };
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") return { ok: false, reason: String(error?.message ?? error) };
    text = "# Your patch layer for this dsh profile, applied after every bundle layer.\n[]\n";
  }
  const idLine = new RegExp(`^([ \\t]*)-[ \\t]*id:[ \\t]*${name}[ \\t]*$`, "mu");
  const idMatch = idLine.exec(text);
  let next;
  if (idMatch === null) {
    const insertAt = /^-[ \t]*insert:[ \t]*$/mu.exec(text);
    if (insertAt === null) {
      // No insert list yet: append one, replacing a bare empty document.
      const head = text.trim() === "[]" ? "" : `${text.replace(/\s*$/u, "")}\n`;
      next = `${head}- insert:\n    - id: ${name}\n      name: ${PACKAGE_NAME}\n${renderConfigBlock(fields, 6)}\n`;
    } else {
      const afterInsert = insertAt.index + insertAt[0].length;
      next = `${text.slice(0, afterInsert)}\n    - id: ${name}\n      name: ${PACKAGE_NAME}\n${renderConfigBlock(fields, 6)}${text.slice(afterInsert)}`;
    }
  } else {
    const rowStart = text.lastIndexOf("\n", idMatch.index) + 1;
    const rowText = text.slice(rowStart);
    const nameMatch = /^([ \t]*)name:[ \t]*\S+[ \t]*$/mu.exec(rowText);
    const nameIndent = nameMatch === null ? idMatch[1].length + 2 : nameMatch[1].length;
    const configMatch = /^([ \t]*)config:[ \t]*$/mu.exec(rowText);
    if (configMatch === null) {
      // Insert right after `name:` when the row has one, otherwise after the
      // `- id:` line itself — the Plugin Manager writes exactly that shape.
      const at =
        nameMatch === null
          ? idMatch.index + idMatch[0].length
          : rowStart + nameMatch.index + nameMatch[0].length;
      next = `${text.slice(0, at)}\n${renderConfigBlock(fields, nameIndent)}${text.slice(at)}`;
    } else {
      const configAt = rowStart + configMatch.index;
      const indent = configMatch[1].length;
      const lines = text.slice(configAt).split("\n");
      let consumed = 1;
      while (consumed < lines.length) {
        const line = lines[consumed];
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) {
          consumed += 1;
          continue;
        }
        const leading = line.length - line.trimStart().length;
        const isSibling = leading < indent;
        const isNewEntry = leading === indent && trimmed.startsWith("- ");
        if (isSibling || isNewEntry) break;
        consumed += 1;
      }
      const tail = lines.slice(consumed).join("\n");
      next = `${text.slice(0, configAt)}${renderConfigBlock(fields, indent)}\n${tail}`;
    }
  }
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, next, "utf8");
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    return { ok: false, reason: String(error?.message ?? error) };
  }
  return { ok: true, path: file };
}

/**
 * Build the `emote_reply` definition.
 *
 * One definition serves every mount: it reads live state through the
 * `emoteChat` service, so a settings change or a rescan is picked up by the
 * next call without re-registering anything.
 *
 * @param service - the profile half's service face.
 * @returns a tool definition accepted by `tools.register`.
 */
function reactionTool(service) {
  return {
    name: "emote_reply",
    description:
      "React to the user's latest message with one emoji, the way a chat app reaction works, or send a sticker from the configured packs. " +
      "Use it for tone — agreement, amusement, sympathy, a quick acknowledgement — instead of writing the emoji or the sticker into your reply. " +
      "The reaction appears under the user's message and is NOT part of the conversation, so it never replaces a substantive answer. " +
      "At most one call per user turn, and never on consecutive turns unless the user keeps reacting.",
    parameters: {
      emoji: {
        type: "string",
        description: "One reaction emoji from the allowed list in your instructions. Use alone for a plain reaction.",
      },
      sticker: {
        type: "string",
        description: "A sticker id in `pack/name` form, from the pack list in your instructions; it is posted into the conversation.",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean", required: true },
          kind: { type: "string", required: true },
          emoji: { type: "string" },
          sticker: { type: "string" },
          image: { type: "string" },
          seq: { type: "number" },
          message: { type: "string", required: true },
        },
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
      const settings = service.settings();
      const sessionId = exec?.agent?.id;
      if (typeof sessionId !== "string" || sessionId === "") {
        throw new Error("no session is attached to this call");
      }

      const stickerId = typeof args?.sticker === "string" ? args.sticker.trim() : "";
      if (stickerId !== "") {
        if (!settings.stickerReply) {
          throw new Error("sticker replies are disabled in Settings → Stickers & emoji");
        }
        const catalog = await service.rescan();
        // Match the full id, never a pack/name split: a nested pack is named
        // `base/sub`, so its ids carry two slashes and the split produced a pack
        // that does not exist.
        const sticker = findStickerById(catalog, stickerId);
        if (sticker === undefined) {
          const available = stickerIds(catalog).slice(0, 40).join(", ");
          throw new Error(`unknown sticker "${stickerId}"; available — ${available || "(no packs configured)"}`);
        }
        const image = service.stickerUrl(sticker.id);
        return {
          ok: true,
          kind: "sticker",
          sticker: sticker.id,
          image,
          message: `Sticker sent: ${sticker.id}. Show it in your reply with the image markdown ![${sticker.id}](${image}) — the chat renders the image while the transcript keeps that tag.`,
        };
      }

      const raw = typeof args?.emoji === "string" ? args.emoji.trim() : "";
      // A reaction is one grapheme-ish cluster at most. Anything that is not
      // pictographic is refused, because a "reaction" of plain text would render
      // as a nonsense chip — but which emoji it is, is the model's choice. An
      // allow-list was wrong: it made a perfectly good ⭐ fail with a message
      // listing 37 unrelated glyphs, and it forced this plugin to have opinions
      // about the user's taste.
      const emoji = [...raw].slice(0, 2).join("");
      if (emoji === "") {
        throw new Error("pass either `emoji` (a reaction) or `sticker` (pack/name)");
      }
      if (!EMOJI_PATTERN.test(emoji)) {
        throw new Error(`not an emoji reaction: ${raw}`);
      }
      if (!settings.emojiReply) {
        throw new Error("emoji reactions are disabled in Settings → Stickers & emoji");
      }
      // The anchor alone decides where the chip lands: the browser registers the
      // message that triggered this turn, and the reaction is stamped with it.
      //
      // A `to` argument was tried and removed. It could only work when the message
      // id happened to be visible to the model, which it is not — a user message
      // reaches the model as text, with no id attached — so it was an escape hatch
      // that was almost never usable. One mechanism, with one rule, is better than
      // two where one is decorative.
      const entry = service.react(sessionId, emoji);
      return {
        ok: true,
        kind: "emoji",
        emoji,
        seq: entry.seq,
        message: `Reacted ${emoji}. Do not repeat the emoji in your reply text — the chip under the user's message shows it.`,
      };
    },
  };
}

/**
 * The model-facing tool lives in its own package: `dsh-plugin-emote-chat-tool`.
 *
 * It must declare `inject: ["tools"]` so the Loader activates it where the tool
 * registry exists. Trying to register from here did not work in any scope this
 * plugin can reach: `ctx.get('tools')` reads the service only for a context that
 * was injected with it, and a live trace showed both this scope and every preset
 * scope reporting no registry at all.
 */

/**
 * Report what the Settings service sees for this plugin row.
 *
 * The `settings.section` page writes through `ctx.remote.settings`, whose
 * namespace list is built from this row's projected Config schema; when the row
 * carries no volatile schema the namespace is absent and every write is
 * refused. This probe makes that visible from outside the browser, and it is
 * only reachable with `?debug=1`.
 *
 * @param ctx - the plugin context (used for an optional `settings` lookup).
 * @returns a small JSON-safe diagnosis.
 */
function describeSettingsSurface(ctx) {
  const report = {
    configExport: typeof Config,
    volatileFields: z === undefined ? [] : Object.keys(Config?.toJSON()?.dict ?? {}),
  };
  const settings = typeof ctx.get === "function" ? ctx.get("settings") : undefined;
  report.settingsService = settings === undefined ? "absent" : typeof settings;
  try {
    const described = settings?.describe?.({ redactSecrets: true });
    report.describeOk = Array.isArray(described);
    report.namespaces = (described ?? []).map((row) => row.ns);
    const mine = (described ?? []).find((row) => row.ns === "emote-chat");
    report.ownNamespace = mine === undefined ? null : { revision: mine.revision, value: mine.value };
  } catch (error) {
    report.describeOk = false;
    report.describeError = String(error?.message ?? error);
  }
  return report;
}

// ─────────────────────────────── emoji reactions ─────────────────────────────

/**
 * Per-session reaction log.
 *
 * The reaction never becomes a session event: the browser half polls this log
 * and paints the result, which is exactly the "the emoji reply does not enter
 * chat history" contract.
 */
const reactions = new Map();

/**
 * Long polls waiting for ANY reaction, regardless of session.
 *
 * The browser names its session from the DOM and the Agent scope names it from
 * the runtime, so the two need not match; a poller therefore also has to wake
 * when a reaction lands under a different key.
 */
const anyReactionWaiters = new Set();

/**
 * One process-wide log beside the per-session maps.
 *
 * A reaction belongs to a MESSAGE, not to a conversation, so scoping the store by
 * session was wrong twice over: a restart produced a new session id and orphaned
 * everything recorded before it, and the browser could not ask for a reaction
 * whose session it no longer knew. The message key a reaction is stamped with is
 * stable across restarts (it carries the message's own id), so entries are kept
 * in one pool and read back by sequence.
 */
const pool = { entries: [], seq: 0 };

/**
 * Stored reactions, kept deliberately small.
 *
 * A reaction belongs to one message, and a message is identified by the id the
 * chat node key carries (`input-message` + the `user/message` event id), so the
 * whole history compresses to one short row per reaction:
 *
 *   { v: 1, seq: 12, rows: [["a1b2c3d4", 1, "🎉"], …] }
 *                                  ^ message id (36 chars at most)
 *                                     ^ pool sequence, the read cursor
 *                                        ^ one emoji (<= 2 code points)
 *
 * The node key itself is NOT stored: it is `13:input-message` + that id, so it is
 * derived when the browser asks. Bounded at MAX_STORED_REACTIONS rows, which caps
 * the file at roughly 60 KB even in the worst case.
 */
const STORE_FILE = "emote-chat-reactions.json";
const STORE_VERSION = 1;
/** Rows kept in the store; caps the file at roughly 60 KB. */
const MAX_STORED_REACTIONS = 500;
/** How long writes are coalesced for. */
const STORE_DEBOUNCE_MS = 800;

/**
 * The message id inside a chat node key.
 *
 * The key is `<seq>:input-message<id>` — verified against the desktop build's
 * ui-chat client, where the kind is `input-message` and the id comes from the
 * `user/message` event. Returning the id rather than the whole key keeps the
 * store small and survives a key that changes shape (a queued message's key is
 * replaced when it is submitted).
 *
 * @param key - a `data-chat-node-key` value.
 * @returns the trailing message id, or the input when no prefix matches.
 */
function messageIdOf(key) {
  const text = String(key ?? "");
  const at = text.indexOf("input-message");
  return at === -1 ? text : text.slice(at + "input-message".length);
}

/** The directory the harness keeps user data in. */
function storageDirectory() {
  const explicit = process.env.DSH_EMOTE_STORAGE_DIR;
  if (typeof explicit === "string" && explicit.trim() !== "") return explicit;
  return join(harnessHome(), "storages");
}

/** Resolve (once) the file this plugin's reactions are kept in. */
let storePathCache;
function storePath() {
  if (storePathCache === undefined) storePathCache = join(storageDirectory(), STORE_FILE);
  return storePathCache;
}

/**
 * Forget the resolved store path and everything loaded from it.
 *
 * The path is memoised because every write would otherwise re-derive it, but that
 * makes the storage directory untestable: a suite that points the plugin at a
 * temporary directory would keep writing to the first one it resolved. This is
 * the seam that lets the store be driven in a test.
 */
export function resetStore() {
  storePathCache = undefined;
  pool.entries = [];
  pool.seq = 0;
  reactions.clear();
}

/** Read the stored reactions; an unreadable or corrupt file reads as empty. */
async function loadStoredReactions() {
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    if (parsed?.v !== STORE_VERSION || !Array.isArray(parsed.rows)) return;
    for (const row of parsed.rows) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const [id, seq, emoji] = row;
      if (typeof id !== "string" || typeof seq !== "number" || typeof emoji !== "string") continue;
      pool.entries.push({
        seq,
        emoji,
        source: "agent",
        at: parsed.at ?? Date.now(),
        messageId: id,
      });
      if (seq > pool.seq) pool.seq = seq;
    }
    pool.entries.sort((left, right) => left.seq - right.seq);
  } catch {
    /* no file yet, or it is unreadable: starting empty is correct */
  }
}

/** Coalesce writes: a burst of reactions lands in one file write. */
let storeTimer;

/**
 * Write the store NOW, synchronously.
 *
 * The debounced write below deliberately keeps its timer unref'd so it never holds
 * the process open, and that is what loses reactions: a reaction recorded less than
 * STORE_DEBOUNCE_MS before a restart had its timer discarded with the process, so
 * the chip was gone for good. Nothing else flushed it either — the plugin's disposer
 * did not write.
 *
 * Synchronous on purpose: this runs while the process is going away, where an
 * awaited write has no guarantee of being scheduled. The file is at most ~60 KB, so
 * blocking on it for a moment at shutdown is the right trade.
 *
 * @returns whether anything was written.
 */
function flushStoredReactions() {
  if (storeTimer !== undefined) {
    clearTimeout(storeTimer);
    storeTimer = undefined;
  }
  try {
    const rows = pool.entries
      .slice(-MAX_STORED_REACTIONS)
      .map((entry) => [entry.messageId ?? messageIdOf(entry.messageKey), entry.seq, entry.emoji]);
    const payload = JSON.stringify({ v: STORE_VERSION, seq: pool.seq, at: Date.now(), rows });
    const directory = storageDirectory();
    if (!existsSync(directory)) return false;
    const temporary = `${storePath()}.tmp`;
    writeFileSync(temporary, payload, "utf8");
    renameSync(temporary, storePath());
    return true;
  } catch {
    return false;
  }
}

function scheduleStore() {
  if (storeTimer !== undefined) return;
  storeTimer = setTimeout(() => {
    storeTimer = undefined;
    void saveStoredReactions();
  }, STORE_DEBOUNCE_MS);
  if (typeof storeTimer.unref === "function") storeTimer.unref();
}

/** Write the reactions back, newest kept. Failures are not fatal. */
async function saveStoredReactions() {
  const rows = pool.entries
    .slice(-MAX_STORED_REACTIONS)
    .map((entry) => [entry.messageId ?? messageIdOf(entry.messageKey), entry.seq, entry.emoji]);
  const payload = JSON.stringify({ v: STORE_VERSION, seq: pool.seq, at: Date.now(), rows });
  try {
    const directory = storageDirectory();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // Atomic: a half-written store must never replace a good one.
    const temporary = `${storePath()}.tmp`;
    await fs.writeFile(temporary, payload, "utf8");
    await fs.rename(temporary, storePath());
  } catch (error) {
    void error;
  }
}

/** Read (or create) one session's log. */
function sessionLog(sessionId) {
  let log = reactions.get(sessionId);
  if (log === undefined) {
    log = { entries: [], seq: 0, waiters: new Set(), anchor: undefined };
    reactions.set(sessionId, log);
    while (reactions.size > MAX_SESSIONS_TRACKED) {
      const oldest = reactions.keys().next().value;
      if (oldest === undefined || oldest === sessionId) break;
      reactions.delete(oldest);
    }
  }
  return log;
}

/**
 * The message a session's next reaction belongs to.
 *
 * The Agent's tool cannot name the message it is reacting to: its execution
 * context carries only the agent id, while the browser is the side that knows
 * which chat node triggered the turn. So the browser registers that node, and any
 * reaction recorded afterwards is stamped with it.
 *
 * The anchor is the ONLY thing that decides a chip's message. Two alternatives
 * were built and removed: inferring from the reaction's timestamp (which
 * mis-anchored whenever a message arrived while a reaction was in flight) and a
 * `to` argument the Agent could set (which needed a message id the Agent is never
 * given). One mechanism, one rule.
 *
 * @param sessionId - the session to register for.
 * @param anchor - the chat node key of the message that triggered this turn.
 */
function setAnchor(sessionId, anchor) {
  const log = sessionLog(sessionId);
  log.anchor = typeof anchor === "string" && anchor !== "" ? anchor : undefined;
  return log.anchor;
}

/** Append one reaction and wake every long-poll waiter. */
function pushReaction(sessionId, emoji, source) {
  const log = sessionLog(sessionId);
  log.seq += 1;
  pool.seq += 1;
  const anchor = log.anchor;
  const entry = {
    seq: pool.seq,
    emoji,
    source,
    at: Date.now(),
    session: sessionId,
    ...(anchor === undefined ? {} : { messageKey: anchor, messageId: messageIdOf(anchor) }),
  };
  log.entries.push(entry);
  if (log.entries.length > MAX_REACTIONS_PER_SESSION) {
    log.entries.splice(0, log.entries.length - MAX_REACTIONS_PER_SESSION);
  }
  pool.entries.push(entry);
  if (pool.entries.length > MAX_REACTIONS_PER_SESSION * 2) {
    pool.entries.splice(0, pool.entries.length - MAX_REACTIONS_PER_SESSION * 2);
  }
  boundStoredReactions();
  scheduleStore();
  for (const wake of [...log.waiters]) wake();
  log.waiters.clear();
  // The pool is shared, so a poller has to wake for traffic recorded under any
  // session. Worth keeping now that a reaction's meaning comes from the message it
  // names rather than from the session that happened to record it.
  for (const wake of [...anyReactionWaiters]) wake();
  anyReactionWaiters.clear();
  return entry;
}

/**
 * Keep the store within its bound, oldest first.
 *
 * This is the cleanup that replaces both the automatic pruning and the manual
 * "clean up" button. Both of those tried to decide that a particular reaction was
 * no longer needed, and both could be wrong — the automatic one destroyed history,
 * and the manual one asked the user to make a judgement the UI cannot support.
 *
 * A cap needs no judgement. It is also the honest model of what the store is: a
 * bounded cache of decoration. Which reactions survive does not depend on whether
 * a session was archived, opened, or paged — only on age — so there is no state a
 * caller can get wrong.
 *
 * @returns how many entries were dropped.
 */
function boundStoredReactions() {
  if (pool.entries.length <= MAX_STORED_REACTIONS) return 0;
  const dropped = pool.entries.length - MAX_STORED_REACTIONS;
  pool.entries = pool.entries.slice(dropped);
  scheduleStore();
  return dropped;
}

/** Drop every stored reaction, for the settings page's explicit "clear" action. */
function clearStoredReactions() {
  const removed = pool.entries.length;
  pool.entries = [];
  if (removed > 0) scheduleStore();
  return removed;
}

/** The reactions the browser has not seen yet, newest window last. */
function readReactions(sinceSeq) {
  return {
    seq: pool.seq,
    // `messageId` rides along because a restored entry has no stored node key:
    // the browser matches a chip to its message by the id the key carries, so a
    // key that changed shape (a queued message's key is replaced on submission)
    // still finds its row.
    reactions: pool.entries
      .filter((entry) => entry.seq > sinceSeq)
      .map((entry) => ({
        seq: entry.seq,
        emoji: entry.emoji,
        source: entry.source,
        at: entry.at,
        ...(entry.messageKey === undefined ? {} : { messageKey: entry.messageKey }),
        ...(entry.messageId === undefined
          ? entry.messageKey === undefined
            ? {}
            : { messageId: messageIdOf(entry.messageKey) }
          : { messageId: entry.messageId }),
      })),
    sessions: [...reactions.keys()],
  };
}

/**
 * The snapshot one poll returns.
 *
 * Everything comes from the single pool, keyed by sequence, because a reaction
 * belongs to a message rather than to a session — and the browser's way of
 * finding that message is the `messageKey` it was stamped with, never the session
 * that happened to be current when it was recorded. That is what lets chips
 * survive a restart: the message keeps its id, so the reaction still points at
 * it even though the session id is new.
 *
 * @param sinceSeq - the cursor the browser last saw.
 * @returns the snapshot the route returns.
 */
function readReactionsFor(sinceSeq) {
  return readReactions(sinceSeq);
}

/**
 * Await either a new reaction or the timeout.
 *
 * The cursor is compared against the shared pool, so a reaction is delivered to
 * every poller regardless of which session recorded it — which is what makes a
 * chip survive a restart that hands out a new session id.
 *
 * The session id is still accepted, and still registers a per-session waiter, so
 * a poller is woken directly by traffic recorded under its own session.
 *
 * @param sessionId - the poller's session, used only to join that session's waiters.
 * @param sinceSeq - the pool sequence the poller has already seen.
 * @param timeoutMs - how long to hold the poll open.
 * @param signal - aborted when the browser goes away.
 */
function waitForReaction(sessionId, sinceSeq, timeoutMs, signal) {
  if (pool.seq > sinceSeq) return Promise.resolve();
  const log = sessionLog(sessionId);
  return new Promise((settle) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      log.waiters.delete(wake);
      anyReactionWaiters.delete(wake);
      signal?.removeEventListener("abort", finish);
      settle();
    };
    const wake = () => {
      finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    log.waiters.add(wake);
    anyReactionWaiters.add(wake);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/** Drop one session's log (used when a session goes away). */
function clearSession(sessionId) {
  const log = reactions.get(sessionId);
  if (log === undefined) return;
  for (const wake of [...log.waiters]) wake();
  reactions.delete(sessionId);
}

// ──────────────────────────────────── plugin ─────────────────────────────────

/**
 * Host plugin body.
 *
 * @param ctx - Cordis context carrying `connection`, `tools`, and `systemPrompt`.
 * @param config - the row's live configuration (see {@link readConfig}).
 */
export function apply(ctx, config) {
  // Module-load and apply evidence. If diagnostics ever come back from a cached
  // module generation, these counters make that visible instead of leaving us
  // guessing why an edited effect never ran.
  MODULE_RUN.appliedAt = Date.now();
  MODULE_RUN.applies += 1;
  MODULE_RUN.effects = [];

  // Restore the reactions recorded before this process started. They are kept
  // outside the session log, so without this a restart erases every chip in the
  // transcript — the messages are still there, but their reactions would be gone.
  void loadStoredReactions().then(() => {
    MODULE_RUN.effects.push(`store:loaded rows=${String(pool.entries.length)}`);
  });

  const state = {
    settings: readConfig(config),
    catalog: undefined,
    catalogAt: 0,
    catalogKey: "",
    scanning: undefined,
    patchFile: undefined,
    patchVia: undefined,
    patchCandidates: [],
  };

  const getSettings = () => state.settings;

  /** Whether the companion tool package reports `emote_reply` as registered. */
  const toolRegistered = () => {
    const face = typeof ctx.get === "function" ? ctx.get("emoteChatTool") : undefined;
    return typeof face?.mounted === "function" ? face.mounted() === true : false;
  };

  /**
   * The service this plugin provides for its companions.
   *
   * The model-facing tool lives in `dsh-plugin-emote-chat-tool`, which is
   * activated by the Loader where the tool registry exists. This face gives that
   * package the live settings, the scanned catalog, and the route URLs without
   * duplicating any of the state.
   */
  const service = {
    /** Live settings (paths, enabled switches, allowed emoji). */
    settings: getSettings,
    /** The scanned catalog, or an empty one before the first scan. */
    catalog: () => state.catalog ?? { packs: [], errors: [], scannedAt: 0 },
    /** Force a rescan (a caller can make a freshly edited folder usable at once). */
    rescan: () => getCatalog(true),
    /** Record one reaction for a session; the browser paints it. */
    react: (sessionId, emoji) => pushReaction(sessionId, emoji, "agent"),
    /** Absolute sticker URL when the host/port are known, else the relative path. */
    stickerUrl: (id) => `${state.origin ?? ""}${API_ROOT}/sticker?id=${encodeURIComponent(id)}`,
    /** Whether `emote_reply` is currently registered for the model. */
    toolRegistered,
  };
  ctx.provide("emoteChat", service);

  // Publish the same face on the process-wide bridge. The tool half is a
  // separate row in a different context, so it cannot reach this service — but
  // it does share the process, which is what the bridge uses. Without this the
  // `emote_reply` tool recorded nothing, so no reaction ever reached the chat:
  // the emoji chip had no source at all.
  //
  // `catalog` rides along for one reason: this module owns the only sticker
  // scanner. A second copy inside the tool half drifted from it — that walker
  // flattened nested folders, so the tool rejected stickers the picker offered
  // (`memes/happy/ok` came back as unknown). One scanner, one naming rule.
  bridge.publish({ react: service.react, rescan: service.rescan, catalog: service.catalog });

  /** Resolve (once) the profile patch this row's settings are stored in. */
  const ensurePatchFile = async () => {
    if (state.patchFile !== undefined || state.patchVia === "none") return state.patchFile;
    const resolved = await resolvePatchFile(config);
    state.patchFile = resolved.file;
    state.patchVia = resolved.via;
    state.patchCandidates = resolved.candidates ?? [];
    return state.patchFile;
  };

  /** Re-read the row configuration; the Loader re-applies on every settings write. */
  const refresh = () => {
    const next = readConfig(config);
    const key = next.paths.join("\u0000");
    state.settings = next;
    if (key !== state.catalogKey) {
      state.catalog = undefined;
      state.catalogKey = key;
    }
    return next;
  };
  refresh();

  /** Return the catalog, rescanning when the paths changed or the TTL expired. */
  const getCatalog = async (force) => {
    const fresh = state.catalog !== undefined && Date.now() - state.catalogAt < CATALOG_TTL_MS;
    if (!force && fresh) return state.catalog;
    if (state.scanning !== undefined) return state.scanning;
    state.scanning = (async () => {
      const catalog = await buildCatalog(state.settings);
      state.catalog = catalog;
      state.catalogAt = Date.now();
      return catalog;
    })().finally(() => {
      state.scanning = undefined;
    });
    return state.scanning;
  };

  // Markdown rendering only shows absolute HTTP(S) images, so the tool half
  // needs an origin when the webserver can supply one; otherwise the relative
  // path is still what the browser's own picker uses.
  const webServer = typeof ctx.get === "function" ? ctx.get("webServer") : undefined;
  if (webServer !== undefined && typeof webServer.port === "number") {
    const host = webServer.host === undefined || webServer.host === "0.0.0.0" ? "127.0.0.1" : webServer.host;
    state.origin = `http://${host}:${String(webServer.port)}`;
  }

  // ── exact routes on the shared /api channel ────────────────────────────────
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${API_ROOT}/settings`,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return Response.json({ ok: false, reason: "invalid-json" }, { status: 400 });
          }
          const current = getSettings();
          const next = {
            stickerReply: typeof body?.stickerReply === "boolean" ? body.stickerReply : current.stickerReply,
            paths: body?.paths === undefined ? current.paths : toPathList(body.paths),
            emojiReply: typeof body?.emojiReply === "boolean" ? body.emojiReply : current.emojiReply,
            emojiRain: typeof body?.emojiRain === "boolean" ? body.emojiRain : current.emojiRain,
                };
          if (!next.emojiReply) next.emojiRain = false;
          if (!next.stickerReply) next.paths = [];
          const patchFile = await ensurePatchFile();
          const written = await writeProfilePatch(patchFile, {
            stickerReply: next.stickerReply,
            paths: next.paths,
            emojiReply: next.emojiReply,
            emojiRain: next.emojiRain,
                });
          // Apply locally as well: the patch watch reloads this row, but the
          // Settings page must not wait for that round trip to be consistent.
          state.settings = readConfig(next);
          state.catalog = undefined;
          state.catalogKey = state.settings.paths.join("\u0000");
          return Response.json(
            {
              ok: written.ok,
              ...(written.ok ? { path: written.path } : { reason: written.reason }),
              settings: {
                stickerReply: state.settings.stickerReply,
                emojiReply: state.settings.emojiReply,
                emojiRain: state.settings.emojiRain,
                paths: state.settings.paths,
              },
            },
            { headers: { "cache-control": "no-store" } },
          );
        },
      }),
    "emote-chat: settings write route",
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${API_ROOT}/config`,
        methods: ["GET", "HEAD"],
        requestBody: "buffered",
        fetch: async (request) => {
          if (request.method === "HEAD") return new Response(null, { status: 200 });
          const settings = getSettings();
          const url = new URL(request.url);
          const catalog = settings.stickerReply ? await getCatalog(false) : { packs: [], errors: [], scannedAt: 0 };
          const payload = {
            stickerReply: settings.stickerReply,
            emojiReply: settings.emojiReply,
            emojiRain: settings.emojiRain,
            paths: settings.paths,
                packs: catalog.packs.map((pack) => ({
              id: pack.id,
              name: pack.name,
              stickers: pack.stickers.map((sticker) => ({
                id: sticker.id,
                name: sticker.name,
                mime: sticker.mime,
                animated: sticker.animated,
                width: sticker.width,
                height: sticker.height,
              })),
            })),
            errors: catalog.errors,
          };
          if (url.searchParams.get("debug") === "1") {
            await ensurePatchFile();
            payload.debug = {
              ...describeSettingsSurface(ctx),
              harnessHome: harnessHome(),
              profilesRoot: join(harnessHome(), "profiles"),
              patchFile: state.patchFile ?? null,
              patchVia: state.patchVia ?? null,
              patchCandidates: state.patchCandidates,
              profile: process.env.DSH_PROFILE ?? null,
              origin: state.origin ?? null,
              // The tool is registered into each agent preset's own scope.
              // Diagnostics: which module generation is live, and whether the
              // companion tool package reports its tool as registered.
              moduleRun: MODULE_RUN,
              toolRegistered: service.toolRegistered(),
              toolService: (() => {
                const face = typeof ctx.get === "function" ? ctx.get("emoteChatTool") : undefined;
                return face === undefined ? "absent" : typeof face.mounted;
              })(),
              promptRegistered: promptState.registered,
              // What the store holds. An entry whose message is not on screen is
              // invisible rather than wrong — nothing binds an unplaced reaction —
              // so this is a number to watch, not a fault.
              store: { reactions: pool.entries.length, seq: pool.seq },
              // Which message each session's next reaction will be stamped with,
              // and what the latest recorded reaction carried. Without this, a
              // misplaced chip is indistinguishable from an unstamped one.
              anchors: [...reactions.entries()].map(([session, log]) => ({
                session,
                anchor: log.anchor ?? null,
                seq: log.seq,
                last: log.entries.at(-1)?.messageKey ?? null,
              })),
              scopeKeys: typeof ctx.get === "function" ? ["tools", "systemPrompt", "webServer", "connection"].map((key) => `${key}:${ctx.get(key) === undefined ? "absent" : "present"}`) : [],
            };
          }
          return Response.json(payload, { headers: { "cache-control": "no-store" } });
        },
      }),
    "emote-chat: config route",
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${API_ROOT}/reactions`,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async (request) => {
          const settings = getSettings();
          const url = new URL(request.url);
          const since = Number.parseInt(url.searchParams.get("since") ?? "0", 10);
          if (!settings.emojiReply) {
            return Response.json({ seq: 0, reactions: [] }, { headers: { "cache-control": "no-store" } });
          }
          const cursor = Number.isFinite(since) ? since : 0;
          if (url.searchParams.get("wait") === "1") {
            // The pool is shared, so any new reaction is worth waking for; the
            // session parameter is only a hint and is no longer load-bearing.
            await waitForReaction(url.searchParams.get("session") ?? "", cursor, REACTION_POLL_TIMEOUT_MS, request.signal);
          }
          const snapshot = readReactionsFor(cursor);
          return Response.json(snapshot, { headers: { "cache-control": "no-store" } });
        },
      }),
    "emote-chat: reactions route",
  );

  // Which message a session's next reaction belongs to.
  //
  // The browser registers it when a user message is sent, because the Agent's
  // tool cannot name the message from its own context. Recording it here is what
  // lets every later reaction carry an exact `messageKey` instead of relying on
  // "which message looks newest" — a guess that a message sent while a reaction
  // was in flight could always overtake.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${API_ROOT}/anchor`,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return new Response("bad body", { status: 400 });
          }
          const sessionId = typeof body?.session === "string" ? body.session : "";
          const anchor = typeof body?.anchor === "string" ? body.anchor : "";
          if (sessionId === "" || anchor === "") return new Response("bad anchor", { status: 400 });
          const stored = setAnchor(sessionId, anchor);
          return Response.json({ ok: true, anchor: stored ?? null }, { headers: { "cache-control": "no-store" } });
        },
      }),
    "emote-chat: anchor route",
  );

  // Which messages the browser currently has loaded.
  //
  // Reporting only: it never deletes anything, and the Host does not delete on
  // receipt. A route like this used to prune reactions whose message was absent
  // from the list, and that destroyed real history — a long conversation is paged,
  // so the DOM holds only the loaded window, and every reaction older than it
  // looked like an orphan. The list is kept because it describes what the browser
  // is showing, which is what a diagnostic needs to explain a chip that is
  // expected but not visible.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${API_ROOT}/seen`,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: async (request) => {
          let body;
          try {
            body = await request.json();
          } catch {
            return new Response("bad body", { status: 400 });
          }
          const keys = Array.isArray(body?.keys) ? body.keys.filter((key) => typeof key === "string") : [];
          return Response.json(
            { ok: true, seen: keys.length, stored: pool.entries.length },
            { headers: { "cache-control": "no-store" } },
          );
        },
      }),
    "emote-chat: seen route",
  );

  // Empty the store, on demand.
  //
  // This is all that is left of reaction maintenance, and it is deliberately the
  // only operation: it needs no judgement about which entry is stale, so it cannot
  // be wrong. A `unmatched` mode existed here and was removed — it asked the caller
  // to decide that a message no longer exists, which from the Host is
  // indistinguishable from a message that merely is not loaded, and that ambiguity
  // once deleted real history. Age-based bounding inside the plugin now handles
  // growth instead.
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${API_ROOT}/clean`,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: async () => {
          const removed = clearStoredReactions();
          return Response.json(
            { ok: true, removed, stored: pool.entries.length },
            { headers: { "cache-control": "no-store" } },
          );
        },
      }),
    "emote-chat: clean route",
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${API_ROOT}/sticker`,
        methods: ["GET", "HEAD"],
        requestBody: "buffered",
        fetch: async (request) => {
          const settings = getSettings();
          if (!settings.stickerReply) return new Response("stickers disabled", { status: 404 });
          const url = new URL(request.url);
          const raw = url.searchParams.get("id") ?? "";
          if (raw === "") return new Response("bad id", { status: 400 });
          const catalog = await getCatalog(false);
          const sticker = findStickerById(catalog, raw);
          if (sticker === undefined) return new Response("not found", { status: 404 });
          const etag = `"${sticker.etag}"`;
          if (request.headers.get("if-none-match") === etag) {
            return new Response(null, {
              status: 304,
              headers: { etag, "cache-control": "private, max-age=86400" },
            });
          }
          const headers = {
            "content-type": sticker.mime,
            "cache-control": "private, max-age=86400",
            etag,
            "content-length": String(sticker.bytes),
          };
          if (request.method === "HEAD") return new Response(null, { status: 200, headers });
          const bytes = await fs.readFile(sticker.file);
          return new Response(bytes, { status: 200, headers });
        },
      }),
    "emote-chat: sticker route",
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${API_ROOT}/emoji`,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async () => {
          const settings = getSettings();
          return Response.json(
            {},
            { headers: { "cache-control": "no-store" } },
          );
        },
      }),
    "emote-chat: emoji route",
  );

  // ── model-facing surface ──────────────────────────────────────────────────
  //
  // Only the prompt guidance is published from here: the prompt registry IS
  // reachable at this scope. The `emote_reply` tool is registered by the
  // companion package `dsh-plugin-emote-chat-tool`, which declares
  // `inject: ['tools']` so the Loader activates it where the registry lives.
  const promptState = { registered: false };

  ctx.inject(["systemPrompt"], (scope) => {
    scope.effect(() => {
      const dispose = scope.systemPrompt.section({
        name: "emote-chat:stickers",
        order: 176,
        text: () => promptTextFor(state, service.toolRegistered(), getSettings),
      });
      promptState.registered = true;
      return () => {
        promptState.registered = false;
        dispose?.();
      };
    }, "emote-chat: prompt section");
  });

  // Warm the catalog once so the prompt section and the first picker open are fast,
  // and flush the reaction store on the way out.
  //
  // The flush belongs here because this is the only teardown the plugin gets. The
  // debounced write keeps its timer unref'd so it never holds the process open,
  // which means a reaction recorded just before a restart used to have its pending
  // write discarded along with the process — the chip was simply gone. Writing
  // synchronously here closes that window.
  ctx.effect(() => {
    void getCatalog(true);
    return () => {
      flushStoredReactions();
      reactions.clear();
    };
  }, "emote-chat: catalog warmup");
}

/**
 * The prompt guidance, rebuilt on every assembly so it tracks live settings.
 *
 * @param state - the plugin's mutable state (for the scanned catalog).
 * @param toolRegistered - whether the companion tool package's tool is mounted.
 * @param getSettings - the live settings reader.
 * @returns the section text, or an empty string when nothing is enabled.
 */
function promptTextFor(state, toolRegistered, getSettings) {
  const settings = getSettings();
  const blocks = [];
  if (settings.emojiReply) {
    blocks.push(
      [
        "## Chat reactions",
        "",
        toolRegistered
          ? "You may react to the user's latest message with one emoji through the `emote_reply` tool."
          : "Emoji reactions are enabled, but this session has no `emote_reply` tool; do not write reaction emoji into your reply text.",
        "Use it for tone (agreement, amusement, sympathy, a quick acknowledgement), never instead of a substantive answer, and at most once per user turn.",
        "The reaction is shown under the user's message and is not part of the conversation.",
        // No emoji list: any emoji is accepted, so naming a set would only imply a
        // restriction that does not exist. It is also the reaction attached to the
        // message that started this turn, which is worth stating because a message
        // the user sends mid-turn is an intervention, not a new target.
        "Any emoji is accepted. The reaction attaches to the message that started this turn.",
      ].join("\n"),
    );
  }
  if (settings.stickerReply) {
    const packs = state.catalog?.packs ?? [];
    const list = packs
      .slice(0, 12)
      .map((pack) => `- ${pack.id}: ${pack.stickers.slice(0, 40).map((sticker) => sticker.name).join(", ")}`)
      .join("\n");
    blocks.push(
      [
        "## Stickers",
        "",
        "The user's sticker folders hold these packs:",
        packs.length === 0 ? "(no sticker folders are configured or readable yet)" : list,
        "",
        "To send a sticker, write its token on its own line in your reply: `[[sticker:pack/name]]`.",
        "The chat renders the image for that token while the transcript keeps the token text, so never describe the image — send the token.",
        "Use a sticker only when it adds tone, at most one per reply, and only names from the packs listed above.",
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

export {
  buildCatalog,
  findStickerById,
  promptTextFor,
  readConfig,
  renderConfigBlock,
  splitStickerId,
  stickerIds,
  toPathList,
  writeProfilePatch,
};
