/**
 * [INPUT]: 依赖 Node 同步文件系统、宿主 Session 事件与 emoji 分段规则
 * [OUTPUT]: createReactionStore、reactionTarget、assertReactionEmoji
 * [POS]: reaction 的身份、持久化与订阅边界；浏览器不再决定回应目标
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const LIMIT = 500;
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
export function assertReactionEmoji(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const valid =
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(
      text,
    );
  const allowed =
    /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}0-9#*]+$/u.test(
      text,
    );
  if (
    !valid ||
    !allowed ||
    [...text].length > 32 ||
    [...segmenter.segment(text)].length !== 1
  ) {
    throw new Error("pass one complete emoji");
  }
  return text;
}

// ---- 目标来自本轮第一步已提交的人类消息，不受浏览器分页或 steering 影响 ----
export function reactionTarget(agent) {
  const events = agent?.session?.snapshotEvents?.();
  if (!Array.isArray(events))
    throw new Error("reaction requires the owning session event history");
  const start = events.findLastIndex((event) => event.type === "turn/start");
  if (start < 0) throw new Error("no active turn for this reaction");
  if (events.slice(start + 1).some((event) => event.type === "turn/end"))
    throw new Error("the reaction turn has ended");
  let steps = 0;
  let target;
  for (const event of events.slice(start + 1)) {
    if (event.type === "step/start" && ++steps > 1) break;
    if (
      event.type === "user/message" &&
      event.data?.source?.kind === "user" &&
      typeof event.data.id === "string"
    ) {
      target = {
        messageId: event.data.id,
        messageKey: `${event.seq}:input-message${event.data.id}`,
      };
    }
  }
  if (!target)
    throw new Error("this turn was not triggered by a human message");
  return target;
}

export function createReactionStore({ file, logger } = {}) {
  file ??= join(
    process.env.DSH_EMOTE_STORAGE_DIR ??
      join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "storages"),
    "emote-chat-reactions.json",
  );
  let entries = [];
  let seq = 0;
  let timer;
  let dirty = false;
  const epoch = randomUUID();
  const waiters = new Set();
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (saved.v === 1 && Array.isArray(saved.rows)) {
      const unique = new Map();
      for (const [id, index, emoji] of saved.rows.filter(Array.isArray)) {
        if (
          typeof id !== "string" ||
          !id ||
          id.length > 512 ||
          !Number.isSafeInteger(index) ||
          index < 1
        )
          continue;
        try {
          assertReactionEmoji(emoji);
        } catch {
          continue;
        }
        unique.set(index, {
          messageId: id,
          seq: index,
          emoji,
          source: "agent",
          at: saved.at ?? 0,
        });
      }
      entries = [...unique.values()]
        .sort((a, b) => a.seq - b.seq)
        .slice(-LIMIT);
      seq = Math.max(
        Number.isSafeInteger(saved.seq) ? saved.seq : 0,
        ...entries.map((row) => row.seq),
        0,
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT")
      logger?.warn?.(`emote-chat: cannot read reactions: ${error.message}`);
  }
  function wake() {
    for (const done of [...waiters]) done();
  }
  // 小型文件统一同步原子写，避免异步写与退出刷盘抢同一个临时文件。
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return true;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const payload = {
        v: 1,
        seq,
        at: Date.now(),
        rows: entries.map((e) => [e.messageId, e.seq, e.emoji]),
      };
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(payload), { mode: 0o600 });
      renameSync(temporary, file);
      dirty = false;
      return true;
    } catch (error) {
      logger?.warn?.(`emote-chat: cannot save reactions: ${error.message}`);
      return false;
    }
  }
  function changed() {
    dirty = true;
    if (!timer) {
      timer = setTimeout(flush, 800);
      timer.unref?.();
    }
    wake();
  }
  return {
    snapshot: () => ({
      epoch,
      seq,
      reset: true,
      reactions: entries.map((e) => ({ ...e })),
    }),
    add(agent, emoji) {
      const glyph = assertReactionEmoji(emoji);
      const target = reactionTarget(agent);
      const entry = {
        ...target,
        seq: ++seq,
        emoji: glyph,
        at: Date.now(),
        source: "agent",
      };
      entries.push(entry);
      entries = entries.slice(-LIMIT);
      changed();
      return entry;
    },
    clear() {
      const removed = entries.length;
      entries = [];
      seq++;
      changed();
      if (!flush())
        throw new Error("reaction store could not be cleared on disk");
      return removed;
    },
    wait(cursor, clientEpoch, signal, timeout = 25000) {
      if (clientEpoch !== epoch || cursor !== seq || signal?.aborted)
        return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timeoutId);
          waiters.delete(done);
          signal?.removeEventListener("abort", done);
          resolve();
        };
        const timeoutId = setTimeout(done, timeout);
        timeoutId.unref?.();
        waiters.add(done);
        signal?.addEventListener("abort", done, { once: true });
      });
    },
    flush,
    dispose() {
      flush();
      wake();
    },
  };
}
