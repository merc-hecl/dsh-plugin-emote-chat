/**
 * [INPUT]: 共享 VM/DOM fixture、可覆盖 React 和 HTTP 响应
 * [OUTPUT]: 真实 apply/slot 生命周期与可控计时器、observer、请求记录
 * [POS]: 客户端集成 fixture；仅模拟宿主边界，不替代配置适配器或业务状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { loadBundle, makeElement, chatDocument, allElements } from "./dom-fixture.mjs";

export const flush = () => new Promise(setImmediate);

export function runtimeHarness({ react, primitives, fetch, roots = [] } = {}) {
  const intervals = new Map(), timers = new Map(), frames = new Map();
  const observers = [], requests = [], slots = [], dictionaries = new Set();
  const head = makeElement("head"), body = makeElement("body");
  head.__document = body.__document = true;
  for (const root of roots) body.appendChild(root);
  const document = {
    ...chatDocument(roots), head, body,
    createElement: (tag) => Object.assign(makeElement(tag), { dataset: {} }),
    querySelector: (selector) => selector === 'style[data-plugin-css="dsh-plugin-emote-chat"]'
      ? head.childNodes.find((node) => node.dataset.pluginCss === "dsh-plugin-emote-chat") ?? null
      : null,
  };
  const queryAll = document.querySelectorAll;
  document.querySelectorAll = (selector) => selector === ".ec-rain"
    ? allElements(body).filter((node) => node.classList?.contains("ec-rain"))
    : queryAll(selector);
  let serial = 0, disposers = null;
  const schedule = (map, cb, ms) => {
    const id = ++serial;
    map.set(id, { cb, ms });
    return id;
  };
  const bundle = loadBundle({
    react, primitives, document,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return fetch ? fetch(url, options) : {
        ok: true, json: async () => ({ emojiReply: false, paths: [], packs: [] }),
      };
    },
    setInterval: (cb, ms) => schedule(intervals, cb, ms),
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (cb, ms) => schedule(timers, cb, ms),
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (cb) => schedule(frames, cb),
    cancelAnimationFrame: (id) => frames.delete(id),
    MutationObserver: class {
      constructor(cb) { this.cb = cb; this.active = false; observers.push(this); }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
  });
  const track = (callback) => {
    const cleanup = callback();
    if (typeof cleanup === "function") disposers.push(cleanup);
    return cleanup;
  };
  const ctx = {
    effect: track,
    locale: {
      register(ns) { dictionaries.add(ns); return () => dictionaries.delete(ns); },
      bind: () => (key) => key,
    },
    slots: {
      inject: (_name, callback) => track(callback),
      register(options, component) {
        const slot = { options, component };
        slots.push(slot);
        return () => slots.splice(slots.indexOf(slot), 1);
      },
    },
  };
  return {
    ...bundle, intervals, timers, frames, observers, requests, slots, dictionaries, head, body,
    mount() {
      if (disposers !== null) throw new Error("dispose the current plugin before reloading");
      disposers = [];
      track(() => bundle.exports.apply(ctx));
      return bundle.sandbox.window.__emoteChat;
    },
    dispose() {
      if (disposers === null) return;
      for (const cleanup of disposers.reverse()) cleanup();
      disposers = null;
    },
    tick(ms) {
      for (const timer of [...intervals.values()]) if (timer.ms === ms) timer.cb();
    },
    frame() {
      for (const [id, frame] of [...frames]) { frames.delete(id); frame.cb(); }
    },
  };
}
