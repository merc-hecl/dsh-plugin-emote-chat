/**
 * [INPUT]: 依赖 schemastery 和 Node 路径能力
 * [OUTPUT]: Config、readConfig、toPathList
 * [POS]: Host 配置边界；每次调用读取 volatile 引用，不缓存配置快照
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import z from "@deepseek-ai/schemastery";

/** 四个可热更新字段由宿主 settings 统一写入。 */
export const Config = z.object({
  stickerReply: z
    .boolean()
    .default(false)
    .description(
      "Enable sticker / meme replies: the composer picker, the sticker folders, and the Agent's stickers.",
    )
    .volatile(),
  paths: z
    .array(z.string())
    .default([])
    .description(
      "Sticker folders. Each directory is one pack; nested folders become sub-packs.",
    )
    .volatile(),
  emojiReply: z
    .boolean()
    .default(false)
    .description(
      "Enable emoji replies: the Agent reacts to the message that started the current turn with one emoji.",
    )
    .volatile(),
  emojiRain: z
    .boolean()
    .default(false)
    .description("Draw each fresh emoji reaction as an emoji rain.")
    .volatile(),
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 展开用户目录并以进程目录解析相对路径。 */
function expandPath(input) {
  const trimmed = String(input ?? "")
    .trim()
    .replace(/^"(.*)"$/u, "$1");
  if (trimmed === "") return "";
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

/** 接受路径列表或按行分隔的字符串，统一去重。 */
function toPathList(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/u)
      : [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    for (const line of item.split(/\r?\n/u)) {
      const expanded = expandPath(line);
      if (expanded === "" || seen.has(expanded)) continue;
      seen.add(expanded);
      out.push(expanded);
    }
  }
  return out;
}

/** volatile 字段是稳定引用；每次调用读取 get() 取得最新配置。 */
function unwrapField(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof value.get === "function"
  ) {
    try {
      return value.get();
    } catch {
      return undefined;
    }
  }
  return value;
}

/** Read the effective settings from the row's live config. */
function readConfig(config) {
  const source = isRecord(config) ? config : {};
  return {
    stickerReply: unwrapField(source.stickerReply) === true,
    emojiReply: unwrapField(source.emojiReply) === true,
    emojiRain: unwrapField(source.emojiRain) === true,
    paths: toPathList(unwrapField(source.paths)),
  };
}

export { readConfig, toPathList };
