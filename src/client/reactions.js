/**
 * [INPUT]: shared 的显示上限和时效，dom 的消息容器查找
 * [OUTPUT]: createReactionPainter、消息匹配、rain、disposeRain 与诊断信息
 * [POS]: 按稳定 messageId 与当前 Desktop bubble 显示回应，不回退旧消息 key 或容器
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { MESSAGE_ID_MARKER, MAX_CHIPS, RAIN_FRESH_MS } from "./shared.js";
import { findClassFragment } from "./dom.js";
function reactionHost(flow) {
  return findClassFragment(flow, "bubble");
}

function messageIdOf(key) {
  const text = String(key ?? "");
  const match = new RegExp(`^\\d+:${MESSAGE_ID_MARKER}(.+)$`, "u").exec(text);
  return match?.[1];
}

function rowMatches(row, entry) {
  return typeof entry.messageId === "string" &&
    messageIdOf(row.getAttribute("data-chat-node-key")) === entry.messageId;
}

function assignReactions(entries, messages) {
  const byMessage = new Map();
  for (const entry of entries) {
    if (entry?.seq === undefined) continue;
    const row = messages.find((candidate) => rowMatches(candidate, entry));
    if (row === undefined) continue;
    const list = byMessage.get(row) ?? [];
    list.push(entry);
    byMessage.set(row, list);
  }
  return byMessage;
}

function createReactionPainter({ getEntries }) {
  const rows = new Map();

  const scan = () => {
    const messages = [
      ...document.querySelectorAll('[data-chat-flow-kind="user"]'),
    ];

    const live = new Set(messages);
    // 浏览器只显示宿主提供的目标；不扫描 DOM 推断回合锚点。
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
      // React 可能回收插件追加的节点，断开时重新建立胶囊行。
      if (chips !== undefined && chips.parentElement !== host) {
        chips.remove();
        chips = undefined;
        rows.delete(row);
      }
      if (chips === undefined) {
        chips = document.createElement("div");
        chips.className = "ec-chips";
        chips.setAttribute("data-emote-chips", "");
        // 胶囊是装饰，aria-hidden 避免读屏将其当成用户消息内容。
        chips.setAttribute("aria-hidden", "true");
        host.append(chips);
        rows.set(row, chips);
      }
      const signature = JSON.stringify(
        shown.map((entry) => [entry.key, entry.emoji]),
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

function shouldRain(entry, now, seen) {
  if (entry?.live !== true || typeof entry.key !== "string") return false;
  if (seen.has(entry.key)) return false;
  return now - (entry.at ?? 0) <= RAIN_FRESH_MS;
}

const rainLog = { bursts: 0, last: null, skipped: [] };
const rainLayers = new Map();

function disposeRain() {
  for (const [layer, timer] of rainLayers) {
    clearTimeout(timer);
    layer.remove();
  }
  rainLayers.clear();
}

function rain(emoji, count) {
  if (typeof document === "undefined") return undefined;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
    return undefined;
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
      (Math.random() * 90 - 45).toFixed(1) + "px",
    );
    layer.append(span);
  }
  document.body.append(layer);
  // 保留最长动画和延迟的余量，再清理图层。
  rainLayers.set(
    layer,
    setTimeout(() => {
      layer.remove();
      rainLayers.delete(layer);
    }, 9000),
  );
  return layer;
}

export {
  createReactionPainter,
  assignReactions,
  reactionHost,
  messageIdOf,
  rowMatches,
  shouldRain,
  rain,
  rainLog,
  disposeRain,
};
