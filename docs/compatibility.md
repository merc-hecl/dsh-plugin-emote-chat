# DSH compatibility checks

## DSH Desktop 0.2.2-rc.1 — 2026-11-07

**Result: adaptation required and implemented for message bubbles and session-projection handles.**

- Installed Desktop build: `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8` (clean build), with Cordis 4.1.0.
- Source inspected: the installed Desktop `resources/app.asar`, under `dsh/node_modules/@deepseek-ai/`.
- Scope: Windows Desktop's authenticated Web UI and an isolated process using the installed Cordis, session-projection registry and real Session implementation. A separately installed Web CLI and other operating systems were not tested.

| Area | Contract, adaptation and verification |
|---|---|
| Message bubbles | `dsh-client-ui-chat/lib/client.js` now renders the shared `UserMessageBubble` with `data-message-bubble`. Its CSS class no longer ends in `_bubble`, so the previous selector missed reactions. The painter now prefers the semantic marker; the previous CSS suffix remains a fallback. Two historical reactions appeared inside their correct bubbles in the live demo. |
| Reaction target | `dsh-session-projection/README.md` and `lib/index.js` define awaited registration returning `stateOf(session)` and async `dispose()` handles. Registry-level keyed reads and callable disposers are deprecated. The Host now awaits registration and retains/releases its private handle. An isolated run using the installed host packages verified real Session replay, first-message target locking despite later steering, ended-turn rejection, host-only state, persistence and complete route/tool teardown. |
| Composer | `conversation.input.left`, `captureInsertion()` and `insertText(text, span)` remain available. Selecting a sticker inserted the complete `[[sticker:memes/angry/shengqi]]` tag without sending; the test draft was then cleared. |
| Client loading | The authenticated boot manifest retains the plugin and its three declared client dependencies. The bundle returned HTTP 200. |
| HTTP, assets and settings | Config, reaction snapshot, native settings description and a real sticker returned HTTP 200. Unknown sticker/route controls returned HTTP 404. Live configuration was only read; settings writes are covered by the existing automated tests. |
| Rendering and reload | Three user/Agent sticker images loaded, both reaction chips were restored, and historical reactions created zero rain layers. No plugin warnings or errors were captured in the browser. Fresh live rain was not triggered in this check. |

`npm run check` passed: ESLint, rebuilt `lib/client.js` and **108 tests**. Before the fixes, the updated bubble regression failed because no reaction chip was painted; the async-handle fixture also exposed the old registry reads and disposer assumptions. The previous independent painter/lifecycle/storage checks remain in place.

The running Desktop already uses the rebuilt Client. **Restart DSH to load the Host changes.** The isolated Host verification did not restart the user's running Desktop or alter its reaction store. This revision targets the asynchronous projection-handle contract; the earlier compatibility result below applies to the earlier plugin code.

## DSH Desktop 0.2.1-rc.3 — 2026-10-29

**Result: no plugin code adaptation required for DSH Desktop 0.2.1-rc.3.**

- Plugin: `dsh-plugin-emote-chat` 0.1.5, linked from this repository.
- Installed Desktop build: `be72761ee1a6736ebcdf4f3739363b083ae53c98` (clean build).
- Source inspected: the installed Desktop `resources/app.asar`, under `dsh/node_modules/@deepseek-ai/`.
- Runtime checked: the running Desktop host and its authenticated Web UI on Windows. A separately installed Web CLI and other operating systems were not tested.

### Contracts and results

| Area | Installed contract and verification |
|---|---|
| Client loading | The live `__DSH_BOOT__` manifest includes the plugin and all three declared client dependencies; its bundle returns HTTP 200. |
| Composer | `dsh-client-ui-conversation` still provides `conversation.input.left` with `inputActions.captureInsertion()` and `insertText(text, span)`. Selecting `memes/happy/ok` inserted the complete tag into the draft without sending it. |
| Message rendering | `dsh-client-ui-chat` retains `data-chat-flow-kind`, `data-chat-node-key`, the `input-message` ID marker, and CSS module suffixes used by the painters. Both user and Agent stickers loaded as images in a real conversation. |
| Reaction target | `dsh-session-projection` retains `sessionProjections.register(definition)` and `stateOf(session, key)`, including `stateSchema.parse` and `stateVersion`. Two real Agent turns attached their reactions to the correct initiating messages. |
| Tools | The Agent used sticker discovery and `emote_reply` successfully, producing image replies and stored reactions. |
| Settings | The native settings namespace remained discoverable. Saving the existing values through the plugin's settings route returned HTTP 200 and `{ "ok": true }`; effective configuration remained unchanged. |
| HTTP and assets | Authenticated config, reaction snapshot and sticker requests succeeded. An unknown sticker and an unknown route returned HTTP 404. |
| Rain and reload | A fresh 🎉 reaction produced 26 particles. Reload restored both reaction chips with zero new rain bursts, as expected for historical reactions. |
| Browser health | No uncaught page errors were observed during the demo. |

`npm run check` passed: ESLint, reproducible client build and **108 tests**. The build did not change `lib/client.js`.

### Screenshot provenance

The screenshots in `images/` show the actual plugin running against the installed Desktop host, in a dedicated two-turn demo conversation. The sidebar was collapsed through the UI. The emoji-rain screenshot pauses the real CSS animation at 2.5 seconds to capture its falling particles; it does not substitute a mock effect. No runtime code was changed for the captures.

The locally configured sample artwork is from the `dsh-meme` pack already in use on this machine; see the README acknowledgements. The plugin ships no default sticker catalog.

These results apply to this installed build. Message CSS suffixes and the host projection service remain dependencies to recheck on the next DSH upgrade.
