/**
 * [INPUT]: React、宿主 slots/locale 以及配置、订阅、painter 和组件模块
 * [OUTPUT]: apply、inject 与测试用 internals
 * [POS]: 单一配置投影与回应订阅；保存后的强制刷新避开旧请求，卸载取消全部资源
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import * as React from "react";
import {
  NS,
  API,
  STORE_LIMIT,
  RAIN_COUNT,
  RAIN_FRESH_MS,
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
      if (controller.signal.aborted) return undefined;
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
  const context = { update: writeSettings };

  const runtime = {
    configStore,
    configFace,
    painter: undefined,
    chips: undefined,
  };

  ctx.effect(() => {
    let feed;
    let feedUnsubscribe;
    const rainSeen = new Set();

    const warned = new Set();

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
              why: "too-old",
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
      isEnabled: () => configStore.get().data?.stickerReply === true,
    });
    chips = createReactionPainter({
      getEntries: () =>
        configStore.get().data?.emojiReply === true
          ? (feedFor()?.store.get().entries ?? [])
          : [],
    });
    const syncFeed = () => {
      if (configStore.get().data?.emojiReply === true) feedFor();
      else if (feed) {
        feedUnsubscribe();
        feedUnsubscribe = undefined;
        feed.dispose();
        feed = undefined;
      }
      schedule();
    };
    runtime.painter = painter;
    runtime.chips = chips;

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    unsubscribes.push(configStore.subscribe(syncFeed));
    const configTimer = setInterval(() => {
      void configFace.load();
    }, 5000);
    unsubscribes.push(() => clearInterval(configTimer));
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
          host: host?.className ?? null,
          chips: flow.querySelector("[data-emote-chips]")?.textContent ?? null,
        };
      });
      return {
        enabled: {
          stickerReply: configStore.get().data?.stickerReply === true,
          emojiReply: configStore.get().data?.emojiReply === true,
          emojiRain: configStore.get().data?.emojiRain === true,
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
          stylesheet:
            document.querySelector(
              'style[data-plugin-css="dsh-plugin-emote-chat"]',
            ) !== null,
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
              live: entry.live === true,
            }),
          ),
          feedStatus: feed?.store.get().status ?? "disabled",
          feedCount: feed ? 1 : 0,
        },
        mounts: { ...mountLog },
      };
    };
    if (typeof window !== "undefined") window.__emoteChat = runtime;

    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      for (const unsubscribe of unsubscribes) unsubscribe();
      feed?.dispose();
      feed = undefined;
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
          catalog: configFace,
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
  SettingsSection,
  shouldRain,
  RAIN_FRESH_MS,
  createReactionFeed,
  rain,
  disposeRain,
};
