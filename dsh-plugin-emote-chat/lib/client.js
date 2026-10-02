window.__ModuleLoader__.load({
  id: "dsh-plugin-emote-chat",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    /**
     * The shipped UI primitives.
     *
     * `@deepseek-ai/dsh-client-ui-primitives` is in the platform's module seed
     * table, so it resolves without an `external` declaration. Using its
     * `Switch`, `Button` and icons instead of hand-rolled ones is what makes this
     * page behave and look like the rest of Settings: the same track size, the
     * same thumb travel, the same focus ring, the same control height.
     */
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    // ─────────────────────────────── constants ───────────────────────────────

    /** Dictionary namespace owned by this plugin. */
    const NS = "emote";
    /** Host route prefix (the Host half owns these exact Fetch routes). */
    const API = "/api/emote-chat";
    /** The settings namespace is the Host row id this bundle's patch inserts. */
    const SETTINGS_NS = "emote-chat";
    /** Sticker token prefix; the wire form is `[[sticker:pack/name]]`. */
    const TOKEN_OPEN = "[[sticker:";
    const TOKEN_CLOSE = "]]";
    /**
     * The marker inside a chat node key that precedes the message id.
     *
     * `data-chat-node-key` is `<seq>:input-message<id>`; the id is the
     * `user/message` event's own id, so it is what a reaction is anchored by. This
     * one string is the whole contract with the chat's DOM.
     */
    const MESSAGE_ID_MARKER = "input-message";
    /**
     * Flow kinds that are actual message bodies, where a sticker belongs.
     *
     * Verified against the desktop build's ui-chat client, which routes every
     * flow item through `routedNode.kind`. The process surfaces — `turn-process`,
     * `turn-trigger`, `turn-error`, `turn-max-tokens`, `turn-tail` — and the
     * `system-prompt` dump are NOT messages: the reasoning preview legitimately
     * *mentions* `[[sticker:…]]` while discussing it, and painting there put a
     * sticker inside the thinking block.
     */
    const MESSAGE_FLOW_KINDS = new Set(["user", "steering", "assistant-step", "developer-message"]);
    /**
     * Regions whose text must never be painted, even inside a message kind.
     *
     * Reasoning and the step-process rows carry `data-step-process*`, and a tool
     * card's arguments and result live under a `call:` anchor.
     */
    const NON_MESSAGE_REGIONS =
      "[data-step-process], [data-step-process-body], [data-step-process-content], [data-chat-anchor-key^='call:']";
    /** Reaction chips kept under one user message. */
    const MAX_CHIPS = 8;
    /**
     * The Host's reaction-store bound, quoted in the settings copy.
     *
     * A literal rather than a fetched value: it appears only in explanatory text,
     * so a drift would show up as a wrong number in a sentence, never as a
     * behaviour difference. The Host remains the owner of the real limit.
     */
    const STORE_LIMIT = 500;
    /** Emoji spawned by one rain burst. */
    const RAIN_COUNT = 26;
    /**
     * How recent a reaction must be for the rain to play.
     *
     * Chosen against the write and poll path: the tool records the reaction, the
     * Host answers the browser's poll, and the tick runs a frame later. A few
     * seconds of slack absorbs a slow write or a busy main thread, while a
     * reaction from before a page load is far outside it and stays a chip only —
     * the rain is a response to something the user just did.
     */
    const RAIN_FRESH_MS = 15000;
    /** How many sticker thumbnails the settings preview shows before "+N". */
    const PREVIEW_LIMIT = 12;
    /** How often the visible session is re-checked. */
    const SESSION_WATCH_MS = 1200;
    /** A trailing-emoji reaction must come from a short tail, not a long paragraph. */
    const EMOJI_REPLY_MAX_CHARS = 32;
    /** One trailing emoji (with an optional variation selector or ZWJ join). */
    const EMOJI_REPLY_PATTERN =
      /([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]+)$/u;

    /**
     * Mount bookkeeping for the settings page.
     *
     * A page that only re-renders should mount once. `unmount` immediately
     * followed by `mount` means React treated the element as a different one,
     * which is what a full-page flash actually is. `__emoteChat.mounts()` reports
     * it.
     */
    const mountLog = { mounts: 0, unmounts: 0, events: [] };
    // ──────────────────────────────── styles ────────────────────────────────

    const CSS = `.ec-picker-root { position: relative; display: inline-flex; }
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

/* ── The popup ────────────────────────────────────────────────────────────────
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
  width: min(340px, 76vw); max-height: 360px;
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

/* Pack chips: one row, one selected, no wrapping. */
.ec-packs {
  display: flex; flex-wrap: nowrap; gap: 4px;
  padding: 0 12px 8px; overflow-x: auto; scrollbar-width: none;
}
.ec-packs::-webkit-scrollbar { display: none; }
.ec-pack {
  appearance: none; flex: none;
  border: 0; border-radius: var(--dsw-radius-sm, 6px); padding: 3px 9px;
  font: inherit; font-size: 12px; line-height: 18px; white-space: nowrap;
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

.ec-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 4px;
  padding: 0 8px 8px; overflow-y: auto;
}
.ec-cell {
  appearance: none; display: flex; flex-direction: column; align-items: center; gap: 2px;
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
 * with opacity; 0.97 is the popover recipe's floor — never scale(0), because
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

/* ── Settings page ────────────────────────────────────────────────────────────
 *
 * Every number here is copied from the shipped Settings surfaces rather than
 * invented, so this page cannot drift from the rest of the panel:
 *   row      flex, justify-between, gap 24, padding 16px 0,
 *            border-bottom .5px var(--dsw-alias-border-l2)
 *   title    14px / 20px, var(--dsw-alias-label-primary)
 *   desc     12px / 18px, var(--dsw-alias-label-secondary), margin-top 4px
 *   input    height 34, padding 0 12, border .5px var(--dsw-alias-border-l4),
 *            radius var(--dsw-radius-md), bg var(--dsw-alias-bg-layer-3)
 *
 * The shipped section strips the trailing separator with
 * "section > [item] > :last-child { border-bottom: none }". Generalised here to
 * "no separator under the last row of any group", because this page nests the
 * emoji-rain row inside the emoji-reply row and a descendant-only selector left
 * two stray rules at the bottom of the panel.
 */
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

/* ── The found-sticker preview ────────────────────────────────────────────── */
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

/* ── Foot: the scan report and the actions ────────────────────────────────── */
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

/* ── Settings motion ──────────────────────────────────────────────────────────
 *
 * The parameters are the shipped panel's own: the CSS keyword ease at 100-150ms
 * plus a prefers-reduced-motion opt-out. DSH animates opacity here and nothing
 * else, so a page that scaled or slid would read as a foreign component — the
 * restraint IS the house style.
 *
 * Two places move, and neither is a write confirmation: the panel does not
 * acknowledge a successful save, so neither does this page. What is left is the
 * one thing the user cannot otherwise see — that the switch they just flipped
 * produced the section below it — and the stagger that shows a folder resolved
 * into actual stickers.
 *
 * These are TRANSITIONS with @starting-style, not animation keyframes. An
 * animation plays for as long as its element exists, so every re-render replayed
 * it and flipping a switch flashed the drawer and all the thumbnails; a
 * transition runs only when the property actually changes, and @starting-style
 * supplies the "before" state for the one frame the element first appears in.
 * Without @starting-style support the element simply appears: a missing entrance
 * must never leave content invisible.
 */
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

/* ── Conversation decorations ─────────────────────────────────────────────── */
/* The reactions form their own row INSIDE the bubble, the way a reaction strip
 * sits at the foot of a card.
 *
 * This is the fourth approach, and the first one the layout actually supports
 * without a trick. The bubble reports display: block and padding: 10px 16px,
 * so appending the row puts it on its own line under the message with no
 * positioning needed — the row inherits the bubble's content box and its
 * horizontal padding lines the pills up with the text. Absolute positioning
 * becomes the wrong tool: bottom: -(half the row) put a glyph on the border,
 * which is what the user rejected.
 *
 * The pills match the shipped pill primitive (Pill.module.css) value for value:
 * 24px tall, fully rounded, 4px gap, 8px horizontal padding, bg-layer-2 fill,
 * 12px text. Copying the numbers rather than rendering the React component is
 * deliberate: this row is decoration inside a node the plugin owns imperatively
 * (it is aria-hidden and has no interaction), and mounting a React root per
 * message would add lifecycle risk for no visual gain — the tokens are the same,
 * so the theme behaves identically. */
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
  /* A raised pill in BOTH themes, from one surface token plus the theme's own
   * separator weight as a stroke.
   *
   * The fill is bg-layer-1, the topmost surface layer: #ffffff in the light theme,
   * which is what a reaction pill on a pale blue bubble should look like, and
   * #232324 in the dark one, which is DARKER than its #353638 bubble and so gives
   * the pill an edge there.
   *
   * Two earlier attempts are worth recording, because both looked right on paper:
   * the resting bg-layer-2 measured 1.15 against the dark bubble and simply
   * vanished; and interactive-bg-active — a translucent wash — made the LIGHT pill
   * a translucent grey-blue instead of white, which is the opposite of the intent.
   * A wash cannot produce "white" in the light theme; only a surface token can.
   *
   * The stroke is border-l2, the same weight the chat uses for its own separators
   * (#0000001a light, #ffffff1f dark). A fixed colour fails here: the primitive's
   * button-ghost-active-border resolves to #979da6 in the light theme, a solid
   * mid-grey that turned a 24px pill into a heavy outlined box. */
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16));
  animation: ec-chip-in 220ms ease-out;
}
@keyframes ec-chip-in {
  from { opacity: 0; transform: translateY(3px) scale(0.9); }
  to { opacity: 1; transform: none; }
}
[data-emote-sticker] { display: block; max-width: 100%; margin: 6px 0; }
/* The image is parked in the element that also holds the bubble, so the chat's own
 * alignment applies: for a user message that element is display: flex with
 * align-items: flex-end, which puts the sticker on the same side as the message
 * without any positioning of ours. The auto margin is the fallback for a host where
 * the image lands in a block-level box — it is inert inside a flex container, and it
 * is what keeps a right-side sticker on the right otherwise. */
[data-emote-sticker][data-side='right'] { margin-left: auto; text-align: right; }
[data-emote-sticker] img {
  display: block; max-width: min(320px, 100%); max-height: 240px; width: auto; height: auto;
  border-radius: var(--dsw-radius-md, 8px); background: transparent;
}
[data-emote-sticker][data-side='right'] img { margin-left: auto; }
[data-emote-sticker] figcaption {
  margin-top: 2px; font-size: 11px; line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #8c8c8c);
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
.ec-hidden-token { display: none !important; }
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
  .ec-rain > span { animation-duration: 1.5s !important; }
  .ec-chip { animation: none; }
}`;

    /** Insert this plugin's stylesheet once; the disposer removes it on unload. */
    function installStyles() {
      const existing = document.querySelector('style[data-plugin-css="dsh-plugin-emote-chat"]');
      if (existing !== null) return () => {};
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin-emote-chat";
      tag.dataset.pluginCss = "dsh-plugin-emote-chat";
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }

    // ─────────────────────────────── dictionary ──────────────────────────────

    const zh = {
      "section.nav": "贴纸互动",
      "section.stickerReply.label": "启用贴纸/表情包回复",
      "section.stickerReply.hint": "开启后输入框左下角出现贴纸按钮，Agent 也可以回复表情包。",
      "section.paths.label": "表情包/贴纸读取路径",
      "section.paths.hint": "每个目录是一个表情包，目录名就是包名；子目录会成为子包。支持 png、jpg、gif、webp、svg。",
      "section.paths.placeholder": "D:\\stickers\\cats",
      "section.paths.add": "添加目录",
      "section.paths.remove": "移除这一行",
      "section.emojiReply.label": "启用 emoji 回复",
      "section.emojiReply.hint": "开启后 Agent 会用 emoji 回应你的消息；emoji 显示在消息下方，不进入聊天历史。",
      "section.emojiRain.label": "启用 emoji 雨",
      "section.emojiRain.hint": "开启后 Agent 的 emoji 回应会以 emoji 雨的形式飘落整个界面。",
      "section.save": "保存",
      "section.saveFailed": "保存失败：{message}",
      "section.loadFailed": "无法读取设置：{message}",
      "section.scan": "重新扫描",
      "section.scanned": "已找到 {packs} 个表情包、{stickers} 张图片。",
      "section.scanEmpty": "没有找到图片，请检查路径是否存在。",
      "section.scanError": "以下路径不可用：{paths}",
      "section.unavailable": "当前部署没有可写的设置存储，修改只在本进程内生效。",
      "section.loading": "加载中…",
      "picker.open": "发送贴纸/表情包",
      "picker.title": "贴纸",
      "picker.close": "关闭",
      "picker.empty": "还没有可用表情包。请到「设置 → 贴纸互动」里填写表情包路径。",
      "picker.failed": "无法读取表情包目录：{message}",
      "picker.loading": "加载中…",
      "sticker.alt": "贴纸 {name}",
      "sticker.label": "贴纸",
      "reaction.title": "emoji 回应",
      "section.store.label": "emoji 回应存储",
      "section.store.hint": "回应保存在本地文件里，因此重启后仍在原位。存储上限 {limit} 条，超出后最旧的自动丢弃 —— 不需要你判断哪条已失效。",
      "section.store.clear": "清空全部回应",
      "section.store.cleared": "已清空 {removed} 条。",
      "section.store.clearFailed": "清空失败：{message}",
      "section.store.busy": "处理中…",
    };

    const en = {
      "section.nav": "Stickers & emoji",
      "section.stickerReply.label": "Enable sticker / meme replies",
      "section.stickerReply.hint": "Adds a sticker button at the composer's left edge and lets the Agent reply with stickers.",
      "section.paths.label": "Sticker folders",
      "section.paths.hint": "Each directory is one pack and its folder name is the pack name; nested folders become sub-packs. PNG, JPG, GIF, WebP, and SVG are supported.",
      "section.paths.placeholder": "D:\\stickers\\cats",
      "section.paths.add": "Add folder",
      "section.paths.remove": "Remove this row",
      "section.emojiReply.label": "Enable emoji replies",
      "section.emojiReply.hint": "The Agent reacts to your messages with one emoji, shown under the message instead of entering the chat history.",
      "section.emojiRain.label": "Enable emoji rain",
      "section.emojiRain.hint": "Draws the Agent's emoji reply as an emoji rain across the conversation.",
      "section.save": "Save",
      "section.saveFailed": "Could not save: {message}",
      "section.loadFailed": "Could not read the settings: {message}",
      "section.scan": "Rescan",
      "section.scanned": "Found {packs} packs with {stickers} images.",
      "section.scanEmpty": "No images found — check that the folders exist.",
      "section.scanError": "Unusable paths: {paths}",
      "section.unavailable": "This deployment cannot persist settings; changes apply to this process only.",
      "section.loading": "Loading…",
      "picker.open": "Send a sticker",
      "picker.title": "Stickers",
      "picker.close": "Close",
      "picker.empty": "No stickers yet. Add sticker folders in Settings → Stickers & emoji.",
      "picker.failed": "Could not read the sticker folders: {message}",
      "picker.loading": "Loading…",
      "sticker.alt": "Sticker {name}",
      "sticker.label": "Sticker",
      "reaction.title": "Emoji reaction",
      "section.store.label": "Reaction storage",
      "section.store.hint": "Reactions are kept in a local file, which is why they survive a restart. The store holds at most {limit} of them; past that the oldest are dropped — nothing here asks you to judge which reaction is stale.",
      "section.store.clear": "Clear all reactions",
      "section.store.cleared": "Cleared {removed}.",
      "section.store.clearFailed": "Could not clear: {message}",
      "section.store.busy": "Working…",
    };

    // ──────────────────────────────── helpers ───────────────────────────────

    /** One observable snapshot store: get/set/subscribe over a value. */
    function createStore(initial) {
      let value = initial;
      const listeners = new Set();
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
        },
      };
    }

    /** Merge a partial patch into a store's record value. */
    function patchStore(store, patch) {
      store.set({ ...store.get(), ...patch });
    }

    /** The useStore hook for one store. */
    function useStore(store) {
      return React.useSyncExternalStore(
        (listener) => store.subscribe(listener),
        () => store.get(),
        () => store.get(),
      );
    }

    /** Split a textarea-style value into trimmed, non-empty lines. */
    function splitLines(text) {
      return String(text ?? "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== "");
    }

    /** GET one JSON route; every failure surfaces as a message. */
    async function getJson(url, signal) {
      const response = await fetch(url, { signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status) + " " + response.statusText);
      return await response.json();
    }

    // ──────────────────────────── sticker helpers ────────────────────────────

    /** The URL of one sticker's bytes. */
    function stickerUrl(id) {
      return API + "/sticker?id=" + encodeURIComponent(id);
    }

    /**
     * Find one sticker by its wire id.
     *
     * The id is matched outright, because a pack built from sub-directories is
     * named "base/sub" and its ids are "base/sub/name". Splitting such an id on
     * the first slash asked for pack "base" with sticker "sub/name", which never
     * matched — so a sticker in a nested pack stayed on screen as raw token text
     * even though the catalog listed it. The pack/name split stays as a fallback
     * for ids written by hand against a flat pack.
     *
     * @param catalog - the live catalog.
     * @param id - the token's id text.
     * @returns the sticker entry, or undefined.
     */
    function findSticker(catalog, id) {
      const wanted = String(id ?? "").trim();
      if (wanted === "") return undefined;
      const packs = catalog?.packs ?? [];
      for (const pack of packs) {
        const hit = (pack.stickers ?? []).find((sticker) => sticker.id === wanted);
        if (hit !== undefined) return hit;
      }
      const at = wanted.indexOf("/");
      if (at <= 0 || at === wanted.length - 1) return undefined;
      const packId = wanted.slice(0, at);
      const name = wanted.slice(at + 1);
      const pack = packs.find((candidate) => candidate.id === packId || candidate.name === packId);
      return pack?.stickers?.find((candidate) => candidate.name === name);
    }

    /** Split a text into plain segments and sticker-token ids. */
    function splitTokens(text) {
      const segments = [];
      let index = 0;
      for (;;) {
        const start = text.indexOf(TOKEN_OPEN, index);
        if (start === -1) break;
        const end = text.indexOf(TOKEN_CLOSE, start + TOKEN_OPEN.length);
        if (end === -1) break;
        const id = text.slice(start + TOKEN_OPEN.length, end).trim();
        if (id === "") {
          index = start + TOKEN_OPEN.length;
          continue;
        }
        if (start > index) segments.push({ text: text.slice(index, start) });
        segments.push({ token: id });
        index = end + TOKEN_CLOSE.length;
      }
      if (index < text.length) segments.push({ text: text.slice(index) });
      return segments;
    }

    // ──────────────────────────── reaction feed ─────────────────────────────

    /**
     * Long-poll the reactions recorded since the last poll.
     *
     * The Host keeps one process-wide pool rather than a log per session, because
     * a reaction belongs to a message: its `messageKey` names the message, and
     * that is what a chip is matched by. The session parameter is therefore only a
     * wake-up hint, and a reaction recorded under one session reaches a browser
     * displaying another.
     */
    function createReactionFeed(sessionId) {
      const store = createStore({ entries: [], status: "connecting" });
      let cursor = 0;
      let primed = false;
      let disposed = false;
      let controller = null;
      const seen = new Set();

      const pump = async () => {
        while (!disposed) {
          controller = new AbortController();
          try {
            const payload = await getJson(
              API + "/reactions?session=" + encodeURIComponent(sessionId) + "&since=" + String(cursor) + "&wait=1",
              controller.signal,
            );
            if (disposed) return;
            const incoming = Array.isArray(payload.reactions) ? payload.reactions : [];
            const live = primed;
            const accepted = [];
            for (const entry of incoming) {
              if (typeof entry?.seq !== "number" || seen.has(entry.seq)) continue;
              seen.add(entry.seq);
              accepted.push({ ...entry, live });
            }
            store.set({
              entries: accepted.length === 0 ? store.get().entries : [...store.get().entries, ...accepted],
              status: "ready",
            });
            primed = true;
            if (typeof payload.seq === "number" && payload.seq > cursor) cursor = payload.seq;
          } catch (error) {
            if (disposed || error?.name === "AbortError") return;
            store.set({ ...store.get(), status: "error" });
            await new Promise((settle) => setTimeout(settle, 2500));
          }
        }
      };
      void pump();

      return {
        store,
        dispose: () => {
          disposed = true;
          controller?.abort();
        },
      };
    }

    // ─────────────────────────────── painting ───────────────────────────────

    /**
     * The side a sticker belongs on: the right for what the user sent, the left for
     * everything the Agent said.
     *
     * The kind is read from the message element, which is passed in directly rather
     * than found through `closest`. `closest` only walks ANCESTORS, and the kind
     * attribute sits on the message element itself, so asking a text node's ancestor
     * chain for it always answered "no flow row" and every sticker was placed on the
     * left — a user's own sticker came out on the wrong side of the conversation.
     * The ancestor walk is kept as a fallback for a body rendered outside its flow row.
     *
     * @param element - the text carrier the token was found in.
     * @param flow - the message element the carrier belongs to, when known.
     * @returns "right" or "left".
     */
    function sideOf(element, flow) {
      const owner =
        flow ??
        element?.closest?.("[data-chat-flow-kind]") ??
        element?.parentElement?.closest?.("[data-chat-flow-kind]") ??
        null;
      const kind = owner?.getAttribute?.("data-chat-flow-kind") ?? null;
      return kind === "user" || kind === "steering" ? "right" : "left";
    }

    /**
     * The row a message belongs to, which is where a sticker image is hoisted.
     *
     * Two markers are accepted because the harness has used both: `data-chat-flow`
     * in older builds and `data-chat-flow-key` from 0.1.2 on. Recognising only one
     * means the walker finds no message at all on the other build and nothing ever
     * renders. `data-time-hover-root` is the row wrapper the chat puts around a
     * message, and it is preferred when present because it survives a bubble
     * re-render.
     *
     * @param element - any element inside the message.
     * @returns the row element, or null.
     */
    function rowOf(element) {
      return element?.closest?.("[data-time-hover-root], [data-chat-flow-kind], [data-chat-flow-key]") ?? null;
    }

    /**
     * The text of an element with this plugin's ghost spans left out.
     *
     * The ghost holds the original token so `textContent` stays byte-identical, which
     * means asking "is this element now empty?" with `textContent` always answers no.
     * Deciding whether to hide a wrapper needs the real text.
     *
     * @param element - the element to read.
     * @returns its text, excluding hidden tags of ours.
     */
    function textWithoutGhosts(element) {
      let out = "";
      for (const child of element.childNodes ?? []) {
        if (child.nodeType === 3) {
          out += child.nodeValue ?? "";
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child.getAttribute?.("data-emote-hidden") !== null && child.getAttribute?.("data-emote-hidden") !== undefined) continue;
        out += textWithoutGhosts(child);
      }
      return out;
    }

    /** Whether a node is one of this plugin's hidden tags. */
    function isGhost(node) {
      return node?.nodeType === 1 && node.getAttribute?.("data-emote-hidden") != null;
    }

    /**
     * Drop leading and trailing whitespace from the visible text of a container.
     *
     * Only the whitespace that opens or closes the visible run is removed, and only
     * from text nodes: the hidden tags keep the original message intact, so
     * `textContent` is unaffected either way. This exists because a sticker is sent on
     * its own line and the line break that follows it would otherwise render as a blank
     * line above the user's sentence.
     *
     * @param container - the element whose text was just rebuilt.
     */
    function trimOuterWhitespace(container) {
      const children = container.childNodes ?? [];
      // Leading: only the line break a token left behind, which is what rendered as a
      // blank first line. A plain space is meaningful — `here you go [[sticker:x]]`
      // has one before the tag — so spaces are left alone.
      for (const child of children) {
        if (isGhost(child)) continue;
        if (child.nodeType !== 3) break;
        child.nodeValue = (child.nodeValue ?? "").replace(/^[\r\n]+/u, "");
        break;
      }
      // Trailing.
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (isGhost(child)) continue;
        if (child.nodeType !== 3) break;
        child.nodeValue = (child.nodeValue ?? "").replace(/[\r\n]+$/u, "");
        break;
      }
    }

    /**
     * Where a sticker image is parked once it is lifted out of the text: the element
     * that also holds the message bubble, when one can be found.
     *
     * That element is the message's alignment context. The chat right-aligns what the
     * user sent with `align-items: flex-end` on it, so an image placed there follows the
     * message to the correct side without any positioning of our own. The flow row is
     * the fallback: it is `display: block`, which cannot align anything, so it only
     * gives a sane home when the bubble's wrapper is not recognisable.
     *
     * @param inside - the element the token's text lived in.
     * @param row - the message's flow row.
     * @returns the element to prepend the image to.
     */
    function stickerAnchor(inside, row) {
      let element = inside;
      while (element !== null && element !== row) {
        if (findClassFragment(element, "userstack") !== null || findClassFragment(element, "bubble") !== null) {
          return element;
        }
        element = element.parentElement;
      }
      const bubble = inside?.closest?.("[class*='bubble']") ?? null;
      if (bubble?.parentElement != null) return bubble.parentElement;
      return row;
    }

    /** Build the sticker figure for one token. */
    function buildSticker(id, t) {
      const figure = document.createElement("figure");
      figure.setAttribute("data-emote-sticker", id);
      const image = document.createElement("img");
      image.src = stickerUrl(id);
      image.alt = t("sticker.alt", { name: id });
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => figure.setAttribute("data-failed", "1"));
      // No caption carrying the tag.
      //
      // It used to render `Sticker · [[sticker:pack/name]]` under the image, which is
      // useful for a screenshot but wrong here: the caption's text counts toward
      // textContent, and the figure is hoisted out of the paragraph, so the tag ended
      // up in the document TWICE and the message no longer matched what the user sent —
      // the exact condition that makes the chat rewrite the DOM and drop the image. The
      // tag still lives in the hidden ghost, which is where it has to be for the text to
      // stay faithful; `alt` carries it for anyone who needs to read it.
      figure.append(image);
      return figure;
    }

    /**
     * Paint sticker tokens inside the conversation.
     *
     * The token stays in the transcript — the Host logged it, the model wrote it, and
     * nothing here rewrites the message on the wire — only its rendering changes.
     *
     * The rule that makes the rendering survive: **the bubble's textContent must stay
     * byte-identical.** Replacing a token with an image changes it, and any surface
     * that compares textContent to decide "this message was modified" then rewrites
     * the DOM — which reverts the image to text, gets decorated again, and either
     * flickers or disappears for good. Four earlier versions of this function looked
     * for a "safe" element to insert into and all failed that way. The fix is not a
     * better position; it is to keep the text identical: every image is accompanied by
     * a hidden ghost span holding the original token, so anyone comparing textContent
     * sees exactly what they wrote.
     *
     * The rest follows from the same idea: the image is hoisted to the start of the
     * message row so one sticker renders the same wherever the token sat, a wrapper
     * left with no visible text is hidden (ghosts do not count as text), and images
     * are deduped by row and sticker id on every pass so a double decoration from a
     * streaming re-render collapses to one.
     *
     * @param options - the live catalog, the translator, and whether stickers are on.
     */
    function createStickerPainter({ getCatalog, t, isEnabled }) {
      /**
       * The hidden tags this painter has placed, and whether a pass changed anything.
       *
       * There is deliberately no map from a row to its images. React rebuilds rows, so
       * a table keyed by row element goes stale without notice: the lookup fails, the
       * image is never put back, and the sticker "mysteriously" disappears while the
       * conversation is used. The decoration records itself IN the DOM instead — every
       * ghost carries the id of the image it stands for — so a pass can ask the document
       * whether that image is still there, for every token it ever placed, with no
       * remembered state to invalidate. The state lives where the message lives.
       */
      const ghosts = new Set();
      /** Whether the current pass placed or restored anything. */
      let placedInThisPass = false;

      /**
       * The hidden span that keeps the original token inside the text.
       *
       * It exists only so `textContent` stays what the user sent. It must therefore be
       * invisible to LAYOUT as well as to the eye, which `display: none` alone does not
       * guarantee: an inline element in the middle of a text run still takes part in
       * line-box construction on some selection paths, and the bubble visibly broke
       * open below the text when a reaction chip inside it was selected. Taking it out
       * of the flow entirely costs nothing, because nothing about it is ever meant to
       * occupy space.
       *
       * @param raw - the original token text, kept verbatim.
       * @param stickerId - the sticker it stands for, so its image can be found later.
       */
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
        ghosts.add(ghost);
        return ghost;
      };

      /**
       * Make sure every placed token still has its image, and that no row shows the
       * same sticker twice.
       *
       * Both halves read the DOM instead of a side table, which is what makes them
       * survive a rebuilt row. A ghost whose tag has no image — because the chat rewrote
       * the bubble over it — gets one again, which is the case that used to leave the
       * sticker gone for good. Duplicates are dropped, keeping the first, because a
       * streaming re-render can decorate the same token twice; with no duplicates this
       * does nothing, so it runs after every pass.
       */
      const reconcile = () => {
        for (const ghost of [...ghosts]) {
          // The ghost itself is gone: the row was rebuilt from the transcript, and the
          // next pass will decorate the token again from the text.
          if (ghost.parentElement === null) {
            ghosts.delete(ghost);
            continue;
          }
          const id = ghost.getAttribute("data-emote-token");
          if (id === null || id === "") continue;
          const row = rowOf(ghost);
          if (row === null) continue;
          const figures = [...row.querySelectorAll("[data-emote-sticker]")].filter(
            (figure) => figure.getAttribute("data-emote-sticker") === id,
          );
          // One is expected. None means the image was reclaimed; more than one means a
          // double decoration. Either way, leave exactly one behind.
          if (figures.length === 1) continue;
          for (const extra of figures.slice(1)) extra.remove();
          if (figures.length >= 1) {
            placedInThisPass = true;
            continue;
          }
          const figure = buildSticker(id, t);
          figure.setAttribute("data-side", sideOf(ghost, row));
          const anchor = stickerAnchor(ghost.parentElement ?? row, row);
          anchor.insertBefore(figure, anchor.firstChild);
          placedInThisPass = true;
        }
      };

      const scan = () => {
        if (!isEnabled()) return;
        const catalog = getCatalog();
        if (catalog === undefined) return;
        placedInThisPass = false;

        const roots = document.querySelectorAll("[data-chat-flow-kind]");
        for (const root of roots) {
          if (!MESSAGE_FLOW_KINDS.has(root.getAttribute("data-chat-flow-kind") ?? "")) continue;
          const row = rowOf(root) ?? root;
          // A wrapper may already be decorated; the token is in a ghost then, and the
          // walk below skips ghosts, so there is nothing to redo.
          const carriers = [];
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode()) !== null) {
            const parent = node.parentElement;
            if (parent === null) continue;
            // Our own marker sits in a hidden span; decorating it would decorate the
            // ghost and the token would render as an image twice.
            if (parent.closest("[data-emote-hidden]") !== null) continue;
            if (parent.closest("[data-emote-sticker]") !== null) continue;
            // Only message bodies carry stickers: reasoning, the process rows, code
            // blocks and tool cards may mention the token while discussing it.
            if (parent.closest("pre, code") !== null) continue;
            if (parent.closest(NON_MESSAGE_REGIONS) !== null) continue;
            const value = node.nodeValue ?? "";
            if (value.indexOf(TOKEN_OPEN) === -1) continue;
            if (splitTokens(value).every((segment) => segment.token === undefined)) continue;
            carriers.push(node);
          }

          for (const carrier of carriers) {
            const segments = splitTokens(carrier.nodeValue ?? "");
            const placeable = segments.filter(
              (segment) => segment.token !== undefined && findSticker(catalog, segment.token) !== undefined,
            );
            if (placeable.length === 0) continue;
            const parent = carrier.parentElement;
            if (parent === null) continue;
            const side = sideOf(carrier, root);
            // Rebuild the text node as: prose, ghost (the original token), prose, and the
            // images listed separately for hoisting. The fragment replaces the one text
            // node, which leaves textContent identical while changing what is drawn.
            //
            // The ghost stays in the TEXT, not inside the figure: the figure is hoisted
            // out of the paragraph and it carries a caption that also contains the tag,
            // so a ghost riding along with it would put the token in the document twice
            // and textContent would no longer match what the user sent.
            const fragment = document.createDocumentFragment();
            const figures = [];
            for (const segment of segments) {
              if (segment.token === undefined) {
                if (segment.text === "") continue;
                // Text directly after a token lost the whitespace that separated it: a
                // sticker is normally sent on its own line, so the message is
                // `[[sticker:x]]\nand then this`, and that newline would render as a
                // blank first line. The ghost keeps textContent intact, so only the
                // VISIBLE run is trimmed.
                const previous = fragment.childNodes[fragment.childNodes.length - 1];
                const followsGhost = previous !== undefined && previous.getAttribute?.("data-emote-hidden") != null;
                fragment.appendChild(
                  document.createTextNode(followsGhost ? segment.text.replace(/^[\s\u00a0]+/u, "") : segment.text),
                );
                continue;
              }
              const raw = TOKEN_OPEN + segment.token + TOKEN_CLOSE;
              if (findSticker(catalog, segment.token) === undefined) {
                // Unresolvable: keep the tag visible as ordinary text. Hiding it would
                // delete the user's words with nothing put in their place.
                fragment.appendChild(document.createTextNode(raw));
                continue;
              }
              fragment.appendChild(ghostFor(raw, segment.token));
              const figure = buildSticker(segment.token, t);
              figure.setAttribute("data-side", side);
              figures.push(figure);
            }
            parent.replaceChild(fragment, carrier);
            if (figures.length === 0) continue;
            // Trim the container's outer whitespace once the swap is done.
            //
            // A sticker is sent on its own line, so the message is
            // `[[sticker:x]]\nand then this`, and that newline used to render as a blank
            // first line in the bubble. Trimming the segment that follows the token
            // covers the usual case but not all of them: the chat is free to hand the
            // token and the remainder over as separate text nodes, and then the
            // whitespace belongs to neither segment and survives. Normalising the
            // container afterwards is independent of how the text was split.
            trimOuterWhitespace(parent);

            // Hoist every image out of the text, so a sticker renders in the same place
            // whatever position the token had.
            //
            // Where it lands decides its alignment. The chat aligns a user's own
            // message with `align-items: flex-end` on the stack that holds the bubble, so
            // the image has to join THAT element to sit on the same side; putting it at
            // the start of the flow row instead lands it in a `display: block` box with
            // no alignment at all, where `margin-left: auto` does nothing and every
            // sticker ends up on the left. Measured live: the row reports `block`, the
            // stack reports `flex` + `flex-end`.
            const anchor = stickerAnchor(parent, row);
            for (const figure of figures) {
              anchor.insertBefore(figure, anchor.firstChild);
            }
            placedInThisPass = true;

            // Hide wrappers this left with no visible text. textContent cannot answer
            // that — the ghost carries the token — so the ghosts are excluded.
            let element = parent;
            while (element !== null && element !== row) {
              if (textWithoutGhosts(element).trim() === "") element.style.display = "none";
              element = element.parentElement;
            }
          }
        }
        reconcile();
      };

      return {
        hasWork: () => placedInThisPass,
        scan,
        dispose: () => {
          for (const figure of document.querySelectorAll("[data-emote-sticker]")) figure.remove();
          for (const ghost of document.querySelectorAll("[data-emote-hidden]")) ghost.remove();
          ghosts.clear();
          for (const ghost of document.querySelectorAll("[data-emote-hidden]")) ghost.remove();
        },
      };
    }

    /**
     * Find one descendant whose class name contains a fragment.
     *
     * The chat's class names are CSS-module hashes whose shape differs per build
     * ("cJsG2q_bubble" in the desktop bundle, "_bubble_abc123" in others), so
     * matching a fragment is the only portable option.
     */
    function findClassFragment(root, fragment) {
      for (const node of root.querySelectorAll("div")) {
        if (typeof node.className === "string" && node.className.toLowerCase().includes(fragment)) return node;
      }
      return null;
    }

    /**
     * The container a reaction row belongs to: the user's own bubble.
     *
     * The row is a strip at the FOOT of the message, inside the bubble, which is
     * what the bubble's own layout supports: it reports `display: block` with
     * `padding: 10px 16px`, so appending the row gives it its own line under the
     * text, aligned with it, with no positioning needed.
     *
     * An earlier version appended to the bubble's parent and positioned the row
     * absolutely to straddle the bubble's edge. That put a glyph on the border,
     * which read as a smudge rather than a reaction, and it needed a
     * `position: relative` written onto a chat-owned element to anchor at all.
     *
     * @param flow - one `[data-chat-flow-kind="user"]` element.
     * @returns the element to append the reaction row to.
     */
    function reactionHost(flow) {
      const bubble = findClassFragment(flow, "bubble");
      if (bubble !== null) return bubble;
      const stack = findClassFragment(flow, "userstack");
      if (stack !== null) return stack;
      const row = findClassFragment(flow, "userrow");
      if (row !== null) return row;
      return flow.firstElementChild ?? flow;
    }

    /**
     * The message id inside a chat node key.
     *
     * The key is `<seq>:input-message<id>`, where the id is the `user/message`
     * event's own id — verified against the desktop build's ui-chat client. A
     * reaction restored from the Host's store carries only that id, so this is how
     * a chip finds its message after a restart; it also keeps matching when a key
     * is replaced, which is what happens to a queued message when it is submitted.
     *
     * Idempotent: a bare id has no marker to strip and is returned unchanged. The
     * first version sliced from the marker unconditionally, which silently mangled
     * an id that already was one and matched nothing.
     *
     * @param key - a chat node key, or a bare id.
     * @returns the message id.
     */
    function messageIdOf(key) {
      const text = String(key ?? "");
      const at = text.indexOf(MESSAGE_ID_MARKER);
      return at === -1 ? text : text.slice(at + MESSAGE_ID_MARKER.length);
    }

    /** Does this row belong to this reaction's message? */
    function rowMatches(row, entry) {
      const nodeKey = row.getAttribute("data-chat-node-key");
      if (nodeKey !== null) {
        if (entry.messageKey !== undefined && entry.messageKey === nodeKey) return true;
        if (entry.messageId !== undefined && messageIdOf(nodeKey) === entry.messageId) return true;
      }
      return false;
    }


    /**
     * Tell the Host which message a coming reaction belongs to.
     *
     * The browser is the side that knows which message awaited a reaction when the
     * model started, so it registers the newest user message as this session's
     * anchor. A reaction is then stamped with that key — unless the Agent declares
     * a target, which wins, and which is the only way to name a message that never
     * becomes a chat node (a message the user sent while the Agent was working).
     *
     * Failures are silent on purpose: a missing anchor only costs precision, and
     * the declaration path does not depend on it.
     *
     * @param sessionId - the visible session.
     * @param anchor - the chat node key of the newest user message.
     */
    async function registerAnchor(sessionId, anchor) {
      try {
        await fetch(API + "/anchor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, anchor }),
        });
      } catch {
        /* offline or unloading; a declared target still resolves */
      }
    }

    /** The last message list handed to the Host, so an unchanged one is not resent. */
    let lastReported;

    /**
     * Report which user messages the browser currently has loaded.
     *
     * Reporting only — it never deletes anything, and the Host does not delete on
     * receipt either. An earlier version asked the Host to drop reactions whose
     * message was missing from this list, which destroyed real history: a long
     * conversation is paged, so this list is only the loaded window, and every
     * reaction older than it looked like an orphan.
     *
     * Sent when the list changes, so a Host-side diagnostic can always see the
     * window the browser is showing.
     */
    async function reportKnownMessages() {
      const keys = [];
      for (const row of document.querySelectorAll('[data-chat-flow-kind="user"]')) {
        const key = row.getAttribute("data-chat-node-key");
        if (key !== null) keys.push(key);
      }
      if (keys.length === 0) return;
      const signature = keys.join("|");
      if (signature === lastReported) return;
      lastReported = signature;
      try {
        await fetch(API + "/seen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keys }),
        });
      } catch {
        /* offline or unloading; reporting is advisory */
      }
    }

    /**
     * Assign each reaction to a user message, recomputed from scratch every pass.
     *
     * The rule is one line: **a reaction binds to the message its stamp names, and to
     * nothing else.** The stamp is the anchor the browser registered when the message
     * was sent, which is a message identity rather than a guess about ordering.
     *
     * There is deliberately no fallback to "the newest message" or to the reaction's
     * timestamp. Both were tried and both produced a wrong chip that looked right: the
     * newest message inherited earlier reactions, and a timestamp-based guess
     * mis-anchored whenever a message arrived while a reaction was in flight. An
     * absent chip is honest; a misplaced one is not.
     *
     * **Why this is recomputed rather than remembered.** An earlier version assigned
     * each reaction once, kept the row it picked, and advanced a cursor past it. That
     * cannot express "not yet": a long conversation is paged, so the row for an older
     * reaction is usually absent, and when the user scrolls back the row returns as a
     * NEW element — while the remembered one is detached and the cursor has already
     * gone past the entry. The reaction was therefore unplaceable forever, and the
     * chips silently disappeared as history scrolled out. Matching fresh each pass
     * compares message IDENTITIES, which survive a rebuilt row, so a chip reappears the
     * moment its message does.
     *
     * Pure, so the rule can be tested without a DOM.
     *
     * @param entries - the reactions to place, oldest first.
     * @param messages - the live user-message rows, in document order.
     * @returns the entries grouped by row.
     */
    function assignReactions(entries, messages) {
      const byMessage = new Map();
      for (const entry of entries) {
        if (entry?.seq === undefined) continue;
        if (entry.messageKey === undefined && entry.messageId === undefined) continue;
        // Matched by node key, or — for a reaction restored from the store, which keeps
        // only the id, and for one whose key was replaced — by that id.
        const row = messages.find((candidate) => rowMatches(candidate, entry));
        if (row === undefined) continue;
        const list = byMessage.get(row) ?? [];
        list.push(entry);
        byMessage.set(row, list);
      }
      return byMessage;
    }

    function createReactionPainter({ getEntries, t, onNewMessage }) {
      const rows = new Map();
      /** The last anchor handed to the Host, so it is registered only once. */
      let registered = null;

      const scan = () => {
        const messages = [...document.querySelectorAll('[data-chat-flow-kind="user"]')];
        if (messages.length === 0) return;
        const live = new Set(messages);
        // The anchor stays on the message that triggered this turn.
        //
        // A message the user sends while the Agent is working does NOT move it.
        // That is the declared contract, not an accident of the DOM: such a
        // message is an intervention in the running turn, so a reaction still
        // belongs to the message that started it, and the consequence is accepted
        // — the Agent cannot react to an intervention specifically.
        //
        // The two markers are the build's own: `data-pending-steering` on a
        // message still queued, `data-submission-echo` on the local echo of one
        // being submitted. Skipping them is what makes the rule explicit; a
        // message with neither marker is an ordinary one and may claim the anchor.
        const candidates = messages.filter(
          (row) => row.getAttribute("data-pending-steering") === null && row.getAttribute("data-submission-echo") === null,
        );
        const newest = candidates[candidates.length - 1];
        const anchor = newest?.getAttribute("data-chat-node-key") ?? null;
        if (anchor !== null && anchor !== registered) {
          registered = anchor;
          onNewMessage?.(anchor);
          // Keep the Host's view of the loaded window current. Reporting only: it
          // can never delete, so a message appearing mid-conversation is safe.
          void reportKnownMessages();
        }
        for (const [row, chips] of rows) {
          if (live.has(row)) continue;
          chips.remove();
          rows.delete(row);
        }
        const byMessage = assignReactions(getEntries(), messages);
        for (const [row, list] of byMessage) {
          const shown = list.slice(-MAX_CHIPS);
          let chips = rows.get(row);
          // React re-renders its own subtree, which can silently detach a chip row
          // we appended; the bookkeeping would then believe it is on screen and
          // never rebuild it. Recreate anything that lost its parent.
          if (chips !== undefined && !chips.isConnected) {
            chips = undefined;
            rows.delete(row);
          }
          if (chips === undefined) {
            chips = document.createElement("div");
            chips.className = "ec-chips";
            chips.setAttribute("data-emote-chips", "");
            // Outside the message's accessible text.
            //
            // The row is decoration the plugin owns, but it sits inside the message
            // element, so anything that reads that element as text — a screen
            // reader, a selection, an extraction — would report the emoji as part
            // of what the user said. `aria-hidden` removes it from that text
            // without removing it from the screen; each chip keeps a `title` so the
            // pointer still explains it.
            chips.setAttribute("aria-hidden", "true");
            reactionHost(row).append(chips);
            rows.set(row, chips);
          }
          const signature = shown.map((entry) => entry.seq).join(",");
          if (chips.getAttribute("data-si") === signature) continue;
          chips.setAttribute("data-si", signature);
          chips.replaceChildren(
            ...shown.map((entry) => {
              const chip = document.createElement("span");
              chip.className = "ec-chip";
              chip.textContent = entry.emoji;
              chip.title = new Date(entry.at ?? Date.now()).toLocaleTimeString();
              return chip;
            }),
          );
        }
      };

      return {
        scan,
        dispose: () => {
          for (const chips of rows.values()) chips.remove();
          rows.clear();
        },
      };
    }

    /**
     * Read emoji reactions straight out of the Agent's own replies.
     *
     * A fallback for a composition where the tool registry is out of reach: it
     * takes an emoji the Agent wrote on its own line (alone, or trailing its
     * reply) and turns it into the same chip the tool would have produced, then
     * hides that text from the rendered reply. It never rewrites the transcript.
     */
    function createReplyReactionReader({ t, isEnabled, emit }) {
      const seen = new Set();

      const scan = () => {
        if (!isEnabled()) return;
        const nodes = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]');
        for (const node of nodes) {
          const key = node.getAttribute("data-chat-node-key") ?? node.getAttribute("data-chat-flow-key");
          if (key === null || seen.has(key)) continue;
          const paragraphs = [...node.querySelectorAll("p")];
          const last = paragraphs[paragraphs.length - 1];
          if (last === undefined) continue;
          const text = (last.textContent ?? "").trim();
          if (text === "" || text.length > EMOJI_REPLY_MAX_CHARS) continue;
          const match = EMOJI_REPLY_PATTERN.exec(text);
          if (match === null) continue;
          const glyph = [...match[1]];
          if (glyph.length === 0 || glyph.length > 2) continue;
          const emoji = glyph.join("");
          // An emoji-only reply is fully replaced by the chip; a trailing one
          // keeps its prose and only loses the emoji itself.
          const stripped = text.slice(0, match.index).replace(/[\s\u00a0]+$/u, "");
          if (stripped === "") last.classList.add("ec-hidden-token");
          else last.textContent = stripped;
          seen.add(key);
          emit({ emoji, at: Date.now(), source: "reply" });
        }
      };

      return {
        scan,
        dispose: () => {
          for (const hidden of document.querySelectorAll(".ec-hidden-token")) hidden.classList.remove("ec-hidden-token");
          seen.clear();
        },
      };
    }

    /**
     * Whether one feed entry should start a rain burst.
     *
     * Pure so the gate can be tested without a browser, because getting it wrong
     * is invisible: the chip still appears, and only the rain is missing. It is
     * gated on the reaction's age rather than the feed's internal "live" flag,
     * which stays false until the first long poll returns — so after any page
     * load a reaction from seconds ago could never rain.
     *
     * @param entry - one reaction from the Host channel.
     * @param now - the current time.
     * @param seen - sequence numbers already rained.
     * @returns true when this entry should rain.
     */
    function shouldRain(entry, now, seen) {
      if (entry?.live !== true) return false;
      if (seen.has(entry.seq)) return false;
      return now - (entry.at ?? 0) <= RAIN_FRESH_MS;
    }

    /**
     * Every rain burst this page has played.
     *
     * Kept because "the rain did not appear" has several possible causes — the
     * setting, the reaction's age, a missing stylesheet, an emoji with no glyph —
     * and this separates them in one glance.
     */
    const rainLog = { bursts: 0, last: null, skipped: [] };

    /** Spawn one emoji-rain burst over the whole window. */
    function rain(emoji, count) {
      if (typeof document === "undefined") return undefined;
      rainLog.bursts += 1;
      rainLog.last = { emoji, count, at: Date.now() };
      const layer = document.createElement("div");
      layer.className = "ec-rain";
      layer.setAttribute("data-plugin", "dsh-plugin-emote-chat");
      layer.setAttribute("aria-hidden", "true");
      const glyphs = [...emoji];
      const set = glyphs.length > 0 ? glyphs : ["✨"];
      for (let index = 0; index < count; index += 1) {
        const span = document.createElement("span");
        span.textContent = set[index % set.length];
        span.style.left = (2 + Math.random() * 94).toFixed(2) + "%";
        span.style.fontSize = (18 + Math.random() * 26).toFixed(1) + "px";
        span.style.animationDuration = (3.4 + Math.random() * 2.4).toFixed(2) + "s";
        span.style.animationDelay = (Math.random() * 0.9).toFixed(2) + "s";
        span.style.setProperty("--ec-drift", (Math.random() * 90 - 45).toFixed(1) + "px");
        layer.append(span);
      }
      document.body.append(layer);
      // Generous relative to the longest run (6s) plus its start delay, so a slow
      // glyph is never cut off mid-fall.
      setTimeout(() => layer.remove(), 9000);
      return layer;
    }

    // ─────────────────────────────── components ──────────────────────────────

    /**
     * The sticker mark used by the composer button.
     *
     * Drawn to the shipped icon kit's contract rather than a bespoke one: a 16x16
     * viewBox, a single 1.3px stroke (ICON_MEDIUM_STROKE), no filled shapes, and
     * currentColor so it inherits the button's own colour state. The first version
     * was a 24-unit outline with solid dot eyes and three different stroke widths
     * — visibly a different hand from the icons beside it in the composer.
     *
     * The peeled corner is what makes it read as a *sticker* rather than a photo
     * or a chat bubble: a rounded square whose lower-right corner is folded.
     */
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
          strokeLinejoin: "round",
        },
        // The body, with the corner left open for the fold.
        h("path", { d: "M13 8.5V3.5C13 2.67157 12.3284 2 11.5 2H4.5C3.67157 2 3 2.67157 3 3.5V12.5C3 13.3284 3.67157 14 4.5 14H8.5" }),
        // The fold itself.
        h("path", { d: "M13 8.5H9.5C9.22386 8.5 9 8.72386 9 9V14" }),
        h("path", { d: "M13 8.5L9 14" }),
        // A face, so it also reads as an emoji surface.
        h("path", { d: "M5.9 6.6H5.91" }),
        h("path", { d: "M8.9 6.6H8.91" }),
        h("path", { d: "M5.9 8.9C6.2 9.3 6.6 9.5 7.1 9.5C7.6 9.5 8 9.3 8.3 8.9" }),
      );
    }

    /**
     * The shipped switch, with this page's call shape.
     *
     * The primitive is used as-is so the track, the thumb travel, the focus ring
     * and the disabled opacity are the panel's own; only the callback name differs.
     */
    function Switch({ checked, disabled, onToggle, label }) {
      return h(primitives.Switch, {
        checked,
        disabled: disabled === true,
        label,
        onChange: (next) => onToggle(next),
      });
    }

    /**
     * One settings row: title and description at the left, a control at the right.
     *
     * The markup and the numbers both come from the shipped Settings panel, so a
     * row here is indistinguishable from a built-in one. children renders as a
     * drawer that appears only when the row is on — the dependency the two
     * switches have on each other.
     */
    function Item({ title, description, control, children }) {
      const [id] = React.useState(() => "ec-item-" + Math.random().toString(36).slice(2, 9));
      return h(
        "div",
        { "data-item": "", ...(children === undefined ? {} : { "data-stacked": "true" }) },
        h(
          "div",
          { className: "ec-head-row" },
          h(
            "div",
            { className: "ec-head" },
            h("div", { className: "ec-title", id }, title),
            h("div", { className: "ec-desc", id: id + "-desc" }, description),
          ),
          control,
        ),
        children === undefined
          ? null
          : h(
              "div",
              { className: "ec-drawer", role: "group", "aria-labelledby": id, "aria-describedby": id + "-desc" },
              children,
            ),
      );
    }

    /** The shipped button; variant "primary" is the main action. */
    function Button({ children, onClick, disabled, variant }) {
      return h(
        primitives.Button,
        { variant: variant ?? "ghost", size: "md", disabled: disabled === true, onClick },
        children,
      );
    }

    // ────────────────────────── composer sticker picker ──────────────────────

    function StickerPicker({ inputActions, t, catalog }) {
      const snapshot = useStore(catalog.store);
      const [open, setOpen] = React.useState(false);
      const [packId, setPackId] = React.useState(null);
      const rootRef = React.useRef(null);
      const gridRef = React.useRef(null);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          // Arrow keys walk the grid; the trigger only opens it, so without this
          // the popup would be mouse-only. Focus is moved explicitly rather than by
          // DOM order because a grid wraps: Left/Right are neighbours, and Up/Down
          // step by a row within the same pack.
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
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
      const active = packs.find((pack) => pack.id === packId) ?? packs[0];
      const stickers = active?.stickers ?? [];

      const insert = (sticker) => {
        const token = TOKEN_OPEN + sticker.id + TOKEN_CLOSE;
        try {
          const span = inputActions?.captureInsertion?.();
          if (span !== undefined && typeof inputActions?.insertText === "function") {
            inputActions.insertText(token, span);
          } else if (typeof inputActions?.setDraft === "function") {
            inputActions.setDraft(token);
          }
        } catch {
          /* the composer refuses edits while it is submitting; nothing to do */
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
            },
          },
          h(StickerGlyph, null),
        ),
        open
          ? h(
              "div",
              { className: "ec-popover", role: "dialog", "aria-label": t("picker.title") },
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
                    onClick: () => setOpen(false),
                  },
                  h(primitives.IconCloseOutlineRegular, { size: 14 }),
                ),
              ),
              snapshot.status === "loading" && snapshot.data === undefined
                ? h("div", { className: "ec-note" }, t("picker.loading"))
                : snapshot.status === "error"
                  ? h("div", { className: "ec-note" }, t("picker.failed", { message: snapshot.error ?? "" }))
                  : packs.length === 0
                    ? h("div", { className: "ec-note" }, t("picker.empty"))
                    : [
                        h(
                          "div",
                          { className: "ec-packs", key: "packs" },
                          ...packs.map((pack) =>
                            h(
                              "button",
                              {
                                key: pack.id,
                                type: "button",
                                className: "ec-pack",
                                "aria-pressed": active?.id === pack.id ? "true" : "false",
                                onClick: () => setPackId(pack.id),
                              },
                              pack.name,
                            ),
                          ),
                        ),
                        h(
                          "div",
                          { className: "ec-grid", key: "grid", ref: gridRef },
                          ...stickers.map((sticker) =>
                            h(
                              "button",
                              {
                                key: sticker.id,
                                type: "button",
                                className: "ec-cell",
                                title: sticker.id,
                                "aria-label": t("sticker.alt", { name: sticker.id }),
                                onClick: () => insert(sticker),
                              },
                              h("img", { src: stickerUrl(sticker.id), alt: "", loading: "lazy" }),
                              h("span", null, sticker.name),
                            ),
                          ),
                        ),
                      ],
            )
          : null,
      );
    }

    // ──────────────────────────── settings section ───────────────────────────

    /**
     * The "Stickers & emoji" settings page.
     *
     * Structure and type follow the shipped Settings panel; the controls are the
     * shipped primitives. The path list is edited one line at a time rather than
     * in a textarea, because a directory that does not resolve is the one thing
     * this page has to report precisely: each line can then carry its own error
     * state and its own remove button, and the preview strip below shows what the
     * scan actually found instead of just counting it.
     */
    function SettingsSection({ t, config, context }) {
      const snapshot = useStore(config.store);
      const [linesDraft, setLinesDraft] = React.useState(null);
      /** A refused write. The only message this page ever shows proactively. */
      const [alert, setAlert] = React.useState(null);
      /** A maintenance action in flight, and its outcome. */
      const [busy, setBusy] = React.useState(false);
      const [maintenance, setMaintenance] = React.useState(null);


      // Mount tracing: a page that only re-renders stays at one mount.
      React.useEffect(() => {
        mountLog.mounts += 1;
        mountLog.events.push({ at: Date.now(), kind: "mount" });
        return () => {
          mountLog.unmounts += 1;
          mountLog.events.push({ at: Date.now(), kind: "unmount" });
        };
      }, []);

      React.useEffect(() => {
        void config.load();
      }, [config]);

      const data = snapshot.data;
      const settings = {
        stickerReply: data?.stickerReply === true,
        emojiReply: data?.emojiReply === true,
        emojiRain: data?.emojiRain === true,
      };
      const saved = Array.isArray(data?.paths) ? data.paths : [];
      // An empty list still offers one row to fill in: a drawer whose only
      // content is an "add" button gives the user nothing to type into, and an
      // empty input is never written back (commit trims blank lines).
      const lines = linesDraft ?? (saved.length === 0 ? [""] : saved);

      /** Write the whole live field set in one mutation. */
      const commit = async (next) => {
        const result = await context.update({
          stickerReply: next.stickerReply,
          paths: next.stickerReply ? splitLines((next.lines ?? []).join("\n")) : [],
          emojiReply: next.emojiReply,
          emojiRain: next.emojiReply ? next.emojiRain : false,
        });
        if (!result.ok) {
          // A failed write is the one thing the user must hear about, because the
          // switch they flipped will snap back on the next snapshot. A successful
          // write says nothing: the shipped panel gives no save confirmation
          // either, and the control's own state is the feedback.
          setAlert(t("section.saveFailed", { message: result.message ?? "" }));
          return false;
        }
        setAlert(null);
        setLinesDraft(null);
        await config.load();
        return true;
      };

      /**
       * Empty the stored reactions.
       *
       * The only maintenance action left, and deliberately the only one: it needs
       * no judgement about which entry is stale, so it cannot be wrong. A "clean up
       * the unmatched ones" action was removed — deciding that a message no longer
       * exists is indistinguishable, from the Host, from a message that merely is
       * not loaded, and that ambiguity once deleted real history. Growth is handled
       * by the store's own size bound instead.
       */
      const clearAll = async () => {
        if (busy) return;
        setBusy(true);
        try {
          const response = await fetch(API + "/clean", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "all" }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload?.ok !== true) {
            setMaintenance({
              tone: "error",
              text: t("section.store.clearFailed", { message: payload?.message ?? String(response.status) }),
            });
            return;
          }
          setMaintenance({ tone: "info", text: t("section.store.cleared", { removed: payload.removed }) });
        } catch (error) {
          setMaintenance({
            tone: "error",
            text: t("section.store.clearFailed", { message: String(error?.message ?? error) }),
          });
        } finally {
          setBusy(false);
        }
      };

      const packs = data?.packs ?? [];
      const errors = data?.errors ?? [];
      const stickerCount = packs.reduce((total, pack) => total + (pack.stickers?.length ?? 0), 0);
      const broken = new Set(errors.map((entry) => entry.path));
      const scanNote =
        packs.length === 0
          ? t("section.scanEmpty")
          : t("section.scanned", { packs: packs.length, stickers: stickerCount });

      if (data === undefined && snapshot.status !== "error") {
        return h("div", { className: "ec-page" }, h("p", { className: "ec-note-line" }, t("section.loading")));
      }

      /** One editable directory line, flagged when the scan could not read it. */
      const pathLine = (value, index) =>
        h(
          "div",
          { className: "ec-path-row", key: "path-" + String(index) },
          h("input", {
            type: "text",
            spellCheck: false,
            value,
            "data-missing": broken.has(value) ? "true" : undefined,
            placeholder: t("section.paths.placeholder"),
            "aria-label": t("section.paths.label"),
            "aria-invalid": broken.has(value) ? "true" : undefined,
            onChange: (event) => {
              const next = [...lines];
              next[index] = event.target.value;
              setLinesDraft(next);
            },
          }),
          h(
            "button",
            {
              type: "button",
              className: "ec-remove",
              disabled: lines.length <= 1,
              "aria-label": t("section.paths.remove"),
              title: t("section.paths.remove"),
              onClick: () => setLinesDraft(lines.filter((_, at) => at !== index)),
            },
            h(primitives.IconCloseOutlineRegular, { size: 14 }),
          ),
        );

      const preview = packs
        .flatMap((pack) => (pack.stickers ?? []).map((sticker) => ({ pack: pack.id, sticker })))
        .slice(0, PREVIEW_LIMIT);

      const drawer = h(
        React.Fragment,
        null,
        h("div", { className: "ec-desc", style: { marginTop: "2px" } }, t("section.paths.hint")),
        h("div", { className: "ec-lines" }, ...lines.map(pathLine)),
        h(
          "div",
          { className: "ec-path-row" },
          h(Button, { onClick: () => setLinesDraft([...lines, ""]) }, t("section.paths.add")),
        ),
        packs.length > 0
          ? h(
              "div",
              { className: "ec-preview" },
              ...preview.map(({ sticker }) =>
                h(
                  "span",
                  { className: "ec-tile", key: sticker.id, title: sticker.id },
                  h("img", { src: stickerUrl(sticker.id), alt: sticker.id, loading: "lazy" }),
                ),
              ),
              stickerCount > preview.length
                ? h("span", { className: "ec-tile", "data-more": "" }, "+" + String(stickerCount - preview.length))
                : null,
            )
          : null,
        h(
          "div",
          { className: "ec-foot" },
          h(
            "p",
            {
              className: "ec-note-line",
              "data-tone": errors.length > 0 ? "error" : undefined,
              role: errors.length > 0 ? "alert" : undefined,
            },
            errors.length > 0
              ? t("section.scanError", { paths: errors.map((entry) => entry.path).join(", ") })
              : scanNote,
          ),
          h(
            "div",
            { className: "ec-actions" },
            h(
              Button,
              // Writing the same value is what makes the Host rescan; the refreshed
              // preview and the scan total are the only feedback.
              { onClick: () => void commit({ ...settings, lines }) },
              t("section.scan"),
            ),
            h(
              Button,
              { variant: "primary", onClick: () => void commit({ ...settings, lines }) },
              t("section.save"),
            ),
          ),
        ),
      );

      return h(
        "div",
        { className: "ec-page", "data-emote-settings": "" },
        snapshot.status === "error"
          ? h(
              "p",
              { className: "ec-note-line", "data-tone": "error", role: "alert" },
              t("section.loadFailed", { message: snapshot.error ?? "" }),
            )
          : null,
        snapshot.writable === false ? h("p", { className: "ec-note-line" }, t("section.unavailable")) : null,
        alert === null ? null : h("p", { className: "ec-note-line", "data-tone": "error", role: "alert" }, alert),
        h(
          Item,
          {
            title: t("section.stickerReply.label"),
            description: t("section.stickerReply.hint"),
            control: h(Switch, {
              label: t("section.stickerReply.label"),
              checked: settings.stickerReply,
              onToggle: (value) => void commit({ ...settings, stickerReply: value, lines }),
            }),
          },
          settings.stickerReply ? drawer : null,
        ),
        h(
          Item,
          {
            title: t("section.emojiReply.label"),
            description: t("section.emojiReply.hint"),
            control: h(Switch, {
              label: t("section.emojiReply.label"),
              checked: settings.emojiReply,
              onToggle: (value) =>
                void commit({ ...settings, lines, emojiReply: value, emojiRain: value ? settings.emojiRain : false }),
            }),
          },
          settings.emojiReply
            ? h(Item, {
                title: t("section.emojiRain.label"),
                description: t("section.emojiRain.hint"),
                control: h(Switch, {
                  label: t("section.emojiRain.label"),
                  checked: settings.emojiRain,
                  onToggle: (value) => void commit({ ...settings, lines, emojiRain: value }),
                }),
              })
            : null,
        ),
        // Reaction storage. One action, because one is all that can be done
        // without guessing: empty the store. Which reactions exist is not the
        // user's problem to manage — the Host bounds the store by age — so this is
        // here for the case where someone simply wants them gone.
        h(Item, {
          title: t("section.store.label"),
          description: t("section.store.hint", { limit: STORE_LIMIT }),
          control: h(
            "div",
            { className: "ec-actions" },
            h(Button, { onClick: () => void clearAll(), disabled: busy }, busy ? t("section.store.busy") : t("section.store.clear")),
          ),
        }),
        maintenance === null
          ? null
          : h(
              "p",
              {
                className: "ec-note-line",
                "data-tone": maintenance.tone === "error" ? "error" : undefined,
                role: maintenance.tone === "error" ? "alert" : undefined,
              },
              maintenance.text,
            ),
      );
    }

    // ────────────────────────────── plugin body ──────────────────────────────

    /**
     * Required services.
     *
     * "remote" is the RPC face itself and "remote.settings" its settings
     * namespace; both are listed because reading ctx.remote at all requires the
     * "remote" service to be part of this plugin's injection set (the runtime
     * refuses property access on a service that was not declared).
     */
    const inject = ["slots", "locale", "remote", "remote.settings"];

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        "emote-chat: dictionaries",
      );
      const t = (key, params) => ctx.locale.bind(NS)(key, params);
      const disposeStyles = installStyles();

      // ── live projections ───────────────────────────────────────────────────

      const configStore = createStore({
        status: "idle",
        data: undefined,
        error: undefined,
        writable: true,
      });
      const configFace = {
        store: configStore,
        load: async () => {
          patchStore(configStore, { status: "loading" });
          try {
            const data = await getJson(API + "/config");
            configStore.set({
              status: "ready",
              data,
              error: undefined,
              writable: configStore.get().writable,
            });
            return data;
          } catch (error) {
            patchStore(configStore, { status: "error", error: String(error?.message ?? error) });
            return undefined;
          }
        },
      };

      /**
       * Write one settings patch.
       *
       * The harness Settings RPC is preferred: it is the channel every built-in
       * page writes through, so a change lands in the same document the rest of
       * the panel reads. A deployment whose settings document is not writable
       * falls back to the Host's own route, which writes this row's config block
       * in the profile patch directly.
       */
      const writeSettings = async (next) => {
        const desired = {
          stickerReply: next.stickerReply === true,
          paths: splitLines((next.lines ?? []).join("\n")),
          emojiReply: next.emojiReply === true,
          emojiRain: next.emojiReply === true && next.emojiRain === true,
        };
        const ops = Object.entries(desired).map(([field, value]) => ({ field, value }));
        let viaRpc;
        try {
          const described = await ctx.remote.settings.describe();
          viaRpc = described?.namespaces?.[SETTINGS_NS] !== undefined;
        } catch {
          viaRpc = false;
        }
        if (viaRpc) {
          try {
            await ctx.remote.settings.mutate(SETTINGS_NS, ops);
            return { ok: true };
          } catch (error) {
            const message = String(error?.message ?? error);
            // A read-only document is the documented fallback case; anything else
            // is reported, because a silently dropped write is worse than a
            // visible one.
            if (!/writable|no-profile|not found|unknown namespace/iu.test(message)) {
              return { ok: false, message };
            }
          }
        }
        try {
          const response = await fetch(API + "/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(desired),
          });
          if (!response.ok) {
            const text = await response.text();
            return { ok: false, message: text || String(response.status) };
          }
          return { ok: true };
        } catch (error) {
          return { ok: false, message: String(error?.message ?? error) };
        }
      };
      const context = {
        update: (next) => writeSettings(next),
        describe: () => ctx.remote.settings.describe(),
      };

      const catalogStore = createStore({ status: "idle", data: undefined, error: undefined });
      const catalogFace = {
        store: catalogStore,
        load: async () => {
          patchStore(catalogStore, { status: "loading" });
          try {
            const data = await getJson(API + "/config");
            catalogStore.set({ status: "ready", data, error: undefined });
            return data;
          } catch (error) {
            patchStore(catalogStore, { status: "error", error: String(error?.message ?? error) });
            return undefined;
          }
        },
      };

      /**
       * Shared state the console diagnostic and the painters read, so
       * __emoteChat.debug() can answer "why is nothing painted?" without guesswork.
       */
      const runtime = { configStore, catalogStore, configFace, catalogFace, painter: undefined, reader: undefined, chips: undefined };

      // ── conversation enrichment ───────────────────────────────────────────

      ctx.effect(() => {
        const feeds = new Map();
        const rainSeen = new Set();
        /** Pass labels already reported, so a repeated failure logs once. */
        const warned = new Set();
        /** Reactions read out of the Agent's own replies, oldest first. */
        const local = [];
        let localSeq = 0;
        let painter = null;
        let chips = null;
        let reader = null;
        let frame = 0;
        const unsubscribes = [];

        /** The session the visible conversation renders. */
        const currentSessionId = () =>
          document.querySelector("[data-conversation-session]")?.getAttribute("data-conversation-session") ?? undefined;

        const feedFor = (sessionId) => {
          let feed = feeds.get(sessionId);
          if (feed === undefined) {
            feed = createReactionFeed(sessionId);
            feeds.set(sessionId, feed);
            unsubscribes.push(feed.store.subscribe(schedule));
          }
          return feed;
        };

        /** Record one emoji the Agent wrote, and rain it when that is enabled. */
        const acceptLocalReaction = ({ emoji, at }) => {
          localSeq += 1;
          local.push({ seq: "local-" + String(localSeq), emoji, at, source: "reply" });
          if (local.length > MAX_CHIPS * 4) local.splice(0, local.length - MAX_CHIPS * 4);
          if (configStore.get().data?.emojiRain === true) rain(emoji, RAIN_COUNT);
          schedule();
        };

        const tick = () => {
          frame = 0;
          // Self-healing: an unloaded catalog or config silently disables every
          // painter (isEnabled/getCatalog would just return early), so the loop
          // retries the fetch instead of staying dark forever.
          if (configStore.get().data === undefined && configStore.get().status !== "loading") {
            void configFace.load().then(schedule);
          }
          if (catalogStore.get().data === undefined && catalogStore.get().status !== "loading") {
            void catalogFace.load().then(schedule);
          }
          // Each pass is guarded on its own: one failing scan must not stop the
          // others, and a failure has to leave a trace instead of silently
          // disabling the whole surface.
          for (const [label, pass] of [
            ["sticker-painter", () => painter?.scan()],
            ["reply-reactions", () => reader?.scan()],
            ["reaction-chips", () => chips?.scan()],
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
          for (const feed of feeds.values()) {
            for (const entry of feed.store.get().entries) {
              if (!shouldRain(entry, Date.now(), rainSeen)) {
                if (entry.live === true && !rainSeen.has(entry.seq)) {
                  rainSeen.add(entry.seq);
                  rainLog.skipped.push({
                    emoji: entry.emoji,
                    seq: entry.seq,
                    ageMs: Date.now() - (entry.at ?? 0),
                    why: "too-old",
                  });
                  if (rainLog.skipped.length > 12) rainLog.skipped.shift();
                }
                continue;
              }
              rainSeen.add(entry.seq);
              rain(entry.emoji, RAIN_COUNT);
            }
          }
        };
        function schedule() {
          if (frame !== 0) return;
          frame = requestAnimationFrame(tick);
        }

        painter = createStickerPainter({
          t,
          getCatalog: () => catalogStore.get().data,
          isEnabled: () => configStore.get().data?.stickerReply === true,
        });
        reader = createReplyReactionReader({
          t,
          isEnabled: () => configStore.get().data?.emojiReply === true,
          emit: acceptLocalReaction,
        });
        chips = createReactionPainter({
          t,
          getEntries: () => {
            const sessionId = currentSessionId();
            const hosted = sessionId === undefined ? [] : feedFor(sessionId).store.get().entries;
            return [...local, ...hosted];
          },
          onNewMessage: (anchor) => {
            const sessionId = currentSessionId();
            if (sessionId === undefined) return;
            void registerAnchor(sessionId, anchor);
          },
        });
        runtime.painter = painter;
        runtime.reader = reader;
        runtime.chips = chips;

        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        unsubscribes.push(configStore.subscribe(schedule));
        const watcher = setInterval(() => {
          const sessionId = currentSessionId();
          if (sessionId !== undefined) feedFor(sessionId);
          schedule();
        }, SESSION_WATCH_MS);

        void Promise.all([configFace.load(), catalogFace.load()]).then(schedule);
        // Once the first paint has settled, report the loaded window. Delayed a
        // beat because reporting an empty list would be worse than not reporting:
        // the conversation is what is being described.
        const seenTimer = setTimeout(() => {
          void reportKnownMessages().finally(schedule);
        }, 2500);
        unsubscribes.push(() => clearTimeout(seenTimer));
        schedule();

        // A one-command diagnostic for the browser console. The painters are the
        // part that can fail silently, so they answer directly instead of making
        // the user read the DOM: __emoteChat.debug(). It lives inside this effect
        // because every name it reads is defined here; at apply level it threw
        // ReferenceError, which is worse than having no diagnostic at all.
        runtime.debug = () => {
          const flows = [...document.querySelectorAll("[data-chat-flow-kind]")];
          const tokens = flows
            .map((flow) => {
              const found = splitTokens(flow.textContent ?? "").filter((segment) => segment.token !== undefined);
              return found.length === 0
                ? undefined
                : {
                    kind: flow.getAttribute("data-chat-flow-kind"),
                    key: flow.getAttribute("data-chat-node-key"),
                    tokens: found.map((segment) => segment.token),
                    alreadyPainted: flow.querySelector("[data-emote-sticker]") !== null,
                  };
            })
            .filter(Boolean);
          const users = [...document.querySelectorAll('[data-chat-flow-kind="user"]')].map((flow) => {
            const host = reactionHost(flow);
            return {
              key: flow.getAttribute("data-chat-node-key"),
              host: host.className || host.tagName,
              hostHoldsBubble: findClassFragment(host, "bubble") !== null,
              chips: flow.querySelector("[data-emote-chips]")?.textContent ?? null,
            };
          });
          const sessionId = currentSessionId();
          return {
            enabled: {
              stickerReply: configStore.get().data?.stickerReply === true,
              emojiReply: configStore.get().data?.emojiReply === true,
              emojiRain: configStore.get().data?.emojiRain === true,
            },
            configStatus: configStore.get().status,
            catalogStatus: catalogStore.get().status,
            // What the rain did, and why it did nothing: a missing burst is
            // otherwise indistinguishable from a stylesheet that never loaded, an
            // emoji with no glyph, or a reaction that was simply too old.
            rain: {
              enabled: configStore.get().data?.emojiRain === true,
              freshWindowMs: RAIN_FRESH_MS,
              bursts: rainLog.bursts,
              last: rainLog.last,
              skipped: rainLog.skipped,
              layersInDom: document.querySelectorAll(".ec-rain").length,
              stylesheet: document.querySelector('style[data-plugin-css="dsh-plugin-emote-chat"]') !== null,
            },
            packs: (catalogStore.get().data?.packs ?? []).map((pack) => pack.id),
            flowCount: flows.length,
            flowsWithTokens: tokens,
            userMessages: users,
            reactions: {
              sessionId: sessionId ?? null,
              local: local.map((entry) => ({ seq: entry.seq, emoji: entry.emoji })),
              hosted: (sessionId === undefined ? [] : feedFor(sessionId).store.get().entries).map((entry) => ({
                seq: entry.seq,
                emoji: entry.emoji,
                live: entry.live === true,
                session: entry.session ?? null,
              })),
              feedStatus: sessionId === undefined ? "no-session" : feedFor(sessionId).store.get().status,
              feedCount: feeds.size,
            },
            mounts: { ...mountLog },
          };
        };
        if (typeof window !== "undefined") window.__emoteChat = runtime;

        return () => {
          clearInterval(watcher);
          observer.disconnect();
          if (frame !== 0) cancelAnimationFrame(frame);
          for (const unsubscribe of unsubscribes) unsubscribe();
          for (const feed of feeds.values()) feed.dispose();
          feeds.clear();
          chips.dispose();
          reader.dispose();
          painter.dispose();
        };
      }, "emote-chat: conversation enrichment");

      // ── slots ──────────────────────────────────────────────────────────────
      // One tool card for emote_reply, keyed by the wire tool name: a sticker
      // renders as its image, an emoji reaction as the emoji. The owner passes
      // { callId, toolName, phase, block, ... }, where block.argsRaw holds the
      // arguments.
      ctx.slots.inject("tool.call.toolview", () =>
        ctx.slots.register(
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
              return h(
                "figure",
                { className: "ec-tool-card" },
                h("figcaption", null, label("sticker.label") + " · " + stickerId),
                h("img", { src: stickerUrl(stickerId), alt: label("sticker.alt", { name: stickerId }), loading: "lazy" }),
              );
            }
            if (emoji !== "") return h("div", { className: "ec-tool-emoji", title: label("reaction.title") }, emoji);
            return null;
          },
        ),
      );

      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register(
          { name: "conversation.input.left", id: "emote-picker", order: 20, locale: NS },
          function EmotePicker(props) {
            const snapshot = useStore(configStore);
            if (snapshot.data?.stickerReply !== true) return null;
            return h(StickerPicker, { inputActions: props.inputActions, t: props.t ?? t, catalog: catalogFace });
          },
        ),
      );

      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          { name: "settings.section", id: "emote-chat", order: 60, label: () => t("section.nav"), locale: NS },
          function EmoteSettings(props) {
            return h(SettingsSection, { t: props.t ?? t, config: configFace, context });
          },
        ),
      );

      return () => {
        disposeStyles();
      };
    }

    exports.apply = apply;
    exports.inject = inject;
    /**
     * Test seam: the DOM-facing pieces are the part of this bundle that cannot be
     * exercised through apply alone, and they are also the part that broke
     * silently. Handing them out lets the suite drive them against a stub document.
     */
    exports.internals = {
      createStickerPainter,
      createReactionPainter,
      assignReactions,
      createReplyReactionReader,
      reactionHost,
      splitTokens,
      findSticker,
      messageIdOf,
      rowMatches,
      stickerUrl,
      SettingsSection,
      shouldRain,
      RAIN_FRESH_MS,
      TOKEN_OPEN,
      TOKEN_CLOSE,
    };
    return module.exports;
  },
});
