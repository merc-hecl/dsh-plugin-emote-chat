/**
 * [INPUT]: node:test、共享 VM 夹具、React 状态模拟与双语文案
 * [OUTPUT]: 设置保存、扫描与清空回应的成功、失败、重复通知回归
 * [POS]: 设置交互测试；通过真实 bundle 回调验证，不操作宿主 UI
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBundle } from "./dom-fixture.mjs";
import { zh, en } from "../src/client/locale.js";

const flush = () => new Promise(setImmediate);

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
function page({ update, fetch, locale = zh } = {}) {
  const hooks = [];
  let cursor = 0;
  const writes = [];
  const requests = [];
  const Toast = () => null;
  const { exports } = loadBundle({
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
      return fetch ? fetch(url, options) : {
        ok: true, json: async () => ({ ok: true, removed: 7 }),
      };
    },
  });
  const data = {
    stickerReply: true, emojiReply: true, emojiRain: false,
    paths: ["stickers"], packs: [], errors: [],
  };
  const props = {
    t: (key, params = {}) => Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      locale[key],
    ),
    config: {
      store: { get: () => ({ status: "ready", data, writable: true }) },
      load: async () => {},
    },
    context: { update: async (next) => {
      writes.push(JSON.parse(JSON.stringify(next)));
      const result = update ? await update(next) : { ok: true };
      if (result.ok) Object.assign(data, next);
      return result;
    } },
  };
  const render = () => {
    cursor = 0;
    return nodes(exports.internals.SettingsSection(props));
  };
  return {
    writes, requests, render,
    toast: () => render().find((node) => node.type === Toast),
    button: (key) => render().find((node) =>
      node.props.onClick && node.props.children?.[0] === locale[key]),
    toggle: (key) => render().find((node) =>
      node.props.onToggle && node.props.label === locale[key]),
  };
}

test("all setting switches and folder saves use the host success Toast", async () => {
  for (const [key, field, value] of [
    ["section.stickerReply.label", "stickerReply", false],
    ["section.emojiReply.label", "emojiReply", false],
    ["section.emojiRain.label", "emojiRain", true],
    ["section.save"],
  ]) {
    const ui = page();
    assert.equal(ui.toast(), undefined);
    if (field) ui.toggle(key).props.onToggle(value);
    else ui.button(key).props.onClick();
    await flush();
    assert.equal(ui.writes.length, 1, key);
    if (field) assert.equal(ui.writes[0][field], value, key);
    const toast = ui.toast();
    assert.equal(toast.props.text, "设置已保存", key);
    assert.equal(toast.props.tone, "success", key);
  }
});

test("rescan reports scan completion instead of settings saved in both locales", async () => {
  for (const locale of [zh, en]) {
    const ui = page({ locale });
    ui.button("section.scan").props.onClick();
    await flush();
    assert.equal(ui.writes.length, 1, "rescan still refreshes the Host index");
    assert.equal(ui.toast().props.text, locale["section.scanCompleted"]);
    assert.notEqual(ui.toast().props.text, locale["section.saved"]);
    assert.equal(ui.toast().props.tone, "success");
    ui.button("section.save").props.onClick();
    await flush();
    assert.equal(ui.toast().props.text, locale["section.saved"]);
  }
});

test("editing folders shows no success until the host acknowledges the save", async () => {
  let acknowledge;
  const ui = page({ update: () => new Promise((resolve) => { acknowledge = resolve; }) });
  ui.render().find((node) => node.type === "input").props.onChange({
    target: { value: "new-folder" },
  });
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.toast(), undefined);
  ui.button("section.save").props.onClick();
  assert.equal(ui.toast(), undefined, "a pending write is not saved");
  assert.deepEqual(ui.writes[0].paths, ["new-folder"]);
  acknowledge({ ok: true });
  await flush();
  assert.equal(ui.toast().props.text, zh["section.saved"]);
});

test("failed settings writes remove stale success and retain the failure message", async () => {
  let result = { ok: true };
  const ui = page({ update: async () => result });
  ui.button("section.save").props.onClick();
  await flush();
  assert.ok(ui.toast());
  result = { ok: false, message: "read only" };
  ui.toggle("section.emojiRain.label").props.onToggle(true);
  await flush();
  assert.equal(ui.toast(), undefined);
  assert.ok(ui.render().some((node) =>
    node.props.role === "alert" && node.props.children?.[0] === "保存失败：read only"));
});

test("identical successes restart the Toast cycle and dismiss only their own notice", async () => {
  const ui = page();
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

test("clear-all uses distinct localized success copy, including an empty store", async () => {
  for (const locale of [zh, en]) {
    for (const removed of [0, 7]) {
      const ui = page({ locale, fetch: async () => ({
        ok: true, json: async () => ({ ok: true, removed }),
      }) });
      ui.button("section.store.clear").props.onClick();
      await flush();
      assert.equal(ui.writes.length, 0, "clearing does not save settings");
      assert.equal(ui.requests[0].url, "/api/emote-chat/clean");
      assert.equal(ui.requests[0].options.method, "POST");
      assert.deepEqual(JSON.parse(ui.requests[0].options.body), { mode: "all" });
      assert.equal(ui.toast().props.text, locale["section.store.cleared"]);
      assert.notEqual(ui.toast().props.text, locale["section.saved"]);
      assert.equal(ui.toast().props.tone, "success");
      assert.equal(ui.button("section.store.clear").props.disabled, false);
    }
  }
});

test("failed clear-all shows its error; a successful retry clears the error", async () => {
  let ok = false;
  const ui = page({ fetch: async () => ({
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
