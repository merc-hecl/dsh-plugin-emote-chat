/**
 * [INPUT]: 依赖 catalog 与注入的业务服务
 * [OUTPUT]: emoteReplyTool、promptTextFor
 * [POS]: 模型适配层；按情绪与交流场景引导主动互动，执行读取同一份有效配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { findStickerById, stickerIds } from "./catalog.js";
function emoteReplyTool(service) {
  return {
    name: "emote_reply",
    description:
      "Express a natural reaction to the user's message with an emoji, or choose a fitting sticker from the available packs. " +
      "Use proactively for acknowledgement, encouragement, celebration, amusement, sympathy, and playful conversation. " +
      "Emoji reactions appear on the message that started this turn. Sticker results provide a token to include in your reply. " +
      "Continue answering the user's request alongside the reaction. " +
      "Pass exactly one of emoji or sticker per call; you may use both in a turn through separate calls. " +
      "One emoji reaction and one sticker per turn are enough.",
    parameters: {
      // register() 直接接收对象 JSON Schema；字段字典仅用于 defineTool()。
      type: "object",
      properties: {
        emoji: {
          type: "string",
          description:
            "One complete emoji that fits the user's message and tone. Pass emoji alone to attach a reaction to the message that started this turn.",
        },
        sticker: {
          type: "string",
          description:
            "A fitting sticker id in `pack/name` form from the available pack list. Pass sticker alone; the result gives a token to include in your reply.",
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
            `Sticker ready: ${sticker.id}. Write this token on its own line in your reply to show it: ` +
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
        message: `Reacted ${entry.emoji}. The emoji is already displayed on the user's message. Continue with your normal answer.`,
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
          ? "Use emoji reactions proactively as a natural part of the conversation through the `emote_reply` tool."
          : "Emoji reactions are enabled, but this session has no `emote_reply` tool; do not write reaction emoji into your reply text.",
        ...(toolRegistered
          ? [
              "React when the user's message expresses an emotion, shares progress, asks for encouragement, thanks you, jokes, or confirms a decision.",
              "Choose an emoji that fits the message's meaning and tone. Any complete emoji is accepted.",
              // 回应绑定回合触发消息，执行中追加的 steering 不改变目标。
              "Attach the reaction to the message that started this turn, then continue with your normal answer. The emoji is displayed on that message.",
              "One emoji reaction per turn is enough. You can also include a fitting sticker in the same turn.",
            ]
          : []),
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
        "Use stickers proactively to make the conversation expressive and personal.",
        "A fitting sticker is welcome when celebrating progress, offering encouragement, sharing amusement, acknowledging frustration, or responding playfully.",
        "Choose a sticker from the available packs and write its token on its own line in your reply: `[[sticker:pack/name]]`.",
        "The chat renders the token as an image while the transcript keeps the token text.",
        "Let the sticker complement your answer. Usually one sticker per reply is enough.",
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

export { emoteReplyTool, promptTextFor };
