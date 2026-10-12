/**
 * [INPUT]: 浏览器 document 与宿主主题 CSS 变量
 * [OUTPUT]: installStyles；当前 Desktop 组件与消息装饰样式，无旧投影规则
 * [POS]: 浏览器样式生命周期；统一贴纸、设置、回应与 reduced-motion 表现
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
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

/* ── Conversation decorations ─────────────────────────────────────────────── */
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
    'style[data-plugin-css="dsh-plugin-emote-chat"]',
  );
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

export { installStyles };
