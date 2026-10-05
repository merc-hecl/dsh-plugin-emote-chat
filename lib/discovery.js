/**
 * [INPUT]: 依赖注入的配置与素材目录服务
 * [OUTPUT]: listStickersTool
 * [POS]: 模型按需发现素材的适配层；分页返回包摘要或完整贴纸 ID，不暴露文件路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

function listStickersTool(service) {
  return {
    name: "list_stickers",
    description:
      "Discover available stickers before choosing one. Call without pack to list sticker packs and their counts; " +
      "then pass a returned pack ID to list its sticker names and complete IDs. " +
      "Results are paginated: when hasMore is true, use nextOffset to read the next page. " +
      "Reuse discovered IDs when appropriate, and call again when you need more choices.",
    parameters: {
      type: "object",
      properties: {
        pack: {
          type: "string",
          description:
            "An exact pack ID returned by this tool, including any nested path. Omit to list packs.",
        },
        offset: {
          type: "integer",
          description:
            "Zero-based integer offset. Default 0; use nextOffset from the previous page.",
        },
        limit: {
          type: "integer",
          description: "Integer page size, 1–100. Default 40.",
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          kind: { type: "string" },
          pack: { type: "string" },
          total: { type: "number" },
          offset: { type: "number" },
          limit: { type: "number" },
          hasMore: { type: "boolean" },
          nextOffset: { type: "number" },
          message: { type: "string" },
          packs: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, count: { type: "number" } },
              required: ["id", "count"],
              additionalProperties: false,
            },
          },
          stickers: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" } },
              required: ["id", "name"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "ok",
          "kind",
          "total",
          "offset",
          "limit",
          "hasMore",
          "message",
        ],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    presentCall: (args) => ({
      card: "generic",
      title: args?.pack
        ? `List stickers: ${args.pack}`
        : "Browse sticker packs",
      kind: "other",
      rawInput: args,
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: String(result?.value?.message ?? ""),
      content: result?.content,
    }),
    execute: async (args = {}) => {
      if (!service.settings().stickerReply)
        throw new Error(
          "sticker replies are disabled in Settings → Stickers & emoji",
        );
      if (args.pack !== undefined && typeof args.pack !== "string")
        throw new Error("pack must be a returned pack ID");
      const offset = args.offset ?? 0;
      const limit = args.limit ?? DEFAULT_LIMIT;
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error("offset must be a non-negative integer");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT)
        throw new Error("limit must be an integer from 1 to 100");
      const packId = args.pack?.trim() ?? "";
      const catalog = await service.rescan();
      const pack = packId
        ? catalog.packs.find((candidate) => candidate.id === packId)
        : undefined;
      if (packId && !pack)
        throw new Error(
          `unknown sticker pack "${packId}"; call list_stickers without pack to discover current packs`,
        );
      // 只返回模型选择素材所需的名称和身份；磁盘路径及图片数据留在宿主。
      const rows = pack
        ? pack.stickers.map(({ id, name }) => ({ id, name }))
        : catalog.packs.map((item) => ({
            id: item.id,
            count: item.stickers.length,
          }));
      const page = rows.slice(offset, offset + limit);
      const hasMore = offset + page.length < rows.length;
      return {
        ok: true,
        kind: pack ? "stickers" : "packs",
        ...(pack ? { pack: pack.id } : {}),
        total: rows.length,
        offset,
        limit,
        hasMore,
        ...(hasMore ? { nextOffset: offset + page.length } : {}),
        ...(pack ? { stickers: page } : { packs: page }),
        message:
          rows.length === 0
            ? "No readable sticker packs are configured."
            : pack
              ? `Listed ${page.length} of ${rows.length} stickers in ${pack.id}. Use a returned ID in [[sticker:ID]] or emote_reply.`
              : `Listed ${page.length} of ${rows.length} packs. Pass a returned pack ID to list its stickers.`,
      };
    },
  };
}

export { listStickersTool };
