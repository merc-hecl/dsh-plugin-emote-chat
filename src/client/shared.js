/**
 * [INPUT]: React hooks 与浏览器 fetch
 * [OUTPUT]: 状态容器、HTTP 读取、贴纸标记解析、素材 URL 和共享常量
 * [POS]: 浏览器无业务依赖的底层协议工具；保留标记原文供 painter 还原
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import * as React from "react";
const NS = "emote";

const API = "/api/emote-chat";

const SETTINGS_NS = "emote-chat";

const TOKEN_OPEN = "[[sticker:";
const TOKEN_CLOSE = "]]";

const MESSAGE_ID_MARKER = "input-message";

const MESSAGE_FLOW_KINDS = new Set([
  "user",
  "steering",
  "assistant-step",
  "developer-message",
]);

const NON_MESSAGE_REGIONS =
  "[data-step-process], [data-step-process-body], [data-step-process-content], [data-chat-anchor-key^='call:']";

const MAX_CHIPS = 8;

const STORE_LIMIT = 500;

const RAIN_COUNT = 26;

const RAIN_FRESH_MS = 15000;

const PREVIEW_LIMIT = 12;

const SESSION_WATCH_MS = 1200;

const mountLog = { mounts: 0, unmounts: 0, events: [] };

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

function patchStore(store, patch) {
  store.set({ ...store.get(), ...patch });
}

function useStore(store) {
  return React.useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(),
    () => store.get(),
  );
}

function splitLines(text) {
  return String(text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload?.ok === false)
    throw new Error(
      payload?.message ?? `${response.status} ${response.statusText}`,
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
    body: JSON.stringify(body),
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
  const pack = packs.find(
    (candidate) => candidate.id === packId || candidate.name === packId,
  );
  return pack?.stickers?.find((candidate) => candidate.name === name);
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
      ...(match[0] === TOKEN_OPEN + token + TOKEN_CLOSE
        ? {}
        : { raw: match[0] }),
    });
    index = match.index + match[0].length;
  }
  if (index < text.length) segments.push({ text: text.slice(index) });
  return segments;
}

export {
  NS,
  API,
  SETTINGS_NS,
  TOKEN_OPEN,
  TOKEN_CLOSE,
  MESSAGE_ID_MARKER,
  MESSAGE_FLOW_KINDS,
  NON_MESSAGE_REGIONS,
  MAX_CHIPS,
  STORE_LIMIT,
  RAIN_COUNT,
  RAIN_FRESH_MS,
  PREVIEW_LIMIT,
  SESSION_WATCH_MS,
  mountLog,
  createStore,
  patchStore,
  useStore,
  splitLines,
  getJson,
  postJson,
  stickerUrl,
  findSticker,
  splitTokens,
};
