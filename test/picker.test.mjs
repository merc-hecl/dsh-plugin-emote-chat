/**
 * [INPUT]: node:test、真实选择器 slot、React 状态模拟与分组目录
 * [OUTPUT]: 远端目录选择、网格滚动复位、完整贴纸 ID 插入与目录刷新回归
 * [POS]: 选择器交互测试；模拟宿主边界，不操作桌面应用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeHarness, flush } from "./runtime-fixture.mjs";

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...Object.values(node.props ?? {}).flatMap(nodes)];
}

async function picker(t, packs) {
  const hooks = [], inserted = [];
  const span = { start: 4, end: 4 };
  let cursor = 0;
  const app = runtimeHarness({
    react: {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState: (initial) => {
        const at = cursor++;
        if (!Object.hasOwn(hooks, at)) hooks[at] = initial;
        return [hooks[at], (next) => { hooks[at] = typeof next === "function" ? next(hooks[at]) : next; }];
      },
      useRef: (initial) => {
        const at = cursor++;
        return hooks[at] ??= { current: initial };
      },
    },
    fetch: async () => ({ ok: true, json: async () => ({ stickerReply: true, packs }) }),
  });
  t.after(() => app.dispose());
  const runtime = app.mount();
  await flush();
  const slot = app.slots.find((entry) => entry.options.id === "emote-picker");
  const element = slot.component({
    t: (key) => key,
    inputActions: {
      captureInsertion: () => span,
      insertText: (token, target) => inserted.push({ token, target }),
    },
  });
  const render = () => { cursor = 0; return nodes(element.type(element.props)); };
  render().find((node) => node.props?.className === "ec-trigger").props.onClick();
  await flush();
  return { render, runtime, inserted, span };
}

const pack = (name) => ({ id: name, name, stickers: [{ id: `${name}/ok`, name: "ok" }] });

test("every grouped folder stays selectable and inserts its full sticker ID", async (t) => {
  const packs = [...Array.from({ length: 19 }, (_, i) => pack(`memes/folder-${i}`)), pack("cats/folder-18")];
  const ui = await picker(t, packs);
  const initial = ui.render();
  assert.deepEqual(initial.filter((node) => node.props?.className === "ec-pack-root").map((node) => node.props.children[0]), ["memes", "cats"]);
  const folders = initial.filter((node) => node.props?.className === "ec-pack");
  assert.equal(folders.length, 20);
  const last = folders.at(-1);
  assert.equal(last.props.children[0], "folder-18");
  assert.equal(last.props["aria-label"], "cats/folder-18");
  const scroll = { scrollTop: 180 };
  initial.find((node) => node.props?.className === "ec-grid").props.ref.current = scroll;
  last.props.onClick();
  assert.equal(scroll.scrollTop, 0);
  const selected = ui.render();
  assert.deepEqual(selected.filter((node) => node.props?.["aria-pressed"] === "true").map((node) => node.props.title), ["cats/folder-18"]);
  assert.equal(selected.find((node) => node.props?.className === "ec-pack-title").props.children[0], "cats/folder-18");
  const cell = selected.find((node) => node.props?.className === "ec-cell");
  assert.equal(cell.props.title, "cats/folder-18/ok");
  cell.props.onClick();
  assert.deepEqual(ui.inserted, [{ token: "[[sticker:cats/folder-18/ok]]", target: ui.span }]);
  assert.ok(!ui.render().some((node) => node.props?.role === "dialog"));
});

test("nested folder labels keep their relative path and refresh falls back after removal", async (t) => {
  const first = pack("memes/angry"), nested = pack("memes/happy/very-long-subfolder-name");
  const ui = await picker(t, [first, nested]);
  const target = ui.render().find((node) => node.props?.title === nested.id && node.props?.className === "ec-pack");
  assert.equal(target.props.children[0], "happy/very-long-subfolder-name");
  target.props.onClick();
  assert.equal(ui.render().find((node) => node.props?.className === "ec-cell").props.title, `${nested.id}/ok`);
  const snapshot = ui.runtime.configStore.get();
  ui.runtime.configStore.set({ ...snapshot, data: { ...snapshot.data, packs: [first] } });
  assert.equal(ui.render().find((node) => node.props?.className === "ec-cell").props.title, `${first.id}/ok`);
});
