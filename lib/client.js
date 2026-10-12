/** [INPUT]: src/client 源码; [OUTPUT]: DSH 客户端模块; [POS]: 生成产物，执行 npm run build 重建。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
window.__ModuleLoader__.load({id:"dsh-plugin-emote-chat",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/runtime.js
var runtime_exports = {};
__export(runtime_exports, {
  apply: () => apply,
  inject: () => inject,
  internals: () => internals
});
module.exports = __toCommonJS(runtime_exports);
var React3 = __toESM(require("react"), 1);

// src/client/shared.js
var React = __toESM(require("react"), 1);
var NS = "emote";
var API = "/api/emote-chat";
var TOKEN_OPEN = "[[sticker:";
var TOKEN_CLOSE = "]]";
var MESSAGE_ID_MARKER = "input-message";
var MESSAGE_FLOW_KINDS = /* @__PURE__ */ new Set([
  "user",
  "steering",
  "assistant-step",
  "developer-message"
]);
var NON_MESSAGE_REGIONS = "[data-step-process], [data-step-process-body], [data-step-process-content], [data-chat-anchor-key^='call:']";
var MAX_CHIPS = 8;
var STORE_LIMIT = 500;
var RAIN_COUNT = 26;
var RAIN_FRESH_MS = 15e3;
var PREVIEW_LIMIT = 12;
var mountLog = { mounts: 0, unmounts: 0, events: [] };
function createStore(initial) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
function patchStore(store, patch) {
  store.set({ ...store.get(), ...patch });
}
function useStore(store) {
  return React.useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
    () => store.get()
  );
}
function splitLines(text) {
  return String(text ?? "").split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
}
async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload?.ok === false)
    throw new Error(
      payload?.message ?? `${response.status} ${response.statusText}`
    );
  return payload;
}
function getJson(url, signal) {
  return requestJson(url, { signal, headers: { accept: "application/json" } });
}
async function postJson(url, body, signal) {
  const payload = await requestJson(url, {
    method: "POST",
    signal,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (payload?.ok !== true)
    throw new Error(payload?.message ?? "invalid host response");
  return payload;
}
function stickerUrl(id) {
  return API + "/sticker?id=" + encodeURIComponent(id);
}
function findSticker(catalog, id) {
  const wanted = String(id ?? "").trim();
  if (wanted === "") return void 0;
  const packs = catalog?.packs ?? [];
  for (const pack of packs) {
    const hit = (pack.stickers ?? []).find((sticker) => sticker.id === wanted);
    if (hit !== void 0) return hit;
  }
  return void 0;
}
function splitTokens(text) {
  const segments = [];
  const pattern = /\[\[sticker:([^\]]*)\]\]/gu;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[1].trim();
    if (!token) continue;
    if (match.index > index)
      segments.push({ text: text.slice(index, match.index) });
    segments.push({
      token,
      ...match[0] === TOKEN_OPEN + token + TOKEN_CLOSE ? {} : { raw: match[0] }
    });
    index = match.index + match[0].length;
  }
  if (index < text.length) segments.push({ text: text.slice(index) });
  return segments;
}

// src/client/styles.js
var CSS = `.ec-picker-root { position: relative; display: inline-flex; }
.ec-trigger {
  appearance: none; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0;
  border-radius: var(--dsw-radius-sm, 6px); background: none;
  color: var(--dsw-alias-label-secondary, #6b6b6b); cursor: pointer;
}
/* Hover motion is gated: touch fires a false hover on tap. */
@media (hover: hover) and (pointer: fine) {
  .ec-trigger:hover {
background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));
color: var(--dsw-alias-label-primary, #1a1a1a);
  }
}
.ec-trigger[aria-expanded='true'] {
  background: var(--dsw-alias-bg-layer-4, rgba(128, 128, 128, 0.14));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.ec-trigger:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #4d6bfe));
  outline-offset: 1px;
}
.ec-trigger svg { display: block; }

/* \u2500\u2500 The popup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *
 * Built from the shipped menu surface's own tokens instead of hand-picked
 * shadows: --dsw-elevation-prominent for the lift, the l1 border colour as the
 * elevation stroke, --dsw-menu-surface-fill for the translucent fill, and the
 * scrollbar elevation tokens so the thumb matches an official dropdown. The card
 * radius is --dsw-radius-lg, the same as MenuSurface.
 */
.ec-popover {
  position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 40;
  box-sizing: border-box;
  display: flex; flex-direction: column;
  width: min(440px, 76vw); max-height: min(360px, calc(100vh - 80px));
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-overlay, #fff));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  box-shadow: var(--dsw-elevation-prominent, 0 3px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 0, 0, 0.05));
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.22));
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2, rgba(128, 128, 128, 0.3));
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2, rgba(128, 128, 128, 0.45));
  outline: 0.5px solid var(--dsw-elevation-stroke-color);
  outline-offset: -0.5px;
  overflow: hidden;
  /* It grows out of the button that opened it. */
  transform-origin: bottom left;
}
.ec-popover-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 8px 8px 12px;
}
.ec-popover-title {
  flex: 1; min-width: 0;
  font-size: 13px; line-height: 18px; font-weight: 500;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.ec-close {
  appearance: none; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: 0;
  border-radius: var(--dsw-radius-sm, 6px); background: none;
  color: var(--dsw-alias-label-tertiary, #8c8c8c); cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .ec-close:hover {
background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));
color: var(--dsw-alias-label-secondary, #6b6b6b);
  }
}
.ec-close:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #4d6bfe));
  outline-offset: 1px;
}

/* Direct folder navigation stays visible beside the independently scrolling grid. */
.ec-picker-body {
  display: grid; grid-template-columns: minmax(96px, 32%) minmax(0, 1fr);
  height: min(288px, 48vh); min-height: 0;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .16));
}
.ec-packs {
  min-height: 0; padding: 6px; overflow-y: auto; overflow-x: hidden;
  border-right: .5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .16));
  scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent;
  overscroll-behavior: contain;
}
.ec-pack-group + .ec-pack-group { margin-top: 8px; }
.ec-pack-root {
  padding: 4px 8px; font-size: 11px; line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8c8c8c);
  overflow-wrap: anywhere;
}
.ec-pack {
  appearance: none; display: block; box-sizing: border-box; width: 100%; min-height: 32px;
  border: 0; border-radius: var(--dsw-radius-sm, 6px); padding: 6px 8px;
  font: inherit; font-size: 12px; line-height: 18px; text-align: left;
  white-space: normal; overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  background: transparent; cursor: pointer;
  transition: color 180ms ease, background-color 180ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .ec-pack:hover:not([aria-pressed='true']) {
background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));
color: var(--dsw-alias-label-primary, #1a1a1a);
  }
}
.ec-pack[aria-pressed='true'] {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.ec-pack:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #4d6bfe));
  outline-offset: -1px;
}

.ec-picker-content { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.ec-pack-title {
  flex: none; padding: 10px 12px 6px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ec-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 4px;
  min-height: 0; align-content: start; padding: 0 8px 8px; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent;
  overscroll-behavior: contain;
}
.ec-cell {
  appearance: none; display: flex; flex-direction: column; align-items: center; gap: 2px;
  min-width: 0;
  padding: 6px 4px; border: 0; border-radius: var(--dsw-radius-md, 8px);
  background: transparent; cursor: pointer;
  transition: background-color 120ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .ec-cell:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1)); }
}
.ec-cell:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #4d6bfe));
  outline-offset: -1px;
}
.ec-cell img { width: 100%; height: 52px; object-fit: contain; display: block; }
.ec-cell span {
  max-width: 100%; font-size: 11px; line-height: 15px;
  color: var(--dsw-alias-label-tertiary, #8c8c8c);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The reveal plays once, on entry: a transition with @starting-style rather than
 * a keyframe animation, so a re-render (a catalog refresh, a pack switch) leaves
 * the open popup perfectly still. DSH's own Tooltip and Modal do the same thing
 * with opacity; 0.97 is the popover recipe's floor \u2014 never scale(0), because
 * nothing appears from nothing. */
.ec-popover {
  opacity: 1;
  transform: none;
  transition:
opacity var(--ds-transition-duration, 200ms) var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)),
transform var(--ds-transition-duration, 200ms) var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
}
@starting-style {
  .ec-popover { opacity: 0; transform: scale(0.97); }
}
@media (prefers-reduced-motion: reduce) {
  .ec-popover { transition: none; }
  @starting-style {
.ec-popover { opacity: 1; transform: none; }
  }
}
.ec-note {
  padding: 14px 12px; font-size: 12px; line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
}
.ec-note code {
  font-size: 11px; padding: 1px 4px; border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12));
}

/* Settings rows use the host panel typography and spacing. */
.ec-page { display: flex; flex-direction: column; width: 100%; }
[data-item] {
  display: flex; justify-content: space-between; align-items: center;
  gap: 24px; padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
}
[data-item]:last-child { border-bottom: none; }
[data-item][data-stacked] { flex-direction: column; align-items: stretch; gap: 0; }
/* The row's own line: title and description at the start, control at the end.
 * It must NOT share the folder rows' centre alignment, which would centre the
 * switch against the whole text block and visibly break the baseline. */
.ec-head-row {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 24px; width: 100%; min-width: 0;
}
.ec-head { min-width: 0; }
.ec-title {
  font-size: 14px; line-height: 20px; font-weight: 400;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.ec-desc {
  margin-top: 4px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
}

/* One folder line, appended under the row it belongs to. */
.ec-lines { display: flex; flex-direction: column; width: 100%; min-width: 0; }
.ec-path-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 0; min-width: 0;
}
.ec-path-row + .ec-path-row { border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.18)); }
.ec-path-row input {
  flex: 1; min-width: 0; box-sizing: border-box; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4, rgba(128, 128, 128, 0.34));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3, transparent);
  font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.ec-path-row input:focus-visible {
  outline: none; border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4d6bfe));
}
.ec-path-row input:disabled { color: var(--dsw-alias-label-tertiary, #8c8c8c); cursor: default; }
.ec-path-row input[data-missing='true'] { border-color: var(--dsw-alias-state-error-primary, #d43d3d); }
.ec-remove {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: none; color: var(--dsw-alias-label-tertiary, #8c8c8c); cursor: pointer;
}
.ec-remove:disabled { opacity: 0.4; cursor: default; }
@media (hover: hover) and (pointer: fine) {
  .ec-remove:hover:not(:disabled) {
background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12));
color: var(--dsw-alias-label-secondary, #6b6b6b);
  }
}
.ec-remove:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #4d6bfe));
  outline-offset: 1px;
}

/* \u2500\u2500 The found-sticker preview \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.ec-preview {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0 4px;
}
.ec-tile {
  display: flex; align-items: center; justify-content: center;
  box-sizing: border-box; width: 44px; height: 44px; padding: 3px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.06));
}
.ec-tile img { max-width: 100%; max-height: 100%; width: auto; height: auto; display: block; }
.ec-tile[data-more] {
  font-size: 11px; line-height: 1; color: var(--dsw-alias-label-tertiary, #8c8c8c);
}

/* \u2500\u2500 Foot: the scan report and the actions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.ec-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 12px 0 4px; min-height: 34px;
}
/* Informational only: the scan total, or the paths that could not be read. */
.ec-note-line {
  flex: 1; min-width: 0; margin: 0;
  font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-tertiary, #8c8c8c);
}
.ec-note-line[data-tone='error'] { color: var(--dsw-alias-state-error-primary, #d43d3d); }
.ec-actions { display: flex; align-items: center; gap: 8px; flex: none; }

/* Entry transitions do not replay on configuration refresh; Toast handles save feedback. */
.ec-drawer,
.ec-tile {
  opacity: 1;
  transform: none;
  transition: opacity 150ms ease, transform 150ms ease;
}
@starting-style {
  .ec-drawer { opacity: 0; transform: translateY(-4px); }
  .ec-tile { opacity: 0; transform: translateY(4px); }
}
/* The stagger says "these are separate items". Delaying only the entry keeps a
 * re-render silent, because a re-render transitions nothing at all. */
.ec-tile:nth-child(2) { transition-delay: 20ms; }
.ec-tile:nth-child(3) { transition-delay: 40ms; }
.ec-tile:nth-child(4) { transition-delay: 60ms; }
.ec-tile:nth-child(5) { transition-delay: 80ms; }
.ec-tile:nth-child(n + 6) { transition-delay: 100ms; }
@media (prefers-reduced-motion: reduce) {
  .ec-drawer,
  .ec-tile {
transition: none;
  }
  @starting-style {
.ec-drawer,
.ec-tile {
  opacity: 1;
  transform: none;
}
  }
}

/* \u2500\u2500 Conversation decorations \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
/* Decorative chips live inside the Desktop bubble and use the host pill tokens. */
.ec-chips {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 4px;
  /* The bottom margin cancels most of the bubble's own bottom padding, so the
   * strip sits snugly at the foot of the message instead of floating in it. */
  margin: 6px 0 -6px;
  max-width: 100%;
}
.ec-chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px;
  border: none; border-radius: 999px;
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16));
  animation: ec-chip-in 220ms ease-out;
}
@keyframes ec-chip-in {
  from { opacity: 0; transform: translateY(3px) scale(0.9); }
  to { opacity: 1; transform: none; }
}
[data-emote-sticker] { display: block; max-width: 100%; margin: 6px 0; }
/* User stickers inherit the Desktop userStack alignment. */
[data-emote-sticker] img {
  display: block; max-width: min(320px, 100%); max-height: 240px; width: auto; height: auto;
  border-radius: var(--dsw-radius-md, 8px); background: transparent;
}
[data-emote-sticker][data-failed] img { display: none; }
.ec-tool-card { display: flex; flex-direction: column; gap: 4px; margin: 4px 0; }
.ec-tool-card figcaption {
  font-size: 11px; line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8c8c8c);
}
.ec-tool-card img {
  display: block; max-width: min(260px, 100%); max-height: 200px; width: auto; height: auto;
  border-radius: var(--dsw-radius-md, 8px);
}
.ec-tool-emoji { font-size: 22px; line-height: 28px; }
.ec-rain { position: fixed; inset: 0; z-index: 9999; pointer-events: none; overflow: hidden; }
/* Rain falls: the glyphs wait above the viewport and travel down past it. The
 * first version started them below the fold and translated upward, which is a
 * fountain, not rain. */
.ec-rain > span {
  position: absolute; top: -10vh; line-height: 1; will-change: transform, opacity;
  animation-name: ec-rain-fall; animation-timing-function: linear; animation-fill-mode: forwards;
}
@keyframes ec-rain-fall {
  0% { transform: translate3d(0, 0, 0) scale(0.85); opacity: 0; }
  10% { opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translate3d(var(--ec-drift, 0px), 118vh, 0) scale(1.05); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ec-chip { animation: none; }
}`;
function installStyles() {
  const existing = document.querySelector(
    'style[data-plugin-css="dsh-plugin-emote-chat"]'
  );
  if (existing !== null) return () => {
  };
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-plugin-emote-chat";
  tag.dataset.pluginCss = "dsh-plugin-emote-chat";
  tag.textContent = CSS;
  document.head.appendChild(tag);
  return () => {
    tag.remove();
  };
}

// src/client/locale.js
var zh = {
  "section.nav": "\u8D34\u7EB8\u4E92\u52A8",
  "section.stickerReply.label": "\u542F\u7528\u8D34\u7EB8/\u8868\u60C5\u5305\u56DE\u590D",
  "section.stickerReply.hint": "\u4ECE\u8F93\u5165\u6846\u53D1\u9001\u8D34\u7EB8\uFF0CAgent \u4E5F\u53EF\u4F7F\u7528\u3002",
  "section.paths.label": "\u8868\u60C5\u5305/\u8D34\u7EB8\u8BFB\u53D6\u8DEF\u5F84",
  "section.paths.hint": "\u76EE\u5F55\u540D\u5373\u5305\u540D\uFF0C\u5B50\u76EE\u5F55\u4F5C\u4E3A\u5B50\u5305\u3002",
  "section.paths.placeholder": "D:\\stickers\\cats",
  "section.paths.add": "\u6DFB\u52A0\u76EE\u5F55",
  "section.paths.remove": "\u79FB\u9664\u8FD9\u4E00\u884C",
  "section.emojiReply.label": "\u542F\u7528 emoji \u56DE\u590D",
  "section.emojiReply.hint": "\u56DE\u5E94\u663E\u793A\u5728\u6D88\u606F\u4E0B\u65B9\uFF0C\u4E0D\u8BA1\u5165\u804A\u5929\u5386\u53F2\u3002",
  "section.emojiRain.label": "\u542F\u7528 emoji \u96E8",
  "section.emojiRain.hint": "\u8BA9 emoji \u56DE\u5E94\u98D8\u843D\u6574\u4E2A\u9875\u9762\u3002",
  "section.save": "\u4FDD\u5B58",
  "section.saved": "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58",
  "section.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}",
  "section.loadFailed": "\u65E0\u6CD5\u8BFB\u53D6\u8BBE\u7F6E\uFF1A{message}",
  "section.scan": "\u91CD\u65B0\u626B\u63CF",
  "section.scanCompleted": "\u626B\u63CF\u5B8C\u6210",
  "section.scanned": "{packs} \u4E2A\u8868\u60C5\u5305 \xB7 {stickers} \u5F20\u56FE\u7247",
  "section.scanEmpty": "\u6CA1\u6709\u627E\u5230\u56FE\u7247\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u662F\u5426\u5B58\u5728\u3002",
  "section.scanError": "\u4EE5\u4E0B\u8DEF\u5F84\u4E0D\u53EF\u7528\uFF1A{paths}",
  "section.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "picker.open": "\u53D1\u9001\u8D34\u7EB8/\u8868\u60C5\u5305",
  "picker.title": "\u8D34\u7EB8",
  "picker.packs": "\u8868\u60C5\u5305\u76EE\u5F55",
  "picker.close": "\u5173\u95ED",
  "picker.empty": "\u8FD8\u6CA1\u6709\u53EF\u7528\u8868\u60C5\u5305\u3002\u8BF7\u5230\u300C\u8BBE\u7F6E \u2192 \u8D34\u7EB8\u4E92\u52A8\u300D\u91CC\u586B\u5199\u8868\u60C5\u5305\u8DEF\u5F84\u3002",
  "picker.failed": "\u65E0\u6CD5\u8BFB\u53D6\u8868\u60C5\u5305\u76EE\u5F55\uFF1A{message}",
  "picker.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "sticker.alt": "\u8D34\u7EB8 {name}",
  "sticker.label": "\u8D34\u7EB8",
  "reaction.title": "emoji \u56DE\u5E94",
  "section.store.label": "emoji \u56DE\u5E94\u5B58\u50A8",
  "section.store.hint": "\u672C\u5730\u4FDD\u5B58\uFF0C\u91CD\u542F\u4FDD\u7559\uFF1B\u6700\u591A {limit} \u6761\uFF0C\u81EA\u52A8\u79FB\u9664\u6700\u65E7\u56DE\u5E94\u3002",
  "section.store.clear": "\u6E05\u7A7A\u5168\u90E8\u56DE\u5E94",
  "section.store.cleared": "\u5DF2\u6E05\u7A7A\u5168\u90E8\u56DE\u5E94",
  "section.store.clearFailed": "\u6E05\u7A7A\u5931\u8D25\uFF1A{message}",
  "section.store.busy": "\u5904\u7406\u4E2D\u2026"
};
var en = {
  "section.nav": "Stickers & emoji",
  "section.stickerReply.label": "Enable sticker / meme replies",
  "section.stickerReply.hint": "Send stickers from the composer or let the Agent use them.",
  "section.paths.label": "Sticker folders",
  "section.paths.hint": "Folder names become pack names; nested folders become sub-packs.",
  "section.paths.placeholder": "D:\\stickers\\cats",
  "section.paths.add": "Add folder",
  "section.paths.remove": "Remove this row",
  "section.emojiReply.label": "Enable emoji replies",
  "section.emojiReply.hint": "Reactions appear below messages and stay out of chat history.",
  "section.emojiRain.label": "Enable emoji rain",
  "section.emojiRain.hint": "Let emoji reactions rain across the page.",
  "section.save": "Save",
  "section.saved": "Settings saved",
  "section.saveFailed": "Could not save: {message}",
  "section.loadFailed": "Could not read the settings: {message}",
  "section.scan": "Rescan",
  "section.scanCompleted": "Scan complete",
  "section.scanned": "{packs} packs \xB7 {stickers} images",
  "section.scanEmpty": "No images found \u2014 check that the folders exist.",
  "section.scanError": "Unusable paths: {paths}",
  "section.loading": "Loading\u2026",
  "picker.open": "Send a sticker",
  "picker.title": "Stickers",
  "picker.packs": "Sticker folders",
  "picker.close": "Close",
  "picker.empty": "No stickers yet. Add sticker folders in Settings \u2192 Stickers & emoji.",
  "picker.failed": "Could not read the sticker folders: {message}",
  "picker.loading": "Loading\u2026",
  "sticker.alt": "Sticker {name}",
  "sticker.label": "Sticker",
  "reaction.title": "Emoji reaction",
  "section.store.label": "Reaction storage",
  "section.store.hint": "Saved locally across restarts. Keeps up to {limit} reactions, removing the oldest automatically.",
  "section.store.clear": "Clear all reactions",
  "section.store.cleared": "All reactions cleared",
  "section.store.clearFailed": "Could not clear: {message}",
  "section.store.busy": "Working\u2026"
};

// src/client/feed.js
function createReactionFeed() {
  const store = createStore({ entries: [], status: "connecting" });
  const controller = new AbortController();
  let epoch = "";
  let cursor = 0;
  let primed = false;
  let disposed = false;
  let timer;
  let wake;
  const pause = (ms) => new Promise((resolve) => {
    wake = resolve;
    timer = setTimeout(resolve, ms);
  });
  async function pump() {
    while (!disposed) {
      const started = Date.now();
      let delay = 100;
      try {
        const payload = await getJson(
          API + "/reactions?since=" + cursor + "&epoch=" + encodeURIComponent(epoch) + "&wait=1",
          controller.signal
        );
        if (disposed) return;
        if (typeof payload?.epoch !== "string" || !payload.epoch || !Number.isSafeInteger(payload.seq) || payload.seq < 0 || typeof payload.enabled !== "boolean" || !Array.isArray(payload.reactions))
          throw new Error("invalid reaction snapshot");
        const sameEpoch = epoch === payload.epoch;
        const previous = new Map(
          store.get().entries.map((entry) => [entry.seq, entry])
        );
        const entries = (payload.enabled === false ? [] : payload.reactions).slice(-STORE_LIMIT).map((entry) => ({
          ...entry,
          key: `${payload.epoch}:${entry.seq}`,
          live: sameEpoch && previous.has(entry.seq) ? previous.get(entry.seq).live : primed && sameEpoch && entry.seq > cursor
        }));
        epoch = payload.epoch;
        cursor = payload.seq;
        primed = true;
        store.set({ entries, status: "ready" });
        delay = payload.enabled === false ? 2500 : 100;
      } catch (error) {
        if (disposed || error.name === "AbortError") return;
        store.set({ ...store.get(), status: "error" });
        delay = 2500;
      }
      if (!disposed) await pause(Math.max(0, delay - (Date.now() - started)));
    }
  }
  void pump();
  return {
    store,
    dispose() {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      wake?.();
    }
  };
}

// src/client/dom.js
function findClassFragment(root, fragment) {
  for (const node of root.querySelectorAll("div")) {
    if (typeof node.className === "string" && node.className.split(/\s+/u).some((name) => name.endsWith("_" + fragment)))
      return node;
  }
  return null;
}

// src/client/stickers.js
function rowOf(element) {
  return element?.closest?.("[data-chat-flow-kind]") ?? null;
}
function textWithoutGhosts(element) {
  let out = "";
  for (const child of element.childNodes ?? []) {
    if (child.nodeType === 3) {
      out += child.nodeValue ?? "";
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (child.getAttribute?.("data-emote-hidden") !== null && child.getAttribute?.("data-emote-hidden") !== void 0)
      continue;
    out += textWithoutGhosts(child);
  }
  return out;
}
function isGhost(node) {
  return node?.nodeType === 1 && node.getAttribute?.("data-emote-hidden") != null;
}
function trimOuterWhitespace(container) {
  const hide = (node, leading) => {
    const value = node.nodeValue ?? "";
    const removed = leading ? /^[\r\n]+/u.exec(value)?.[0] : /[\r\n]+$/u.exec(value)?.[0];
    if (!removed) return;
    const ghost = document.createElement("span");
    ghost.setAttribute("data-emote-hidden", "1");
    ghost.style.display = "none";
    ghost.textContent = removed;
    if (leading) {
      container.insertBefore(ghost, node);
      node.nodeValue = value.slice(removed.length);
    } else {
      node.nodeValue = value.slice(0, -removed.length);
      node.after(ghost);
    }
  };
  const first = [...container.childNodes].find((node) => !isGhost(node));
  const last = [...container.childNodes].reverse().find((node) => !isGhost(node));
  if (first?.nodeType === 3) hide(first, true);
  if (last?.nodeType === 3) hide(last, false);
}
function stickerAnchor(row) {
  const kind = row.getAttribute("data-chat-flow-kind");
  if (kind === "user" || kind === "steering")
    return findClassFragment(row, "userStack");
  return row;
}
function buildSticker(id, t) {
  const figure = document.createElement("figure");
  figure.setAttribute("data-emote-sticker", id);
  const image = document.createElement("img");
  image.src = stickerUrl(id);
  image.alt = t("sticker.alt", { name: id });
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener(
    "error",
    () => figure.setAttribute("data-failed", "1")
  );
  figure.append(image);
  return figure;
}
function createStickerPainter({ getCatalog, t, isEnabled }) {
  const ghosts = /* @__PURE__ */ new Map();
  const hiddenElements = /* @__PURE__ */ new Map();
  const ghostFor = (raw, stickerId) => {
    const ghost = document.createElement("span");
    ghost.setAttribute("data-emote-hidden", "1");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("data-emote-token", stickerId);
    ghost.style.display = "none";
    ghost.style.position = "absolute";
    ghost.style.width = "0";
    ghost.style.height = "0";
    ghost.style.overflow = "hidden";
    ghost.textContent = raw;
    ghosts.set(ghost, void 0);
    return ghost;
  };
  const reconcile = () => {
    for (const [element, display] of hiddenElements) {
      if (!element.isConnected) hiddenElements.delete(element);
      else if (textWithoutGhosts(element).trim() !== "" || element.querySelector("[data-emote-sticker]") !== null) {
        element.style.display = display;
        hiddenElements.delete(element);
      }
    }
    for (const [ghost, ownedFigure] of ghosts) {
      if (ghost.parentElement === null || ghost.isConnected === false) {
        ownedFigure?.remove();
        ghosts.delete(ghost);
        continue;
      }
      const id = ghost.getAttribute("data-emote-token");
      if (id === null || id === "") continue;
      const row = rowOf(ghost);
      if (row === null) continue;
      const figures = [...row.querySelectorAll("[data-emote-sticker]")].filter(
        (figure2) => figure2.getAttribute("data-emote-sticker") === id
      );
      if (figures.length === 1) continue;
      for (const extra of figures.slice(1)) extra.remove();
      if (figures.length >= 1) {
        continue;
      }
      const figure = buildSticker(id, t);
      const anchor = stickerAnchor(row);
      if (anchor === null) continue;
      anchor.insertBefore(figure, anchor.firstChild);
      ghosts.set(ghost, figure);
    }
  };
  const scan = () => {
    if (!isEnabled()) {
      restore();
      return;
    }
    const catalog = getCatalog();
    if (catalog === void 0) return;
    if ([...ghosts.keys()].some((ghost) => {
      const id = ghost.getAttribute("data-emote-token");
      return id && findSticker(catalog, id) === void 0;
    })) restore();
    reconcile();
    const roots = document.querySelectorAll("[data-chat-flow-kind]");
    for (const root of roots) {
      if (!MESSAGE_FLOW_KINDS.has(root.getAttribute("data-chat-flow-kind") ?? ""))
        continue;
      const row = rowOf(root) ?? root;
      const anchor = stickerAnchor(row);
      if (anchor === null) continue;
      const carriers = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) !== null) {
        const parent = node.parentElement;
        if (parent === null) continue;
        if (parent.closest("[data-emote-hidden]") !== null) continue;
        if (parent.closest("[data-emote-sticker]") !== null) continue;
        if (parent.closest("pre, code") !== null) continue;
        if (parent.closest(NON_MESSAGE_REGIONS) !== null) continue;
        const value = node.nodeValue ?? "";
        if (value.indexOf(TOKEN_OPEN) === -1) continue;
        if (splitTokens(value).every((segment) => segment.token === void 0))
          continue;
        carriers.push(node);
      }
      for (const carrier of carriers) {
        const segments = splitTokens(carrier.nodeValue ?? "");
        const placeable = segments.filter(
          (segment) => segment.token !== void 0 && findSticker(catalog, segment.token) !== void 0
        );
        if (placeable.length === 0) continue;
        const parent = carrier.parentElement;
        if (parent === null) continue;
        const fragment = document.createDocumentFragment();
        const figures = [];
        for (const segment of segments) {
          if (segment.token === void 0) {
            if (segment.text === "") continue;
            const previous = fragment.childNodes[fragment.childNodes.length - 1];
            const followsGhost = previous !== void 0 && previous.getAttribute?.("data-emote-hidden") != null;
            const whitespace = followsGhost ? /^[\s\u00a0]+/u.exec(segment.text)?.[0] ?? "" : "";
            if (whitespace) fragment.appendChild(ghostFor(whitespace, ""));
            fragment.appendChild(
              document.createTextNode(segment.text.slice(whitespace.length))
            );
            continue;
          }
          const raw = segment.raw ?? TOKEN_OPEN + segment.token + TOKEN_CLOSE;
          if (findSticker(catalog, segment.token) === void 0) {
            fragment.appendChild(document.createTextNode(raw));
            continue;
          }
          const ghost = ghostFor(raw, segment.token);
          fragment.appendChild(ghost);
          const figure = buildSticker(segment.token, t);
          ghosts.set(ghost, figure);
          figures.push(figure);
        }
        parent.replaceChild(fragment, carrier);
        if (figures.length === 0) continue;
        trimOuterWhitespace(parent);
        for (const figure of figures) {
          anchor.insertBefore(figure, anchor.firstChild);
        }
        let element = parent;
        while (element !== null && element !== row) {
          if (textWithoutGhosts(element).trim() === "" && element.querySelector("[data-emote-sticker]") === null) {
            if (!hiddenElements.has(element))
              hiddenElements.set(element, element.style.display);
            element.style.display = "none";
          }
          element = element.parentElement;
        }
      }
    }
    reconcile();
  };
  function restore() {
    for (const figure of document.querySelectorAll("[data-emote-sticker]"))
      figure.remove();
    for (const ghost of document.querySelectorAll("[data-emote-hidden]")) {
      ghost.parentElement?.replaceChild(
        document.createTextNode(ghost.textContent ?? ""),
        ghost
      );
    }
    for (const [element, display] of hiddenElements)
      element.style.display = display;
    hiddenElements.clear();
    ghosts.clear();
  }
  return { scan, dispose: restore };
}

// src/client/reactions.js
function reactionHost(flow) {
  return findClassFragment(flow, "bubble");
}
function messageIdOf(key) {
  const text = String(key ?? "");
  const match = new RegExp(`^\\d+:${MESSAGE_ID_MARKER}(.+)$`, "u").exec(text);
  return match?.[1];
}
function rowMatches(row, entry) {
  return typeof entry.messageId === "string" && messageIdOf(row.getAttribute("data-chat-node-key")) === entry.messageId;
}
function assignReactions(entries, messages) {
  const byMessage = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (entry?.seq === void 0) continue;
    const row = messages.find((candidate) => rowMatches(candidate, entry));
    if (row === void 0) continue;
    const list = byMessage.get(row) ?? [];
    list.push(entry);
    byMessage.set(row, list);
  }
  return byMessage;
}
function createReactionPainter({ getEntries }) {
  const rows = /* @__PURE__ */ new Map();
  const scan = () => {
    const messages = [
      ...document.querySelectorAll('[data-chat-flow-kind="user"]')
    ];
    const live = new Set(messages);
    for (const [row, chips] of rows) {
      if (live.has(row)) continue;
      chips.remove();
      rows.delete(row);
    }
    const byMessage = assignReactions(getEntries(), messages);
    for (const [row, chips] of rows) {
      if (!byMessage.has(row)) {
        chips.remove();
        rows.delete(row);
      }
    }
    for (const [row, list] of byMessage) {
      const host = reactionHost(row);
      if (host === null) {
        rows.get(row)?.remove();
        rows.delete(row);
        continue;
      }
      const shown = list.slice(-MAX_CHIPS);
      let chips = rows.get(row);
      if (chips !== void 0 && chips.parentElement !== host) {
        chips.remove();
        chips = void 0;
        rows.delete(row);
      }
      if (chips === void 0) {
        chips = document.createElement("div");
        chips.className = "ec-chips";
        chips.setAttribute("data-emote-chips", "");
        chips.setAttribute("aria-hidden", "true");
        host.append(chips);
        rows.set(row, chips);
      }
      const signature = JSON.stringify(
        shown.map((entry) => [entry.key, entry.emoji])
      );
      if (chips.getAttribute("data-si") === signature) continue;
      chips.setAttribute("data-si", signature);
      chips.replaceChildren(
        ...shown.map((entry) => {
          const chip = document.createElement("span");
          chip.className = "ec-chip";
          chip.textContent = entry.emoji;
          chip.title = new Date(entry.at ?? Date.now()).toLocaleTimeString();
          return chip;
        })
      );
    }
  };
  return {
    scan,
    dispose: () => {
      for (const chips of rows.values()) chips.remove();
      rows.clear();
    }
  };
}
function shouldRain(entry, now, seen) {
  if (entry?.live !== true || typeof entry.key !== "string") return false;
  if (seen.has(entry.key)) return false;
  return now - (entry.at ?? 0) <= RAIN_FRESH_MS;
}
var rainLog = { bursts: 0, last: null, skipped: [] };
var rainLayers = /* @__PURE__ */ new Map();
function disposeRain() {
  for (const [layer, timer] of rainLayers) {
    clearTimeout(timer);
    layer.remove();
  }
  rainLayers.clear();
}
function rain(emoji, count) {
  if (typeof document === "undefined") return void 0;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
    return void 0;
  rainLog.bursts += 1;
  rainLog.last = { emoji, count, at: Date.now() };
  const layer = document.createElement("div");
  layer.className = "ec-rain";
  layer.setAttribute("data-plugin", "dsh-plugin-emote-chat");
  layer.setAttribute("aria-hidden", "true");
  for (let index = 0; index < count; index += 1) {
    const span = document.createElement("span");
    span.textContent = emoji;
    span.style.left = (2 + Math.random() * 94).toFixed(2) + "%";
    span.style.fontSize = (18 + Math.random() * 26).toFixed(1) + "px";
    span.style.animationDuration = (3.4 + Math.random() * 2.4).toFixed(2) + "s";
    span.style.animationDelay = (Math.random() * 0.9).toFixed(2) + "s";
    span.style.setProperty(
      "--ec-drift",
      (Math.random() * 90 - 45).toFixed(1) + "px"
    );
    layer.append(span);
  }
  document.body.append(layer);
  rainLayers.set(
    layer,
    setTimeout(() => {
      layer.remove();
      rainLayers.delete(layer);
    }, 9e3)
  );
  return layer;
}

// src/client/components.js
var React2 = __toESM(require("react"), 1);
var primitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
var h = React2.createElement;
function StickerGlyph({ size = 16 }) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
      stroke: "currentColor",
      strokeWidth: 1.3,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    },
    // 贴纸外轮廓为折角留空。
    h("path", {
      d: "M13 8.5V3.5C13 2.67157 12.3284 2 11.5 2H4.5C3.67157 2 3 2.67157 3 3.5V12.5C3 13.3284 3.67157 14 4.5 14H8.5"
    }),
    // 绘制折角。
    h("path", { d: "M13 8.5H9.5C9.22386 8.5 9 8.72386 9 9V14" }),
    h("path", { d: "M13 8.5L9 14" }),
    // 表情符号让入口同时表达 emoji 功能。
    h("path", { d: "M5.9 6.6H5.91" }),
    h("path", { d: "M8.9 6.6H8.91" }),
    h("path", { d: "M5.9 8.9C6.2 9.3 6.6 9.5 7.1 9.5C7.6 9.5 8 9.3 8.3 8.9" })
  );
}
function Switch2({ checked, disabled, onToggle, label }) {
  return h(primitives.Switch, {
    checked,
    disabled: disabled === true,
    label,
    onChange: (next) => onToggle(next)
  });
}
function Item({ title, description, control, children }) {
  const [id] = React2.useState(
    () => "ec-item-" + Math.random().toString(36).slice(2, 9)
  );
  return h(
    "div",
    {
      "data-item": "",
      ...children === void 0 ? {} : { "data-stacked": "true" }
    },
    h(
      "div",
      { className: "ec-head-row" },
      h(
        "div",
        { className: "ec-head" },
        h("div", { className: "ec-title", id }, title),
        h("div", { className: "ec-desc", id: id + "-desc" }, description)
      ),
      control
    ),
    children === void 0 ? null : h(
      "div",
      {
        className: "ec-drawer",
        role: "group",
        "aria-labelledby": id,
        "aria-describedby": id + "-desc"
      },
      children
    )
  );
}
function Button2({ children, onClick, disabled, variant }) {
  return h(
    primitives.Button,
    {
      variant: variant ?? "ghost",
      size: "md",
      disabled: disabled === true,
      onClick
    },
    children
  );
}
function StickerPicker({ inputActions, t, catalog }) {
  const snapshot = useStore(catalog.store);
  const [open, setOpen] = React2.useState(false);
  const [packId, setPackId] = React2.useState(null);
  const rootRef = React2.useRef(null);
  const gridRef = React2.useRef(null);
  React2.useEffect(() => {
    if (!open) return void 0;
    const onPointerDown = (event) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target))
        setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
        return;
      const grid = gridRef.current;
      if (grid === null) return;
      const cells = [...grid.querySelectorAll("button")];
      if (cells.length === 0) return;
      const at = cells.indexOf(document.activeElement);
      if (at === -1) return;
      event.preventDefault();
      const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const next = (at + step + cells.length) % cells.length;
      cells[next].focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
  const packs = snapshot.data?.packs ?? [];
  const groups = /* @__PURE__ */ new Map();
  for (const pack of packs) {
    const [root, ...children] = pack.name.split("/");
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push({ pack, label: children.join("/") || root });
  }
  const active = packs.find((pack) => pack.id === packId) ?? packs[0];
  const stickers = active?.stickers ?? [];
  const insert = (sticker) => {
    const token = TOKEN_OPEN + sticker.id + TOKEN_CLOSE;
    try {
      const span = inputActions.captureInsertion();
      inputActions.insertText(token, span);
    } catch {
    }
    setOpen(false);
  };
  return h(
    "div",
    { className: "ec-picker-root", ref: rootRef },
    h(
      "button",
      {
        type: "button",
        className: "ec-trigger",
        "aria-label": t("picker.open"),
        title: t("picker.open"),
        "aria-expanded": open ? "true" : "false",
        onClick: () => {
          setOpen((value) => !value);
          if (!open) void catalog.load();
        }
      },
      h(StickerGlyph, null)
    ),
    open ? h(
      "div",
      {
        className: "ec-popover",
        role: "dialog",
        "aria-label": t("picker.title")
      },
      h(
        "div",
        { className: "ec-popover-head" },
        h("span", { className: "ec-popover-title" }, t("picker.title")),
        h(
          "button",
          {
            type: "button",
            className: "ec-close",
            "aria-label": t("picker.close"),
            title: t("picker.close"),
            onClick: () => setOpen(false)
          },
          h(primitives.IconCloseOutlineRegular, { size: 14 })
        )
      ),
      snapshot.status === "loading" && snapshot.data === void 0 ? h("div", { className: "ec-note" }, t("picker.loading")) : snapshot.status === "error" ? h(
        "div",
        { className: "ec-note" },
        t("picker.failed", { message: snapshot.error ?? "" })
      ) : packs.length === 0 ? h("div", { className: "ec-note" }, t("picker.empty")) : h(
        "div",
        { className: "ec-picker-body" },
        h(
          "nav",
          { className: "ec-packs", "aria-label": t("picker.packs") },
          ...[...groups].map(
            ([root, children]) => h(
              "div",
              { className: "ec-pack-group", key: root },
              h("div", { className: "ec-pack-root", title: root }, root),
              ...children.map(
                ({ pack, label }) => h(
                  "button",
                  {
                    key: pack.id,
                    type: "button",
                    className: "ec-pack",
                    title: pack.name,
                    "aria-label": pack.name,
                    "aria-pressed": active?.id === pack.id ? "true" : "false",
                    onClick: () => {
                      setPackId(pack.id);
                      if (gridRef.current !== null) gridRef.current.scrollTop = 0;
                    }
                  },
                  label
                )
              )
            )
          )
        ),
        h(
          "div",
          { className: "ec-picker-content" },
          h("div", { className: "ec-pack-title", title: active.name }, active.name),
          h(
            "div",
            { className: "ec-grid", key: active.id, ref: gridRef },
            ...stickers.map(
              (sticker) => h(
                "button",
                {
                  key: sticker.id,
                  type: "button",
                  className: "ec-cell",
                  title: sticker.id,
                  "aria-label": t("sticker.alt", {
                    name: sticker.id
                  }),
                  onClick: () => insert(sticker)
                },
                h("img", {
                  src: stickerUrl(sticker.id),
                  alt: "",
                  loading: "lazy"
                }),
                h("span", null, sticker.name)
              )
            )
          )
        )
      )
    ) : null
  );
}
function SettingsSection({ t, config, context }) {
  const snapshot = useStore(config.store);
  const [linesDraft, setLinesDraft] = React2.useState(null);
  const [alert, setAlert] = React2.useState(null);
  const [busy, setBusy] = React2.useState(false);
  const [saving, setSaving] = React2.useState(false);
  const savePending = React2.useRef(false);
  const [maintenance, setMaintenance] = React2.useState(null);
  const [toast, setToast] = React2.useState(null);
  const toastSequence = React2.useRef(0);
  const showSuccess = (text) => {
    toastSequence.current += 1;
    setToast({ id: toastSequence.current, text });
  };
  React2.useEffect(() => {
    mountLog.mounts += 1;
    mountLog.events.push({ at: Date.now(), kind: "mount" });
    if (mountLog.events.length > 24) mountLog.events.shift();
    return () => {
      mountLog.unmounts += 1;
      mountLog.events.push({ at: Date.now(), kind: "unmount" });
      if (mountLog.events.length > 24) mountLog.events.shift();
    };
  }, []);
  React2.useEffect(() => {
    void config.load();
  }, [config]);
  const data = snapshot.data;
  const settings = {
    stickerReply: data?.stickerReply === true,
    emojiReply: data?.emojiReply === true,
    emojiRain: data?.emojiRain === true
  };
  const saved = Array.isArray(data?.paths) ? data.paths : [];
  const lines = linesDraft ?? (saved.length === 0 ? [""] : saved);
  const commit = async (next, successKey = "section.saved") => {
    if (savePending.current) return false;
    savePending.current = true;
    setSaving(true);
    try {
      setToast(null);
      const result = await context.update({
        stickerReply: next.stickerReply,
        paths: splitLines((next.lines ?? []).join("\n")),
        emojiReply: next.emojiReply,
        emojiRain: next.emojiReply ? next.emojiRain : false
      });
      if (!result.ok) {
        setAlert(t("section.saveFailed", { message: result.message ?? "" }));
        return false;
      }
      setAlert(null);
      const refreshed = await config.load({ fresh: true });
      if (refreshed === void 0) return false;
      setLinesDraft(null);
      showSuccess(t(successKey));
      return true;
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };
  const clearAll = async () => {
    if (busy) return;
    setBusy(true);
    setToast(null);
    try {
      await postJson(API + "/clean", {});
      setMaintenance(null);
      showSuccess(t("section.store.cleared"));
    } catch (error) {
      setMaintenance({
        tone: "error",
        text: t("section.store.clearFailed", {
          message: String(error?.message ?? error)
        })
      });
    } finally {
      setBusy(false);
    }
  };
  const packs = data?.packs ?? [];
  const errors = data?.errors ?? [];
  const stickerCount = packs.reduce(
    (total, pack) => total + (pack.stickers?.length ?? 0),
    0
  );
  const broken = new Set(errors.map((entry) => entry.path));
  const scanNote = packs.length === 0 ? t("section.scanEmpty") : t("section.scanned", { packs: packs.length, stickers: stickerCount });
  if (data === void 0 && snapshot.status !== "error") {
    return h(
      "div",
      { className: "ec-page" },
      h("p", { className: "ec-note-line" }, t("section.loading"))
    );
  }
  const pathLine = (value, index) => h(
    "div",
    { className: "ec-path-row", key: "path-" + String(index) },
    h("input", {
      type: "text",
      spellCheck: false,
      value,
      disabled: saving,
      "data-missing": broken.has(value) ? "true" : void 0,
      placeholder: t("section.paths.placeholder"),
      "aria-label": t("section.paths.label"),
      "aria-invalid": broken.has(value) ? "true" : void 0,
      onChange: (event) => {
        const next = [...lines];
        next[index] = event.target.value;
        setLinesDraft(next);
      }
    }),
    h(
      "button",
      {
        type: "button",
        className: "ec-remove",
        disabled: saving || lines.length <= 1,
        "aria-label": t("section.paths.remove"),
        title: t("section.paths.remove"),
        onClick: () => setLinesDraft(lines.filter((_, at) => at !== index))
      },
      h(primitives.IconCloseOutlineRegular, { size: 14 })
    )
  );
  const preview = packs.flatMap((pack) => pack.stickers ?? []).slice(0, PREVIEW_LIMIT);
  const drawer = h(
    React2.Fragment,
    null,
    h(
      "div",
      { className: "ec-desc", style: { marginTop: "2px" } },
      t("section.paths.hint")
    ),
    h("div", { className: "ec-lines" }, ...lines.map(pathLine)),
    h(
      "div",
      { className: "ec-path-row" },
      h(
        Button2,
        { onClick: () => setLinesDraft([...lines, ""]), disabled: saving },
        t("section.paths.add")
      )
    ),
    packs.length > 0 ? h(
      "div",
      { className: "ec-preview" },
      ...preview.map(
        (sticker) => h(
          "span",
          { className: "ec-tile", key: sticker.id, title: sticker.id },
          h("img", {
            src: stickerUrl(sticker.id),
            alt: sticker.id,
            loading: "lazy"
          })
        )
      ),
      stickerCount > preview.length ? h(
        "span",
        { className: "ec-tile", "data-more": "" },
        "+" + String(stickerCount - preview.length)
      ) : null
    ) : null,
    h(
      "div",
      { className: "ec-foot" },
      h(
        "p",
        {
          className: "ec-note-line",
          "data-tone": errors.length > 0 ? "error" : void 0,
          role: errors.length > 0 ? "alert" : void 0
        },
        errors.length > 0 ? t("section.scanError", {
          paths: errors.map((entry) => entry.path).join(", ")
        }) : scanNote
      ),
      h(
        "div",
        { className: "ec-actions" },
        h(
          Button2,
          // 重写当前值使 Host 索引失效，再读取扫描结果。
          {
            disabled: saving,
            onClick: () => void commit({ ...settings, lines }, "section.scanCompleted")
          },
          t("section.scan")
        ),
        h(
          Button2,
          {
            variant: "primary",
            disabled: saving,
            onClick: () => void commit({ ...settings, lines })
          },
          t("section.save")
        )
      )
    )
  );
  return h(
    "div",
    { className: "ec-page", "data-emote-settings": "" },
    toast === null ? null : h(primitives.Toast, {
      key: toast.id,
      text: toast.text,
      tone: "success",
      onDone: () => setToast((current) => current?.id === toast.id ? null : current)
    }),
    snapshot.status === "error" ? h(
      "p",
      { className: "ec-note-line", "data-tone": "error", role: "alert" },
      t("section.loadFailed", { message: snapshot.error ?? "" })
    ) : null,
    alert === null ? null : h(
      "p",
      { className: "ec-note-line", "data-tone": "error", role: "alert" },
      alert
    ),
    h(
      Item,
      {
        title: t("section.stickerReply.label"),
        description: t("section.stickerReply.hint"),
        control: h(Switch2, {
          label: t("section.stickerReply.label"),
          checked: settings.stickerReply,
          disabled: saving,
          onToggle: (value) => void commit({ ...settings, stickerReply: value, lines })
        })
      },
      settings.stickerReply ? drawer : null
    ),
    h(
      Item,
      {
        title: t("section.emojiReply.label"),
        description: t("section.emojiReply.hint"),
        control: h(Switch2, {
          label: t("section.emojiReply.label"),
          checked: settings.emojiReply,
          disabled: saving,
          onToggle: (value) => void commit({
            ...settings,
            lines,
            emojiReply: value,
            emojiRain: value ? settings.emojiRain : false
          })
        })
      },
      settings.emojiReply ? h(Item, {
        title: t("section.emojiRain.label"),
        description: t("section.emojiRain.hint"),
        control: h(Switch2, {
          label: t("section.emojiRain.label"),
          checked: settings.emojiRain,
          disabled: saving,
          onToggle: (value) => void commit({ ...settings, lines, emojiRain: value })
        })
      }) : null
    ),
    // 存储由 Host 有界维护；设置页只提供整体清空。
    h(Item, {
      title: t("section.store.label"),
      description: t("section.store.hint", { limit: STORE_LIMIT }),
      control: h(
        "div",
        { className: "ec-actions" },
        h(
          Button2,
          { onClick: () => void clearAll(), disabled: busy },
          busy ? t("section.store.busy") : t("section.store.clear")
        )
      )
    }),
    maintenance === null ? null : h(
      "p",
      {
        className: "ec-note-line",
        "data-tone": maintenance.tone === "error" ? "error" : void 0,
        role: maintenance.tone === "error" ? "alert" : void 0
      },
      maintenance.text
    )
  );
}

// src/client/runtime.js
var h2 = React3.createElement;
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "emote-chat: dictionaries"
  );
  const t = (key, params) => ctx.locale.bind(NS)(key, params);
  const disposeStyles = installStyles();
  const configStore = createStore({
    status: "idle",
    data: void 0,
    error: void 0
  });
  const controller = new AbortController();
  let pendingConfig;
  const configFace = {
    store: configStore,
    load: async ({ fresh = false } = {}) => {
      if (pendingConfig) {
        const data = await pendingConfig;
        if (!fresh || controller.signal.aborted) return data;
      }
      if (controller.signal.aborted) return void 0;
      if (pendingConfig) return pendingConfig;
      pendingConfig = (async () => {
        patchStore(configStore, { status: "loading" });
        try {
          const data = await getJson(API + "/config", controller.signal);
          if (controller.signal.aborted) return void 0;
          configStore.set({
            status: "ready",
            data,
            error: void 0
          });
          return data;
        } catch (error) {
          if (controller.signal.aborted) return void 0;
          patchStore(configStore, {
            status: "error",
            error: String(error?.message ?? error)
          });
          return void 0;
        }
      })().finally(() => {
        pendingConfig = void 0;
      });
      return pendingConfig;
    }
  };
  const writeSettings = async (next) => {
    try {
      await postJson(
        API + "/settings",
        {
          stickerReply: next.stickerReply === true,
          paths: next.paths ?? [],
          emojiReply: next.emojiReply === true,
          emojiRain: next.emojiReply === true && next.emojiRain === true
        },
        controller.signal
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error.message ?? error) };
    }
  };
  const context = { update: writeSettings };
  const runtime = {
    configStore,
    configFace,
    painter: void 0,
    chips: void 0
  };
  ctx.effect(() => {
    let feed;
    let feedUnsubscribe;
    const rainSeen = /* @__PURE__ */ new Set();
    const warned = /* @__PURE__ */ new Set();
    let painter = null;
    let chips = null;
    let frame = 0;
    const unsubscribes = [];
    const feedFor = () => {
      if (!feed && configStore.get().data?.emojiReply === true) {
        feed = createReactionFeed();
        feedUnsubscribe = feed.store.subscribe(schedule);
      }
      return feed;
    };
    const tick = () => {
      frame = 0;
      for (const [label, pass] of [
        ["sticker-painter", () => painter?.scan()],
        ["reaction-chips", () => chips?.scan()]
      ]) {
        try {
          pass();
        } catch (error) {
          if (!warned.has(label)) {
            warned.add(label);
            console.error("[emote-chat] " + label + " pass failed", error);
          }
        }
      }
      if (configStore.get().data?.emojiRain !== true) return;
      for (const entry of feed?.store.get().entries ?? []) {
        if (!shouldRain(entry, Date.now(), rainSeen)) {
          if (entry.live === true && !rainSeen.has(entry.key)) {
            rainSeen.add(entry.key);
            if (rainSeen.size > STORE_LIMIT * 2)
              rainSeen.delete(rainSeen.values().next().value);
            rainLog.skipped.push({
              emoji: entry.emoji,
              seq: entry.seq,
              ageMs: Date.now() - (entry.at ?? 0),
              why: "too-old"
            });
            if (rainLog.skipped.length > 12) rainLog.skipped.shift();
          }
          continue;
        }
        rainSeen.add(entry.key);
        rain(entry.emoji, RAIN_COUNT);
        if (rainSeen.size > STORE_LIMIT * 2)
          rainSeen.delete(rainSeen.values().next().value);
      }
    };
    function schedule() {
      if (frame !== 0) return;
      frame = requestAnimationFrame(tick);
    }
    painter = createStickerPainter({
      t,
      getCatalog: () => configStore.get().data,
      isEnabled: () => configStore.get().data?.stickerReply === true
    });
    chips = createReactionPainter({
      getEntries: () => configStore.get().data?.emojiReply === true ? feedFor()?.store.get().entries ?? [] : []
    });
    const syncFeed = () => {
      if (configStore.get().data?.emojiReply === true) feedFor();
      else if (feed) {
        feedUnsubscribe();
        feedUnsubscribe = void 0;
        feed.dispose();
        feed = void 0;
      }
      schedule();
    };
    runtime.painter = painter;
    runtime.chips = chips;
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    unsubscribes.push(configStore.subscribe(syncFeed));
    const configTimer = setInterval(() => {
      void configFace.load();
    }, 5e3);
    unsubscribes.push(() => clearInterval(configTimer));
    void configFace.load().then(schedule);
    schedule();
    runtime.debug = () => {
      const flows = [...document.querySelectorAll("[data-chat-flow-kind]")];
      const tokens = flows.map((flow) => {
        const found = splitTokens(flow.textContent ?? "").filter(
          (segment) => segment.token !== void 0
        );
        return found.length === 0 ? void 0 : {
          kind: flow.getAttribute("data-chat-flow-kind"),
          key: flow.getAttribute("data-chat-node-key"),
          tokens: found.map((segment) => segment.token),
          alreadyPainted: flow.querySelector("[data-emote-sticker]") !== null
        };
      }).filter(Boolean);
      const users = [
        ...document.querySelectorAll('[data-chat-flow-kind="user"]')
      ].map((flow) => {
        const host = reactionHost(flow);
        return {
          key: flow.getAttribute("data-chat-node-key"),
          host: host?.className ?? null,
          chips: flow.querySelector("[data-emote-chips]")?.textContent ?? null
        };
      });
      return {
        enabled: {
          stickerReply: configStore.get().data?.stickerReply === true,
          emojiReply: configStore.get().data?.emojiReply === true,
          emojiRain: configStore.get().data?.emojiRain === true
        },
        configStatus: configStore.get().status,
        // 保留近期雨的触发和跳过原因，便于定位展示故障。
        rain: {
          enabled: configStore.get().data?.emojiRain === true,
          freshWindowMs: RAIN_FRESH_MS,
          bursts: rainLog.bursts,
          last: rainLog.last,
          skipped: rainLog.skipped,
          layersInDom: document.querySelectorAll(".ec-rain").length,
          stylesheet: document.querySelector(
            'style[data-plugin-css="dsh-plugin-emote-chat"]'
          ) !== null
        },
        packs: (configStore.get().data?.packs ?? []).map((pack) => pack.id),
        flowCount: flows.length,
        flowsWithTokens: tokens,
        userMessages: users,
        reactions: {
          hosted: (feed?.store.get().entries ?? []).map(
            (entry) => ({
              seq: entry.seq,
              emoji: entry.emoji,
              live: entry.live === true
            })
          ),
          feedStatus: feed?.store.get().status ?? "disabled",
          feedCount: feed ? 1 : 0
        },
        mounts: { ...mountLog }
      };
    };
    if (typeof window !== "undefined") window.__emoteChat = runtime;
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      for (const unsubscribe of unsubscribes) unsubscribe();
      feed?.dispose();
      feed = void 0;
      chips.dispose();
      feedUnsubscribe?.();
      painter.dispose();
      disposeRain();
      if (window.__emoteChat === runtime) delete window.__emoteChat;
    };
  }, "emote-chat: conversation enrichment");
  ctx.slots.inject(
    "tool.call.toolview",
    () => ctx.slots.register(
      { name: "tool.call.toolview", key: "emote_reply", locale: NS },
      function EmoteToolCard(props) {
        const block = props.block ?? {};
        const raw = typeof block.argsRaw === "string" ? block.argsRaw : "";
        let args = {};
        try {
          const parsed = JSON.parse(raw);
          if (parsed !== null && typeof parsed === "object") args = parsed;
        } catch {
          args = {};
        }
        const stickerId = typeof args.sticker === "string" ? args.sticker.trim() : "";
        const emoji = typeof args.emoji === "string" ? args.emoji.trim() : "";
        const label = props.t ?? t;
        if (stickerId !== "") {
          return h2(
            "figure",
            { className: "ec-tool-card" },
            h2("figcaption", null, label("sticker.label") + " \xB7 " + stickerId),
            h2("img", {
              src: stickerUrl(stickerId),
              alt: label("sticker.alt", { name: stickerId }),
              loading: "lazy"
            })
          );
        }
        if (emoji !== "")
          return h2(
            "div",
            { className: "ec-tool-emoji", title: label("reaction.title") },
            emoji
          );
        return null;
      }
    )
  );
  ctx.slots.inject(
    "conversation.input.left",
    () => ctx.slots.register(
      {
        name: "conversation.input.left",
        id: "emote-picker",
        order: 20,
        locale: NS
      },
      function EmotePicker(props) {
        const snapshot = useStore(configStore);
        if (snapshot.data?.stickerReply !== true) return null;
        return h2(StickerPicker, {
          inputActions: props.inputActions,
          t: props.t ?? t,
          catalog: configFace
        });
      }
    )
  );
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "emote-chat",
        order: 60,
        label: () => t("section.nav"),
        locale: NS
      },
      function EmoteSettings(props) {
        return h2(SettingsSection, {
          t: props.t ?? t,
          config: configFace,
          context
        });
      }
    )
  );
  return () => {
    controller.abort();
    disposeStyles();
  };
}
var internals = {
  createStickerPainter,
  createReactionPainter,
  assignReactions,
  reactionHost,
  splitTokens,
  findSticker,
  messageIdOf,
  rowMatches,
  SettingsSection,
  shouldRain,
  RAIN_FRESH_MS,
  createReactionFeed,
  rain,
  disposeRain
};
return module.exports;}});
