/**
 * [INPUT]: 依赖 catalog 与注入的业务服务
 * [OUTPUT]: emoteReplyTool、promptTextFor
 * [POS]: 模型适配层；读取同一份有效配置，工具不读磁盘或使用跨包桥
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { findStickerById, stickerIds } from "./catalog.js";
function emoteReplyTool(service) {
  return {
    name: "emote_reply",
    description:
      "React to the user's latest message with one emoji, the way a chat app reaction works, or send a sticker from the configured packs. " +
      "Use it for tone — agreement, amusement, sympathy, a quick acknowledgement. Sticker results provide a token to write into your reply. " +
      "The reaction appears under the user's message and is NOT part of the conversation, so it never replaces a substantive answer. " +
      "At most one call per user turn, and never on consecutive turns unless the user keeps reacting.",
    parameters: {
      // register() 直接接收对象 JSON Schema；字段字典仅用于 defineTool()。
      type: "object",
      properties: {
        emoji: {
          type: "string",
          description:
            "A reaction emoji. Any emoji is accepted. Use alone for a plain reaction.",
        },
        sticker: {
          type: "string",
          description:
            "A sticker id in `pack/name` form, from the pack list in your instructions; it is posted into the conversation.",
        },
      },
      additionalProperties: false,
    },
    output: {
      // required 只能是对象节点上的字段名数组。
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          kind: { type: "string" },
          emoji: { type: "string" },
          sticker: { type: "string" },
          seq: { type: "number" },
          message: { type: "string" },
        },
        required: ["ok", "kind", "message"],
        additionalProperties: false,
      },
      render: (_args, value) => [
        { type: "text", text: String(value?.message ?? "") },
      ],
    },
    presentCall: (args) => ({
      card: "generic",
      title:
        typeof args?.sticker === "string" && args.sticker !== ""
          ? `Sticker ${args.sticker}`
          : `React ${String(args?.emoji ?? "")}`.trim(),
      kind: "other",
      rawInput: args,
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: String(result?.value?.message ?? ""),
      content: result?.content,
    }),
    execute: async (args, exec) => {
      const settings = service.settings();
      if (args?.emoji && args?.sticker)
        throw new Error("pass emoji or sticker, not both");

      const stickerId =
        typeof args?.sticker === "string" ? args.sticker.trim() : "";
      if (stickerId !== "") {
        if (!settings.stickerReply) {
          throw new Error(
            "sticker replies are disabled in Settings → Stickers & emoji",
          );
        }
        const catalog = await service.rescan();
        // 嵌套包名也含斜杠，查找必须匹配完整 ID。
        const sticker = findStickerById(catalog, stickerId);
        if (sticker === undefined) {
          const available = stickerIds(catalog).slice(0, 40).join(", ");
          throw new Error(
            `unknown sticker "${stickerId}"; available — ${available || "(no packs configured)"}`,
          );
        }
        // 工具返回标记指令；浏览器将标记投影为图片，会话保留原文。
        return {
          ok: true,
          kind: "sticker",
          sticker: sticker.id,
          message:
            `Sticker sent: ${sticker.id}. Write this token on its own line in your reply to show it: ` +
            `[[sticker:${sticker.id}]] — the chat renders the image while the transcript keeps the token.`,
        };
      }

      const emoji = typeof args?.emoji === "string" ? args.emoji.trim() : "";
      if (emoji === "") {
        throw new Error(
          "pass either `emoji` (a reaction) or `sticker` (pack/name)",
        );
      }
      if (!settings.emojiReply) {
        throw new Error(
          "emoji reactions are disabled in Settings → Stickers & emoji",
        );
      }
      // ---- 由宿主会话事件确定本轮消息身份 ----
      const sessionId =
        typeof exec?.agent?.id === "string" && exec.agent.id !== ""
          ? exec.agent.id
          : undefined;
      if (sessionId === undefined) {
        throw new Error("no session is attached to this call");
      }
      // 业务服务同时校验完整字素并写入回应快照。
      const entry = service.react(exec.agent, emoji);
      return {
        ok: true,
        kind: "emoji",
        emoji: entry.emoji,
        seq: entry.seq,
        message: `Reacted ${entry.emoji}. Do not repeat the emoji in your reply text — the chip under the user's message shows it.`,
      };
    },
  };
}

function promptTextFor(state, toolRegistered, getSettings) {
  const settings = getSettings();
  const blocks = [];
  if (settings.emojiReply) {
    blocks.push(
      [
        "## Chat reactions",
        "",
        toolRegistered
          ? "You may react to the user's latest message with one emoji through the `emote_reply` tool."
          : "Emoji reactions are enabled, but this session has no `emote_reply` tool; do not write reaction emoji into your reply text.",
        "Use it for tone (agreement, amusement, sympathy, a quick acknowledgement), never instead of a substantive answer, and at most once per user turn.",
        "The reaction is shown under the user's message and is not part of the conversation.",
        // 回应绑定回合触发消息，执行中追加的 steering 不改变目标。
        "Any emoji is accepted. The reaction attaches to the message that started this turn.",
      ].join("\n"),
    );
  }
  if (settings.stickerReply) {
    const packs = state.catalog?.packs ?? [];
    const list = packs
      .slice(0, 12)
      .map(
        (pack) =>
          `- ${pack.id}: ${pack.stickers
            .slice(0, 40)
            .map((sticker) => sticker.name)
            .join(", ")}`,
      )
      .join("\n");
    blocks.push(
      [
        "## Stickers",
        "",
        "The user's sticker folders hold these packs:",
        packs.length === 0
          ? "(no sticker folders are configured or readable yet)"
          : list,
        "",
        "To send a sticker, write its token on its own line in your reply: `[[sticker:pack/name]]`.",
        "The chat renders the image for that token while the transcript keeps the token text, so never describe the image — send the token.",
        "Use a sticker only when it adds tone, at most one per reply, and only names from the packs listed above.",
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

export { emoteReplyTool, promptTextFor };
