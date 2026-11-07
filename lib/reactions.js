/**
 * [INPUT]: Node 同步文件系统、现有 schemastery、宿主投影读取句柄与 emoji 分段规则
 * [OUTPUT]: reactionTargetProjection、reactionTarget、createReactionStore、assertReactionEmoji
 * [POS]: 宿主私有回合目标投影与稳定 messageId 存储；仅读取已就绪句柄，不直接读取 Session 历史
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import z from "@deepseek-ai/schemastery";

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
// DSH Desktop 0.2.2-rc.1: the awaited handle owns synchronous state reads.
export const reactionTargetProjection = {
  key: "emote-chat:reaction-target",
  stateVersion: 1,
  stateSchema: {
    // 宿主恢复检查点只调用 parse；复用已有 schema，无需额外校验库。
    parse: z.object({
      status: z.union(["idle", "active", "ended"]).required(),
      steps: z.natural().max(2).required(),
      messageId: z.string().required(),
    }).required(),
  },
  init: () => ({ status: "idle", steps: 0, messageId: "" }),
  apply(state, event) {
    if (event.type === "turn/start")
      return { status: "active", steps: 0, messageId: "" };
    if (state.status !== "active") return state;
    if (event.type === "turn/end") return { ...state, status: "ended" };
    if (event.type === "step/start")
      return state.steps < 2 ? { ...state, steps: state.steps + 1 } : state;
    if (
      state.steps < 2 &&
      event.type === "user/message" &&
      event.data?.source?.kind === "user" &&
      typeof event.data.id === "string"
    )
      return { ...state, messageId: event.data.id };
    return state;
  },
};

export function reactionTarget(agent, projection) {
  if (!agent?.session) throw new Error("reaction requires the owning session");
  const state = projection?.stateOf(agent.session);
  if (!state) throw new Error("reaction target projection unavailable");
  if (state.status === "idle") throw new Error("no active turn for this reaction");
  if (state.status === "ended") throw new Error("the reaction turn has ended");
  if (state.messageId === "")
    throw new Error("this turn was not triggered by a human message");
  return { messageId: state.messageId };
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
      reactions: entries.map((e) => ({ ...e })),
    }),
    add(messageId, emoji) {
      const glyph = assertReactionEmoji(emoji);
      const entry = {
        messageId,
        seq: ++seq,
        emoji: glyph,
        at: Date.now(),
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
