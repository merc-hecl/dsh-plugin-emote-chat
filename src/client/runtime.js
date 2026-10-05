/**
 * [INPUT]: React、宿主 slots/locale 以及配置、订阅、painter 和组件模块
 * [OUTPUT]: apply、inject 与测试用 internals
 * [POS]: 浏览器组装与释放边界；配置共用一个投影，所有页面共用一个回应订阅
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import * as React from "react";
import {
  NS,
  API,
  TOKEN_OPEN,
  TOKEN_CLOSE,
  STORE_LIMIT,
  RAIN_COUNT,
  RAIN_FRESH_MS,
  SESSION_WATCH_MS,
  mountLog,
  createStore,
  patchStore,
  useStore,
  getJson,
  postJson,
  stickerUrl,
  findSticker,
  splitTokens,
} from "./shared.js";
import { installStyles } from "./styles.js";
import { zh, en } from "./locale.js";
import { createReactionFeed } from "./feed.js";
import { createStickerPainter } from "./stickers.js";
import {
  createReactionPainter,
  assignReactions,
  reactionHost,
  messageIdOf,
  rowMatches,
  shouldRain,
  rain,
  rainLog,
  disposeRain,
} from "./reactions.js";
import { StickerPicker, SettingsSection } from "./components.js";
import { findClassFragment } from "./dom.js";
const h = React.createElement;
const inject = ["slots", "locale"];

function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "emote-chat: dictionaries",
  );
  const t = (key, params) => ctx.locale.bind(NS)(key, params);
  const disposeStyles = installStyles();

  const configStore = createStore({
    status: "idle",
    data: undefined,
    error: undefined,
    writable: true,
  });
  const controller = new AbortController();
  let pendingConfig;
  const configFace = {
    store: configStore,
    load: () => {
      if (pendingConfig) return pendingConfig;
      pendingConfig = (async () => {
        patchStore(configStore, { status: "loading" });
        try {
          const data = await getJson(API + "/config", controller.signal);
          if (controller.signal.aborted) return undefined;
          configStore.set({
            status: "ready",
            data,
            error: undefined,
            writable: configStore.get().writable,
          });
          return data;
        } catch (error) {
          if (controller.signal.aborted) return undefined;
          patchStore(configStore, {
            status: "error",
            error: String(error?.message ?? error),
          });
          return undefined;
        }
      })().finally(() => {
        pendingConfig = undefined;
      });
      return pendingConfig;
    },
  };

  const writeSettings = async (next) => {
    try {
      await postJson(
        API + "/settings",
        {
          stickerReply: next.stickerReply === true,
          paths: next.paths ?? [],
          emojiReply: next.emojiReply === true,
          emojiRain: next.emojiReply === true && next.emojiRain === true,
        },
        controller.signal,
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error.message ?? error) };
    }
  };
  const context = {
    update: (next) => writeSettings(next),
  };

  const catalogStore = configStore;
  const catalogFace = configFace;

  const runtime = {
    configStore,
    catalogStore,
    configFace,
    catalogFace,
    painter: undefined,
    chips: undefined,
  };

  ctx.effect(() => {
    const feeds = new Map();
    let feedUnsubscribe;
    const rainSeen = new Set();

    const warned = new Set();

    let painter = null;
    let chips = null;
    let frame = 0;
    const unsubscribes = [];

    const currentSessionId = () =>
      document
        .querySelector("[data-conversation-session]")
        ?.getAttribute("data-conversation-session") ?? undefined;

    const feedFor = () => {
      let feed = feeds.get("global");
      if (!feed && configStore.get().data?.emojiReply === true) {
        feed = createReactionFeed();
        feeds.set("global", feed);
        feedUnsubscribe = feed.store.subscribe(schedule);
      }
      return feed;
    };
    const tick = () => {
      frame = 0;
      // 每个 painter 单独捕获并记录失败，避免互相中断。
      for (const [label, pass] of [
        ["sticker-painter", () => painter?.scan()],
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
            if (entry.live === true && !rainSeen.has(entry.key ?? entry.seq)) {
              rainSeen.add(entry.key ?? entry.seq);
              if (rainSeen.size > STORE_LIMIT * 2)
                rainSeen.delete(rainSeen.values().next().value);
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
          rainSeen.add(entry.key ?? entry.seq);
          rain(entry.emoji, RAIN_COUNT);
          if (rainSeen.size > STORE_LIMIT * 2)
            rainSeen.delete(rainSeen.values().next().value);
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
    chips = createReactionPainter({
      t,
      getEntries: () =>
        configStore.get().data?.emojiReply === true
          ? (feedFor()?.store.get().entries ?? [])
          : [],
    });
    runtime.painter = painter;
    runtime.chips = chips;

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    unsubscribes.push(configStore.subscribe(schedule));
    const configTimer = setInterval(() => {
      void configFace.load();
    }, 5000);
    unsubscribes.push(() => clearInterval(configTimer));
    const watcher = setInterval(() => {
      if (configStore.get().data?.emojiReply === true) feedFor();
      else if (feeds.size) {
        feedUnsubscribe?.();
        for (const feed of feeds.values()) feed.dispose();
        feeds.clear();
      }
      schedule();
    }, SESSION_WATCH_MS);

    void configFace.load().then(schedule);
    schedule();

    // 浏览器诊断 __emoteChat.debug() 读取本生命周期内的状态。
    runtime.debug = () => {
      const flows = [...document.querySelectorAll("[data-chat-flow-kind]")];
      const tokens = flows
        .map((flow) => {
          const found = splitTokens(flow.textContent ?? "").filter(
            (segment) => segment.token !== undefined,
          );
          return found.length === 0
            ? undefined
            : {
                kind: flow.getAttribute("data-chat-flow-kind"),
                key: flow.getAttribute("data-chat-node-key"),
                tokens: found.map((segment) => segment.token),
                alreadyPainted:
                  flow.querySelector("[data-emote-sticker]") !== null,
              };
        })
        .filter(Boolean);
      const users = [
        ...document.querySelectorAll('[data-chat-flow-kind="user"]'),
      ].map((flow) => {
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
        // 保留近期雨的触发和跳过原因，便于定位展示故障。
        rain: {
          enabled: configStore.get().data?.emojiRain === true,
          freshWindowMs: RAIN_FRESH_MS,
          bursts: rainLog.bursts,
          last: rainLog.last,
          skipped: rainLog.skipped,
          layersInDom: document.querySelectorAll(".ec-rain").length,
          stylesheet:
            document.querySelector(
              'style[data-plugin-css="dsh-plugin-emote-chat"]',
            ) !== null,
        },
        packs: (catalogStore.get().data?.packs ?? []).map((pack) => pack.id),
        flowCount: flows.length,
        flowsWithTokens: tokens,
        userMessages: users,
        reactions: {
          sessionId: sessionId ?? null,
          hosted: (feeds.get("global")?.store.get().entries ?? []).map(
            (entry) => ({
              seq: entry.seq,
              emoji: entry.emoji,
              live: entry.live === true,
              session: entry.session ?? null,
            }),
          ),
          feedStatus: feeds.get("global")?.store.get().status ?? "disabled",
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
      feedUnsubscribe?.();
      painter.dispose();
      disposeRain();
      if (window.__emoteChat === runtime) delete window.__emoteChat;
    };
  }, "emote-chat: conversation enrichment");

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
        const stickerId =
          typeof args.sticker === "string" ? args.sticker.trim() : "";
        const emoji = typeof args.emoji === "string" ? args.emoji.trim() : "";
        const label = props.t ?? t;
        if (stickerId !== "") {
          return h(
            "figure",
            { className: "ec-tool-card" },
            h("figcaption", null, label("sticker.label") + " · " + stickerId),
            h("img", {
              src: stickerUrl(stickerId),
              alt: label("sticker.alt", { name: stickerId }),
              loading: "lazy",
            }),
          );
        }
        if (emoji !== "")
          return h(
            "div",
            { className: "ec-tool-emoji", title: label("reaction.title") },
            emoji,
          );
        return null;
      },
    ),
  );

  ctx.slots.inject("conversation.input.left", () =>
    ctx.slots.register(
      {
        name: "conversation.input.left",
        id: "emote-picker",
        order: 20,
        locale: NS,
      },
      function EmotePicker(props) {
        const snapshot = useStore(configStore);
        if (snapshot.data?.stickerReply !== true) return null;
        return h(StickerPicker, {
          inputActions: props.inputActions,
          t: props.t ?? t,
          catalog: catalogFace,
        });
      },
    ),
  );

  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "emote-chat",
        order: 60,
        label: () => t("section.nav"),
        locale: NS,
      },
      function EmoteSettings(props) {
        return h(SettingsSection, {
          t: props.t ?? t,
          config: configFace,
          context,
        });
      },
    ),
  );

  return () => {
    controller.abort();
    disposeStyles();
  };
}

export { apply, inject };

export const internals = {
  createStickerPainter,
  createReactionPainter,
  assignReactions,
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
  createReactionFeed,
  rain,
  disposeRain,
};
