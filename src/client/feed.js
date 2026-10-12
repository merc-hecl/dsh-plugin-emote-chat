/**
 * [INPUT]: 依赖共享 HTTP 与状态工具，读取 Host 的 epoch/revision 快照
 * [OUTPUT]: createReactionFeed
 * [POS]: 页面唯一 reaction 订阅；仅接受当前 epoch/seq/完整快照协议，退出取消网络与等待
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { API, STORE_LIMIT, createStore, getJson } from "./shared.js";
export function createReactionFeed() {
  const store = createStore({ entries: [], status: "connecting" });
  const controller = new AbortController();
  let epoch = "";
  let cursor = 0;
  let primed = false;
  let disposed = false;
  let timer;
  let wake;
  const pause = (ms) =>
    new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });
  async function pump() {
    while (!disposed) {
      const started = Date.now();
      let delay = 100;
      try {
        const payload = await getJson(
          API +
            "/reactions?since=" +
            cursor +
            "&epoch=" +
            encodeURIComponent(epoch) +
            "&wait=1",
          controller.signal,
        );
        if (disposed) return;
        if (typeof payload?.epoch !== "string" || !payload.epoch ||
            !Number.isSafeInteger(payload.seq) || payload.seq < 0 ||
            typeof payload.enabled !== "boolean" || !Array.isArray(payload.reactions))
          throw new Error("invalid reaction snapshot");
        const sameEpoch = epoch === payload.epoch;
        const previous = new Map(
          store.get().entries.map((entry) => [entry.seq, entry]),
        );
        const entries = (
          payload.enabled === false ? [] : payload.reactions
        )
          .slice(-STORE_LIMIT)
          .map((entry) => ({
            ...entry,
            key: `${payload.epoch}:${entry.seq}`,
            live:
              sameEpoch && previous.has(entry.seq)
                ? previous.get(entry.seq).live
                : primed && sameEpoch && entry.seq > cursor,
          }));
        epoch = payload.epoch;
        cursor = payload.seq;
        primed = true;
        store.set({ entries, status: "ready" });
        delay = payload.enabled === false ? 2500 : 100;
      } catch (error) {
        if (disposed || error.name === "AbortError") return;
        store.set({ ...store.get(), status: "error" });
        delay = 2500;
      }
      if (!disposed) await pause(Math.max(0, delay - (Date.now() - started)));
    }
  }
  void pump();
  return {
    store,
    dispose() {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      wake?.();
    },
  };
}
