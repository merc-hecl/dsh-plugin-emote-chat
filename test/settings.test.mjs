/**
 * [INPUT]: node:test、真实客户端适配器、React 状态模拟与双语文案
 * [OUTPUT]: 设置写入、重新读取、扫描投影与通知回归
 * [POS]: 设置集成测试；模拟 HTTP 边界，页面状态只由配置 GET 更新
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeHarness, flush } from "./runtime-fixture.mjs";
import { zh, en } from "../src/client/locale.js";

function nodes(node, found = []) {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) nodes(child, found);
  } else {
    if (node.type !== undefined) found.push(node);
    for (const value of Object.values(node.props ?? {})) nodes(value, found);
  }
  return found;
}

/** Persist the section's hooks across renders; leave child primitives opaque. */
async function page(t, { update, fetch, configFetch, initial = {}, locale = zh } = {}) {
  const hooks = [];
  let cursor = 0;
  const writes = [];
  const requests = [];
  const hostData = {
    stickerReply: true, emojiReply: true, emojiRain: false,
    paths: ["stickers"], packs: [], errors: [], ...initial,
  };
  const Toast = () => null;
  const app = runtimeHarness({
    react: {
      createElement: (type, props, ...children) => ({
        type,
        props: { ...props, ...(children.length ? { children } : {}) },
      }),
      useState: (initial) => {
        const at = cursor++;
        if (!Object.hasOwn(hooks, at))
          hooks[at] = typeof initial === "function" ? initial() : initial;
        return [hooks[at], (next) => {
          hooks[at] = typeof next === "function" ? next(hooks[at]) : next;
        }];
      },
      useRef: (initial) => {
        const at = cursor++;
        hooks[at] ??= { current: initial };
        return hooks[at];
      },
    },
    primitives: { Toast },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === "/api/emote-chat/config") return configFetch
        ? configFetch(hostData, requests.filter((r) => r.url === url).length)
        : { ok: true, json: async () => JSON.parse(JSON.stringify(hostData)) };
      if (url === "/api/emote-chat/settings") {
        const next = JSON.parse(options.body);
        writes.push(next);
        const result = update ? await update(next, hostData) : { ok: true };
        if (result.ok) Object.assign(hostData, next);
        return { ok: result.ok, json: async () => result };
      }
      return fetch ? fetch(url, options) : {
        ok: true, json: async () => ({ ok: true, removed: 7 }),
      };
    },
  });
  t.after(() => app.dispose());
  const runtime = app.mount();
  await flush();
  const section = app.slots.find((slot) => slot.options.name === "settings.section");
  const element = section.component({
    t: (key, params = {}) => Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      locale[key],
    ),
  });
  const render = () => {
    cursor = 0;
    return nodes(element.type(element.props));
  };
  return {
    writes, requests, render, runtime,
    reads: () => requests.filter((r) => r.url === "/api/emote-chat/config").length,
    toast: () => render().find((node) => node.type === Toast),
    button: (key) => render().find((node) =>
      node.props.onClick && node.props.children?.[0] === locale[key]),
    toggle: (key) => render().find((node) =>
      node.props.onToggle && node.props.label === locale[key]),
  };
}

test("all setting switches and folder saves use the host success Toast", async (t) => {
  for (const [key, field, value] of [
    ["section.stickerReply.label", "stickerReply", false],
    ["section.emojiReply.label", "emojiReply", false],
    ["section.emojiRain.label", "emojiRain", true],
    ["section.save"],
  ]) {
    const ui = await page(t);
    assert.equal(ui.toast(), undefined);
    if (field) ui.toggle(key).props.onToggle(value);
    else ui.button(key).props.onClick();
    await flush();
    assert.equal(ui.writes.length, 1, key);
    assert.deepEqual(ui.writes[0], {
      stickerReply: true, paths: ["stickers"], emojiReply: true, emojiRain: false,
      ...(field ? { [field]: value } : {}),
    }, key);
    assert.equal(ui.reads(), 2, "saving rereads effective settings from the Host");
    if (field) assert.equal(ui.runtime.configStore.get().data[field], value, key);
    const toast = ui.toast();
    assert.equal(toast.props.text, "设置已保存", key);
    assert.equal(toast.props.tone, "success", key);
  }
});

test("rescan reports scan completion instead of settings saved in both locales", async (t) => {
  for (const locale of [zh, en]) {
    const ui = await page(t, { locale });
    ui.button("section.scan").props.onClick();
    await flush();
    assert.equal(ui.writes.length, 1);
    assert.equal(ui.reads(), 2, "rescan rereads the catalog after the settings POST");
    assert.equal(ui.toast().props.text, locale["section.scanCompleted"]);
    assert.notEqual(ui.toast().props.text, locale["section.saved"]);
    assert.equal(ui.toast().props.tone, "success");
    ui.button("section.save").props.onClick();
    await flush();
    assert.equal(ui.toast().props.text, locale["section.saved"]);
  }
});

test("editing folders shows no success until the host acknowledges the save", async (t) => {
  let acknowledge;
  const ui = await page(t, { update: () => new Promise((resolve) => { acknowledge = resolve; }) });
  ui.render().find((node) => node.type === "input").props.onChange({
    target: { value: "new-folder" },
  });
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.toast(), undefined);
  assert.equal(ui.reads(), 1, "editing does not read or write settings");
  ui.button("section.save").props.onClick();
  assert.equal(ui.toast(), undefined, "a pending write is not saved");
  assert.deepEqual(ui.writes[0].paths, ["new-folder"]);
  acknowledge({ ok: true });
  await flush();
  assert.equal(ui.toast().props.text, zh["section.saved"]);
});

test("failed settings writes remove stale success and retain the failure message", async (t) => {
  let result = { ok: true };
  const ui = await page(t, { update: async () => result });
  ui.button("section.save").props.onClick();
  await flush();
  assert.ok(ui.toast());
  result = { ok: false, message: "read only" };
  ui.toggle("section.emojiRain.label").props.onToggle(true);
  await flush();
  assert.equal(ui.toast(), undefined);
  assert.equal(ui.reads(), 2, "a rejected write must not refresh configuration");
  assert.ok(ui.render().some((node) =>
    node.props.role === "alert" && node.props.children?.[0] === "保存失败：read only"));
});

test("identical successes restart the Toast cycle and dismiss only their own notice", async (t) => {
  const ui = await page(t);
  ui.button("section.save").props.onClick();
  await flush();
  const first = ui.toast();
  ui.button("section.save").props.onClick();
  await flush();
  const second = ui.toast();
  assert.notEqual(second.props.key, first.props.key, "remount resets the primitive timer");
  first.props.onDone();
  assert.equal(ui.toast().props.key, second.props.key);
  second.props.onDone();
  assert.equal(ui.toast(), undefined);
});

test("clear-all uses distinct localized success copy, including an empty store", async (t) => {
  for (const locale of [zh, en]) {
    for (const removed of [0, 7]) {
      const ui = await page(t, { locale, fetch: async () => ({
        ok: true, json: async () => ({ ok: true, removed }),
      }) });
      ui.button("section.store.clear").props.onClick();
      await flush();
      assert.equal(ui.writes.length, 0, "clearing does not save settings");
      const clean = ui.requests.filter((r) => r.url === "/api/emote-chat/clean");
      assert.equal(clean.length, 1);
      assert.equal(clean[0].options.method, "POST");
      assert.deepEqual(JSON.parse(clean[0].options.body), { mode: "all" });
      assert.equal(ui.toast().props.text, locale["section.store.cleared"]);
      assert.notEqual(ui.toast().props.text, locale["section.saved"]);
      assert.equal(ui.toast().props.tone, "success");
      assert.equal(ui.button("section.store.clear").props.disabled, false);
    }
  }
});

test("saved folders and catalog come from the completed config GET before success", async (t) => {
  let complete;
  const ui = await page(t, { configFetch: (data, count) => count === 1
    ? { ok: true, json: async () => JSON.parse(JSON.stringify(data)) }
    : new Promise((resolve) => { complete = resolve; }),
  });
  ui.render().find((node) => node.type === "input").props.onChange({ target: { value: " ./cats " } });
  ui.button("section.save").props.onClick();
  await flush();
  assert.deepEqual(ui.writes[0].paths, ["./cats"]);
  assert.deepEqual(ui.requests.map((r) => [r.url, r.options.method ?? "GET"]), [
    ["/api/emote-chat/config", "GET"],
    ["/api/emote-chat/settings", "POST"],
    ["/api/emote-chat/config", "GET"],
  ]);
  assert.equal(ui.runtime.configStore.get().status, "loading");
  assert.equal(ui.toast(), undefined, "success waits for the refresh");
  assert.deepEqual(Array.from(ui.runtime.configStore.get().data.paths), ["stickers"], "a POST does not mutate the client projection");
  complete({ ok: true, json: async () => ({
    stickerReply: true, emojiReply: true, emojiRain: false,
    paths: ["C:/packs/cats"],
    packs: [{ id: "cats", stickers: [{ id: "cats/happy" }] }], errors: [],
  }) });
  await flush();
  assert.equal(ui.render().find((node) => node.type === "input").props.value, "C:/packs/cats");
  assert.equal(ui.render().find((node) => node.type === "img").props.alt, "cats/happy");
  assert.equal(ui.toast().props.text, zh["section.saved"]);
});

test("rescan replaces preview counts and unreadable-folder markers with the new catalog", async (t) => {
  const ui = await page(t, {
    initial: { errors: [{ path: "stickers", reason: "missing" }] },
    configFetch: (data, count) => ({ ok: true, json: async () => ({
      ...data,
      packs: count === 1 ? [] : [{ id: "cats", stickers: [{ id: "cats/a" }, { id: "cats/b" }] }],
      errors: count === 1 ? data.errors : [],
    }) }),
  });
  assert.equal(ui.render().filter((node) => node.type === "img").length, 0);
  assert.equal(ui.render().find((node) => node.type === "input").props["data-missing"], "true");
  ui.button("section.scan").props.onClick();
  await flush();
  assert.equal(ui.reads(), 2);
  assert.deepEqual(ui.render().filter((node) => node.type === "img").map((node) => node.props.alt), ["cats/a", "cats/b"]);
  assert.equal(ui.render().find((node) => node.type === "input").props["data-missing"], undefined);
  assert.ok(ui.render().some((node) => node.props.children?.includes("1 个表情包 · 2 张图片")));
  assert.equal(ui.toast().props.text, zh["section.scanCompleted"]);
});

test("disabling emoji replies preserves other settings and clears and hides emoji rain", async (t) => {
  const ui = await page(t, { initial: { emojiRain: true } });
  assert.equal(ui.toggle("section.emojiRain.label").props.checked, true);
  ui.toggle("section.emojiReply.label").props.onToggle(false);
  await flush();
  assert.deepEqual(ui.writes[0], {
    stickerReply: true, paths: ["stickers"], emojiReply: false, emojiRain: false,
  });
  assert.equal(ui.toggle("section.emojiReply.label").props.checked, false);
  assert.equal(ui.toggle("section.emojiRain.label"), undefined);
  ui.toggle("section.emojiReply.label").props.onToggle(true);
  await flush();
  assert.equal(ui.toggle("section.emojiRain.label").props.checked, false);
});

test("a failed config refresh retains the last snapshot and reports an error until retry", async (t) => {
  const ui = await page(t, { configFetch: (data, count) => count === 2
    ? { ok: false, json: async () => ({ message: "catalog unavailable" }) }
    : { ok: true, json: async () => JSON.parse(JSON.stringify(data)) },
  });
  ui.toggle("section.emojiRain.label").props.onToggle(true);
  await flush();
  assert.equal(ui.writes[0].emojiRain, true);
  assert.equal(ui.runtime.configStore.get().status, "error");
  assert.equal(ui.toggle("section.emojiRain.label").props.checked, false);
  assert.ok(ui.render().some((node) => node.props.role === "alert"
    && node.props.children?.[0].includes("catalog unavailable")));
  await ui.runtime.configFace.load();
  assert.equal(ui.runtime.configStore.get().status, "ready");
  assert.equal(ui.toggle("section.emojiRain.label").props.checked, true);
  assert.ok(!ui.render().some((node) => node.props.role === "alert"));
});

test("failed clear-all shows its error; a successful retry clears the error", async (t) => {
  let ok = false;
  const ui = await page(t, { fetch: async () => ({
    ok, json: async () => ok ? { ok: true, removed: 1 } : { message: "disk error" },
  }) });
  ui.button("section.store.clear").props.onClick();
  assert.equal(ui.button("section.store.busy").props.disabled, true);
  await flush();
  assert.equal(ui.toast(), undefined);
  assert.ok(ui.render().some((node) =>
    node.props.role === "alert" && node.props.children?.[0] === "清空失败：disk error"));
  ok = true;
  ui.button("section.store.clear").props.onClick();
  await flush();
  assert.equal(ui.toast().props.text, "已清空全部回应");
  assert.ok(!ui.render().some((node) => node.props.role === "alert"));
});
