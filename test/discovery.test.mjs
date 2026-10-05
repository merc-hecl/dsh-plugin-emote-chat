/**
 * [INPUT]: node:test、素材发现工具与模型提示词适配层
 * [OUTPUT]: 两级查询、分页、目录刷新、配置门控与模型可见结果契约测试
 * [POS]: 素材发现消费者回归；验证完整 ID 和文本输出，不访问真实文件或宿主
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { listStickersTool } from "../lib/discovery.js";
import { promptTextFor } from "../lib/tool.js";

function fixture(packs) {
  const config = { stickerReply: true, emojiReply: true };
  let scans = 0;
  const catalog = { packs };
  const tool = listStickersTool({
    settings: () => config,
    rescan: async () => {
      scans++;
      return catalog;
    },
  });
  return { config, catalog, tool, scans: () => scans };
}
const sticker = (id, name = id.split("/").pop()) => ({
  id,
  name,
  file: "private-path",
  bytes: 999,
  etag: "private-hash",
});

test("pack discovery paginates summaries and exposes them in model-visible output", async () => {
  const app = fixture(
    Array.from({ length: 55 }, (_, i) => ({
      id: `pack-${i}`,
      stickers: [sticker(`pack-${i}/happy`)],
    })),
  );
  const first = await app.tool.execute({});
  assert.equal(first.kind, "packs");
  assert.equal(first.total, 55);
  assert.equal(first.packs.length, 40);
  assert.equal(first.nextOffset, 40);
  const second = await app.tool.execute({ offset: first.nextOffset });
  assert.equal(second.packs.length, 15);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextOffset, undefined);
  assert.equal(
    new Set([...first.packs, ...second.packs].map((p) => p.id)).size,
    55,
  );
  assert.deepEqual(
    JSON.parse(app.tool.output.render({}, second)[0].text),
    second,
  );
  assert.equal(first.stickers, undefined);
});

test("nested pack query returns complete sticker IDs with no filesystem data", async () => {
  const app = fixture([
    {
      id: "cats/happy",
      stickers: Array.from({ length: 61 }, (_, i) =>
        sticker(`cats/happy/item-${i}`),
      ),
    },
  ]);
  const first = await app.tool.execute({ pack: "cats/happy", limit: 50 });
  const second = await app.tool.execute({
    pack: first.pack,
    offset: first.nextOffset,
    limit: 50,
  });
  assert.equal(first.total, 61);
  assert.equal(second.stickers.length, 11);
  assert.equal(second.stickers[0].id, "cats/happy/item-50");
  assert.deepEqual(Object.keys(second.stickers[0]).sort(), ["id", "name"]);
  assert.doesNotMatch(
    app.tool.output.render({}, second)[0].text,
    /private-path|private-hash/,
  );
  assert.equal(second.hasMore, false);
});

test("each discovery reads current catalog and observes volatile enablement", async () => {
  const app = fixture([{ id: "old", stickers: [sticker("old/ok")] }]);
  await app.tool.execute({});
  app.catalog.packs = [{ id: "new", stickers: [sticker("new/ok")] }];
  assert.deepEqual((await app.tool.execute({})).packs, [
    { id: "new", count: 1 },
  ]);
  await assert.rejects(
    app.tool.execute({ pack: "old" }),
    /unknown sticker pack/,
  );
  app.config.stickerReply = false;
  await assert.rejects(app.tool.execute({}), /disabled/);
  assert.equal(app.scans(), 3);
});

test("invalid page bounds are rejected before scanning", async () => {
  const app = fixture([]);
  for (const offset of [-1, 0.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(app.tool.execute({ offset }), /offset/);
  }
  for (const limit of [0, 101, 0.5, "40"]) {
    await assert.rejects(app.tool.execute({ limit }), /limit/);
  }
  await assert.rejects(app.tool.execute({ pack: 1 }), /pack/);
  assert.equal(app.scans(), 0);
});

test("empty and exhausted pages terminate without inventing a continuation", async () => {
  const empty = await fixture([]).tool.execute({});
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.packs, []);
  assert.equal(empty.hasMore, false);
  const exhausted = await fixture([
    { id: "cats", stickers: [sticker("cats/ok")] },
  ]).tool.execute({ pack: "cats", offset: 100 });
  assert.deepEqual(exhausted.stickers, []);
  assert.equal(exhausted.hasMore, false);
  assert.equal(exhausted.nextOffset, undefined);
});

test("guidance depends only on capabilities and teaches discovery without a catalog", () => {
  const enabled = { stickerReply: true, emojiReply: true };
  const prompt = promptTextFor(true, () => enabled);
  assert.match(prompt, /list_stickers/);
  assert.match(prompt, /nextOffset/);
  assert.doesNotMatch(prompt, /hold these packs|no sticker folders/);
  const unavailable = promptTextFor(false, () => enabled);
  assert.doesNotMatch(unavailable, /list_stickers/);
  const disabled = promptTextFor(true, () => ({
    ...enabled,
    stickerReply: false,
  }));
  assert.doesNotMatch(disabled, /list_stickers|## Stickers/);
});
