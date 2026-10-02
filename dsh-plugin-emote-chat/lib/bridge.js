/**
 * The in-process bridge between the two halves of dsh-plugin-emote-chat.
 *
 * The halves are two independent plugin rows, so neither can rely on the other's
 * Cordis services: a context that merely *inherits* a service cannot read it
 * (`ctx.get` returns undefined), and the tool half is the only one the Loader
 * activates where the tool registry exists.
 *
 * They do, however, always share one Node process and one `process` object, and
 * `Symbol.for` is a process-wide registry. That is the rendezvous used here: the
 * UI half publishes its reaction sink, its sticker catalog, and its tool-presence
 * flag into the shared slot, and the tool half consumes whichever are present.
 *
 * Every accessor is defensive: a half must keep working when the other half is
 * absent, disabled, or loaded after it.
 *
 * @module dsh-plugin-emote-chat/bridge (SHARED COPY of dsh-plugin-emote-chat-tool/lib/bridge.js)
 */

/** Process-wide slot key shared by both packages. */
const BRIDGE_KEY = Symbol.for("dsh-plugin-emote-chat/bridge@1");

/** The shape stored in the slot; every field is optional. */
function slot() {
  const existing = process[BRIDGE_KEY];
  if (existing !== undefined) return existing;
  const created = { version: 1 };
  Object.defineProperty(process, BRIDGE_KEY, { value: created, enumerable: false, configurable: true, writable: true });
  return created;
}

/**
 * Publish the UI half's face for the tool half.
 *
 * @param face - `{ react(sessionId, emoji), rescan(), catalog() }`; any key may be absent.
 */
function publish(face) {
  Object.assign(slot(), face);
}

/**
 * Record one reaction from the Agent, or report that no sink is published.
 *
 * @param sessionId - the session the reaction belongs to.
 * @param emoji - one reaction emoji.
 * @returns the recorded entry, or `undefined` when the UI half is not loaded.
 */
function react(sessionId, emoji) {
  const sink = slot().react;
  return typeof sink === "function" ? sink(sessionId, emoji) : undefined;
}

/**
 * Report whether the tool half has registered its tool.
 *
 * @returns true when `emote_reply` is registered for the model.
 */
function toolRegistered() {
  return slot().toolRegistered === true;
}

/**
 * Declare the tool half's registration state.
 *
 * @param registered - whether `emote_reply` is currently registered.
 */
function setToolRegistered(registered) {
  slot().toolRegistered = registered === true;
}

/**
 * Force a catalog rescan through the UI half, when it is loaded.
 *
 * @returns the refreshed catalog, or `undefined` when the UI half is absent.
 */
function rescan() {
  const run = slot().rescan;
  return typeof run === "function" ? run() : undefined;
}

/**
 * Read the sticker catalog the UI half owns.
 *
 * The scanner lives in one place only. A second copy elsewhere drifts from it,
 * and the drift stays invisible until a folder layout exposes it — which is how
 * the tool half came to reject every sticker in a nested pack.
 *
 * @returns the catalog, or `undefined` when the UI half is not loaded.
 */
function catalog() {
  const read = slot().catalog;
  if (typeof read !== "function") return undefined;
  try {
    return read();
  } catch {
    return undefined;
  }
}

export { catalog, publish, react, rescan, setToolRegistered, toolRegistered };
