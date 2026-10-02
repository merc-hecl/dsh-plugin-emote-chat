# AGENTS.md — design and internals

Architecture notes for `dsh-plugin-emote-chat`. **User-facing usage lives in
[README.md](README.md) / [README.zh.md](README.zh.md); this file is for whoever changes the code.**

Everything below was verified against the **desktop build** (`E:\DSH\resources\app.asar`,
`@deepseek-ai/dsh` 0.2.0-rc.2). The web build may differ; when a fact matters, re-verify against
the desktop asar rather than against a checkout of the web source.

Two rules that came out of the same long debugging session, and that are worth reading before
touching the browser half:

1. **Keep a decorated bubble's `textContent` byte-identical** (§5, "Painting"). Changing it is what
   makes the chat rewrite the DOM over your work.
2. **Never key state on a DOM node the chat renders** (§5, the warning after `reconcile`). It bit
   twice in one session — stickers and reaction chips — with the same symptom both times: it works,
   then it disappears.

Also useful: `yyh-001/dsh-meme` solves the same class of problem and documents its findings in
`test/client-decorate.test.mjs`. Its invariants for decorating chat DOM are the ones adopted here;
when a rendering question comes up again, read that file before experimenting.

---

## 1. Why two packages

The harness registers model-facing tools **only where the `tools` service is declared**. The UI
package cannot reach that registry — verified live: both its own scope and every agent-preset scope
reported no registry at all.

| Package | Half | Responsibility |
|---|---|---|
| `dsh-plugin-emote-chat` | Host + browser | Settings, `/api/emote-chat/*` routes, catalog scan, prompt section, and the whole browser surface |
| `dsh-plugin-emote-chat-tool` | Host | Registers `emote_reply` under `inject: ["tools"]`, the same contract `@deepseek-ai/dsh-tool-cordis` uses |

### The bridge

Two separate rows in two contexts cannot see each other's services. They do share one Node process,
so `lib/bridge.js` (a copy in **both** packages) hangs a slot on `process`:

```js
Symbol.for("dsh-plugin-emote-chat/bridge@1")
```

It carries `react`, `rescan`, `catalog`, and the tool-registered flag. The UI half `publish`es; the
tool half reads.

**One rule learned the hard way:** the tool half must not re-implement anything the UI half owns.
It once carried its own catalog walker, which flattened nested folders — the tool then rejected
stickers the picker offered (`memes/happy/ok` came back as unknown). The duplicate was deleted and
the catalog is read through the bridge. One scanner, one naming rule.

### A second rule: one setting, one owner

**The tool half must not parse a setting the UI half does not write.** It did twice, and both times
the stale reader outlived the feature it belonged to:

| Zombie | How it survived | What it did |
|---|---|---|
| `emojiList` | The UI half stopped writing it when the allow-list was removed, but the tool half still read it — and treated an empty list as "use the built-in 40-emoji fallback". Every other emoji was rejected with "not allowed". | Silently kept a removed restriction alive. It looked like it worked only because the emoji anyone tried first were in the fallback. |
| `to` (the tool argument for naming a target message) | The UI half never used it, and a user message reaches the model as text with no id, so it could never be filled. | Dead argument in the tool's schema, spending attention for nothing. |

Both were invisible from the settings page: the row's config simply stops carrying the key, and a
reader with a default fills the gap. The failing direction is always the same — the tool keeps a
rule the UI has dropped. So when a setting is removed, **grep both packages for its name**, and when
a tool argument is added, check that something can actually supply it.

A third instance is recorded in §5: the tool's result message told the model to write image
Markdown, which contradicted the prompt section and could not have rendered. One instruction, one
wording.

---

## 2. Reactions: one mechanism, one rule

**A reaction binds to the message its stamp names, and to nothing else.** The stamp is the anchor —
the chat node key the browser registered for the message that triggered the turn. Nothing is
inferred from timing or from "which message looks newest".

This is the end state of five attempts. Each removed mechanism is kept here because each one looked
reasonable and failed:

| Removed | Why it failed |
|---|---|
| **"Newest user message"** | A reaction re-chosen on every scan: the 💪 sent for message A moved to message B as soon as B appeared. |
| **Timestamp of the reaction** | Still mis-anchored whenever a message arrived while the reaction was in flight — the message looked newer than the reaction, so it won. |
| **`borrowed` cross-session entries** | The browser's session name and the agent scope's id were assumed to differ; a process-wide pool made the field dead code. |
| **`to` argument (Agent declares the target)** | It required a message id in the model's context. A user message reaches the model as **text only** — verified in the session store, where the user rows carry `prompt` and no id — so the argument could almost never be filled. |
| **Automatic orphan pruning** | Judged "message absent from the loaded DOM" as "message deleted". A long conversation is paged, so it deleted every reaction older than the loaded window. See §4. |

### The anchor's contract

- Registered by the **browser**, because only the browser knows which chat node triggered the turn.
  The tool's execution context carries the agent id and nothing about the chat.
- **Frozen at the turn-triggering message.** A message the user sends while the Agent works (an
  intervention) does **not** move the anchor: it is marked `data-pending-steering` /
  `data-submission-echo` by the build, and both markers are skipped. The accepted consequence is
  that the Agent cannot react to an intervention specifically.
- `POST /api/emote-chat/anchor {session, anchor}` records it; the reaction is stamped with that key.

### Where the browser gets the key

`data-chat-node-key` is `<seq>:input-message<id>`, where `<id>` is the `user/message` event's own
id (verified: ui-chat's `messageDefinition` matches `kind: "input-message"` and takes
`id: String(event.data.id)`).

The id — not the whole key — is what identifies a message, because a queued message is **re-keyed
when it is submitted**. Matching is therefore done on the id substring, and `messageIdOf` is
**idempotent** (a bare id has no marker to strip, so it comes back unchanged — the first version
sliced unconditionally and mangled ids it was given).

---

## 3. Storage

```
$DSH_HOME/storages/emote-chat-reactions.json      # DSH_EMOTE_STORAGE_DIR overrides the directory
```

```json
{"v":1,"seq":7,"at":1790919815181,"rows":[["b1622da0-…-dc24405f9d19",7,"✅"]]}
```

- **The node key is not stored.** It is `13:input-message` + the id, so only the id is kept:
  36 chars instead of 55. The row is `[messageId, seq, emoji]` — a 36-char id, a small integer and
  one emoji, about 47 bytes per reaction.
- **Bounded, not judged.** `MAX_STORED_REACTIONS = 500` (~60 KB), oldest dropped first by
  `boundStoredReactions()`. Which reactions survive depends **only on age**, so there is no state a
  caller can get wrong. This replaced an automatic prune and a manual "clean up the stale ones"
  button; both tried to decide that a particular reaction was no longer needed, and both could be
  wrong. See §4 for the incident.
- **Writes are atomic** (temp file + rename), so a half-written file never replaces a good one.
- **Writes are debounced** (`STORE_DEBOUNCE_MS = 800`) **and flushed on teardown.** The debounce
  exists to coalesce a burst, and its timer is deliberately `unref()`d so it never holds the process
  open — which is exactly what lost reactions: a reaction recorded less than 800 ms before a restart
  had its pending write discarded with the process, and nothing else wrote it either. The plugin's
  disposer now calls `flushStoredReactions()`, which writes **synchronously** (`writeFileSync` +
  `renameSync`), because a process on its way out gives no scheduling guarantee to an awaited write.
  The file is at most ~60 KB, so blocking briefly at shutdown is the right trade. **If you add
  another write path, flush it here too.**
- **Beware `fs` in this module.** The import is `promises as fs` for the async paths; the shutdown
  flush needs `existsSync` / `writeFileSync` / `renameSync`, which live in a separate `node:fs`
  import. Using the promise object's `...Sync` names throws, and the flush's own `catch` swallows it,
  so the flush silently does nothing — which is how the first version of this fix shipped broken.
- **A corrupt or missing file reads as empty**, and `pool.seq` is restored to the highest stored
  sequence so the browser's cursor cannot skip restored entries.
- `resetStore()` exists for tests: the store path is memoised, so a suite that points the plugin at
  a temporary directory has to clear the memo first. It also clears the pool and session logs.

### The pool

One process-wide pool beside the per-session logs. A reaction belongs to a **message**, not to a
conversation, so scoping the store by session was wrong twice: a restart hands out a new session id
and orphaned everything recorded before it, and the browser could not ask for a reaction whose
session it no longer knew.

`GET /api/emote-chat/reactions?since=<poolSeq>` serves the pool. `messageId` rides along because a
restored entry has no stored node key.

---

## 4. The incident that shaped the storage rules

The first version pruned on startup: the browser reported the message ids it could see, and every
reaction whose message was not in that list was deleted. With a `PRUNE_GRACE_MS = 60_000` guard,
this looked safe.

It was not. A long conversation is **paged** — the DOM holds only the loaded window — so every
reaction older than the window was judged an orphan and deleted, in full, on every restart. Six
real reactions were lost before the cause was found. The guard did not help: those reactions were
minutes old, far outside the grace window.

**The distinction it could not make is the important one: "this message is gone" and "this message
is simply not loaded" are identical from the Host.** Consequences now encoded:

1. Nothing is deleted on a guess. The only deletion is the explicit **clear all**, which needs no
   judgement.
2. An unplaceable reaction is **invisible, not wrong** — nothing binds it, so it cannot appear on
   the wrong message. Keeping it is the safe direction, and it reappears if the message is paged
   back in.
3. Growth is handled by the size bound, which cannot be wrong because it uses only age.

---

## 5. The browser half

`lib/client.js` is a self-contained bundle: one `window.__ModuleLoader__.load({ id, factory })`
whose only platform require is `react` (plus `@deepseek-ai/dsh-client-ui-primitives`, which is in
the seed table and needs no `external` declaration). Editing it **hot-swaps** in a running dsh
(`dsh-client-hmr`); Host changes need a restart.

### Slots

| Slot | Purpose |
|---|---|
| `settings.section` | The "Stickers & emoji" page |
| `conversation.input.left` | The composer sticker picker |
| `tool.call.toolview`, key `emote_reply` | The tool card (sticker image or emoji) |

`slots.register` accepts **only** `key/id/order/label/priority/select/inject/children/store/locale/registrant`
— there is **no icon field**. Settings-nav icons are hardcoded in `ui-settings-general`'s
`navIcon(id)`, and an unknown id falls back to the same gear General uses. This is **not
overridable declaratively**.

> A `MutationObserver` that swapped the nav icon was tried and **froze the app**: it replaced DOM
> from inside a `subtree: true` observer, so it re-triggered itself. Fully reverted. Do not retry
> that approach.

### Painting

`createStickerPainter` turns `[[sticker:…]]` tokens into images. **Both sides of the conversation go
through it** — the user's own sticker and the Agent's — because the Agent writes the same token it is
told to write in the prompt section (verified in a session store: the token appears, the
`/api/emote-chat/sticker` markdown URL that the tool *suggests* appears zero times). The chat's own
Markdown renderer is not involved: a user bubble is rendered through `projectUserText`, which
recognises only `@references` and `/commands`, so plain text is all either side gets.

#### The invariant everything else follows from

**A decorated bubble's `textContent` must stay byte-identical to what the user sent.** Replacing a
token with an image changes it, and any surface that compares `textContent` to decide "this message
was modified" then rewrites the DOM — which reverts the image to text, gets decorated again, and
either flickers or disappears for good. Every image is therefore accompanied by a hidden ghost span
carrying the original token verbatim.

Four earlier versions of this function looked for a *safe element to insert into* and all failed the
same way, because position was never the problem. This is the single most important thing to preserve
when changing the painter.

Derived rules:

- **Only message bodies are decorated**: `user`, `steering`, `assistant-step`, `developer-message`.
  The process surfaces (`turn-process`, `turn-trigger`, `turn-error`, `turn-max-tokens`, `turn-tail`,
  `system-prompt`) and the `data-step-process*` / `[data-chat-anchor-key^='call:']` regions are
  excluded — the reasoning preview legitimately *mentions* the token while discussing it, and painting
  it once put a sticker inside the thinking block.
- **The ghost leaves layout entirely** (`display: none` plus `position: absolute`, 0×0, hidden
  overflow). `display: none` alone is not enough: an inline element in the middle of a text run still
  took part in line-box construction on some selection paths, and selecting a reaction chip made the
  bubble break open below the text.
- **The image is hoisted out of the text**, so a sticker renders in the same place wherever the token
  sat, and it is parked in **the element that also holds the bubble** — the chat right-aligns a user's
  message with `align-items: flex-end` there, so the image follows the message to the correct side
  with no positioning of ours. The flow row is only a fallback: it is `display: block`, where
  `margin-left: auto` does nothing and every sticker ends up on the left.
- **The side comes from the message element, passed in directly.** `closest` walks ANCESTORS only and
  `data-chat-flow-kind` sits on the element itself, so asking a text node's ancestor chain for it
  always answered "no flow row" and every sticker was placed left — a user's own sticker came out on
  the wrong side.
- **Whitespace is normalised after the swap**, not per segment: a sticker is sent on its own line, so
  the message is `[[sticker:x]]\nand then this`, and that newline rendered as a blank first line. The
  chat is free to hand the token and the remainder over as separate text nodes, in which case no
  segment owns the whitespace — so the container is trimmed afterwards. Only line breaks are removed;
  the space in `here you go [[sticker:x]]` is meaningful.
- **Unresolvable tags stay visible as text.** Hiding one would delete the user's words with nothing
  put in their place.
- **`reconcile()` re-derives everything from the DOM on every pass.** It walks the recorded ghosts and
  makes sure each still has exactly one image, re-creating it when the chat rewrote the bubble over
  it. There is deliberately **no map from a row element to its images**: React rebuilds rows, so such
  a table goes stale silently — the lookup fails, the image is never put back, and the sticker
  "mysteriously" disappears while the conversation is used. The decoration records itself in the DOM
  instead (each ghost carries the sticker id it stands for), so there is no remembered state to
  invalidate.

> **Do not use a DOM node as a Map key for anything the chat re-renders.** This bit twice in one
> session — the sticker painter's `placedByRow` and the reaction painter's `bound` map — and both
> times the symptom was "it works, then it disappears".

- `createReactionPainter` appends the reaction row **inside the user's bubble**, as a strip at the
  foot of the message. That is the fourth placement tried, and the first the layout supports without
  a trick: the bubble reports `display: block` with `padding: 10px 16px`, so appending puts the row
  on its own line under the text, aligned with it, with no positioning needed. What came before, and
  why each failed:
  - **the flow item** — it also holds the hover action strip, so the row landed below the whole
    message row instead of under the bubble;
  - **the bubble's parent, with negative margins** — a flex child can never cross the bubble's edge,
    and the stack's 8px gap kept re-opening the distance, so the row only ever got *near* the border;
  - **the bubble's parent, with `position: absolute; bottom: -(height/2)`** — this did straddle the
    edge, but it needed `position: relative` written onto a chat-owned element to anchor at all, and
    a glyph centred on the border reads as a smudge rather than a reaction.

#### The assignment is recomputed, never remembered

`assignReactions` is **pure and recomputed on every pass**, from message identities alone.

An earlier version assigned each reaction once, remembered the row it picked, and advanced a cursor
past the entry. That cannot express "not yet placed": a long conversation is **paged**, so the row for
an older reaction is usually absent — and when the user scrolls back, the row returns as a **new
element**, while the remembered one is detached and the cursor has already gone past the entry. The
reaction was then unplaceable forever, and chips silently disappeared as history scrolled out.
Matching fresh each pass compares message **ids**, which survive a rebuilt row, so a chip reappears
the moment its message does.

Observed live before the fix: 9 reactions stored, 3 chips in the DOM, and all 6 missing ones belonged
to messages outside the loaded window.

- **Style rule for the pills:** the fill is `bg-layer-1` (a *surface* token, #ffffff light / #232324
  dark) and the stroke is `border-l2` (the chat's own separator weight). Two token choices looked
  right and failed: `bg-layer-2` is #2c2c2e in the dark theme, *darker* than its #353638 bubble, so
  the pill vanished (contrast 1.15); and `interactive-bg-active`, a translucent wash, cannot produce
  white in the light theme at all — it composited to a grey-blue. The lesson: a wash deepens a
  surface, so "white" requires a surface token.
- `createReplyReactionReader` is a fallback for a composition where the tool registry is out of
  reach: it reads a trailing emoji out of the Agent's own reply and hides it from the rendering. It
  never rewrites the transcript.

### Style rules that were learned from breakage

- **Transitions with `@starting-style`, never `animation` keyframes,** for anything that should
  reveal once. An animation replays for as long as its element exists, so every re-render replayed
  it and flipping a switch flashed the drawer and all the thumbnails.
- **No global `busy` gating.** Disabling all controls during a write rendered as a whole-page
  flicker, because the shipped primitives draw `:disabled` as `opacity: 0.4` with no transition and
  a write takes 35–59 ms — exactly the length of the flash. Writes are idempotent; a failed write is
  reported, a successful one says nothing.
- Separators: `[data-item]:last-child { border-bottom: none }`. A direct-child selector missed the
  nested emoji-rain row and left two stray rules at the bottom of the page.
- Alignment: the row's title line uses `.ec-head-row` (`align-items: flex-start`); folder rows use
  `.ec-path-row` (`center`). Sharing one rule centred the switch against the whole text block.

---

## 6. Verified harness facts

Re-verify against the desktop asar before relying on any of these.

| Fact | Evidence |
|---|---|
| `data-chat-node-key` = `<seq>:input-message<id>` | ui-chat `messageDefinition`: `kind: "input-message"`, `id: String(event.data.id)` |
| Message flow kinds | `MESSAGE_FLOW_KINDS` = `user`, `steering`, `assistant-step`, `developer-message` |
| An intervention is **not** a `user` flow item | A steering message sent mid-turn never appeared in the DOM list of `[data-chat-flow-kind="user"]` |
| Intervention markers | `data-pending-steering`, `data-submission-echo` (ui-chat, set from `pending`/`echo`) |
| No archive event exists | Full asar scan (6404 files): no first-party `archive` event name |
| The archive set is not reachable from a plugin | `archiveSession` is an RPC method that *returns* the set; there is no list method. `useWorkspaces` is injected only into ui-workspace's own slots. The Host getter `WorkspaceRegistry.archivedSessionIds` exists but publishes no change notification |
| A user message carries no id into the model | The session store's user rows are `{prompt, response}`; ids appear only where a human pasted them |
| A user bubble is **plain text**, not Markdown | ui-chat renders it through `projectUserText(text, referenceLabels, skillNames, "skill", references)`, which handles `@references` and `/commands` only. Markdown (`MarkdownText`) is used for assistant and reasoning text |
| A sticker image renders because of **painting**, not Markdown | The Agent writes the token, not the `![](url)` form the tool's result message suggests — verified in a session store: token present, `/api/emote-chat/sticker` URL absent |
| `data-chat-flow-kind` is on the **message element itself** | `closest()` walks ancestors only, so a text node inside the message cannot find it — the reason `sideOf` took the flow element as a parameter |
| The element holding the bubble is the **alignment context** | The bubble's parent reports `display: flex` + `align-items: flex-end` for a user message, which is what right-aligns it; the flow row above reports `display: block`, where `margin-left: auto` has no effect |
| Rows are **rebuilt**, not reused | Both live incidents (vanishing stickers, vanishing reaction chips) came from keying state on a row element that React later replaced |
| Settings nav icons are hardcoded | `ui-settings-general`'s `navIcon(id)`, with a gear fallback for unknown ids |
| `ctx.effect(cb)` is a **synchronous** contract | An async callback returns a Promise, so the returned disposer is lost |
| `ctx.inject([names], cb)` waits for **all** names | This is why the tool package declares its own `inject` |

---

## 7. Diagnostics

Browser console:

```js
__emoteChat.debug()
```

Reports the live switches, the catalog status, every flow carrying a token (and whether it was
painted), each user message's chip host, the reaction entries with their stamps, and the rain log
(`bursts`, `skipped` with the reason and age, `layersInDom`, `stylesheet`). `__emoteChat.mounts()`
reports settings-page mount events — a page that merely re-renders stays at one mount.

Host:

```
GET /api/emote-chat/config?debug=1     # module generation, tool/prompt registration, store stats, anchors
POST /api/emote-chat/seen              # the browser reports the loaded message window (reporting only)
POST /api/emote-chat/clean             # empty the store; the only maintenance action
```

Scripts: `scripts/probe.mjs <base>` signs the browser-session cookie from `$DSH_HOME/.credentials.yaml`
and calls each route (an unauthenticated `/api` request returns `401` whether or not the route
exists, so only the cookie probe proves registration). `scripts/verify.mjs` performs the settings
write; `scripts/boot-graph.mjs` confirms the browser half is in the page's boot manifest.

---

## 8. Tests

```sh
node --test test/                      # in each package
```

- `test/host.test.mjs` — config reading, the catalog scanner (including nested ids), the profile
  patch writer, route publication, store bound and clear, and the anchor route.
- `test/client.test.mjs` — the bundle loads, slots register, the dictionaries are complete, the
  settings page renders (`expand()` calls function components, because `createElement` alone does
  not), and the anchoring rules.
- `test/painter.test.mjs` — the painters against a stub document, including the intervention
  contract.

Two lessons are encoded in the suite:

1. **Assert the rule, not the symptom.** `assignReactions` is a pure function so the anchoring
   rules can be pinned without a DOM.
2. **A fixture must carry a real stamp.** Painter fixtures that relied on the removed "newest
   message" fallback bound to nothing after the change, which is the test doing its job.

A third was learned later:

3. **A stub that is wrong hides the bug you are hunting.** Three defects in `test/painter.test.mjs`
   each made the implementation look broken or correct for the wrong reason: `querySelectorAll`
   always returned `[]` (which hid `findClassFragment` entirely), `remove()` left `__parent` set so a
   detached node still reported a parent (defeating every "is it still attached?" check), and
   `insertBefore` appended a second reference instead of MOVING the node, so hoisting an image left a
   copy behind in the bubble and one token appeared to produce two figures. When a DOM test disagrees
   with the implementation, dump the tree before changing either — the dump found all three.

Also: **silently-ignored arguments are a real hazard here.** After `assignReactions` dropped its
`bound` and `cursor` parameters, four tests kept passing five arguments and still went green. Prefer
rewriting the call sites whenever a signature changes.

Watch out for **cross-realm values**: the bundle runs in its own VM, so an array it produced fails
`deepEqual` reference equality even when structurally identical — compare plain copies.

---

## 9. Style

Comments explain **why**, and records that a mechanism was removed are kept on purpose — they are a
map of dead ends. Every non-obvious constant carries the reason for its value (`RAIN_FRESH_MS`,
`STORE_DEBOUNCE_MS`, `MAX_STORED_REACTIONS`, `PREVIEW_LIMIT`). Prefer deleting a mechanism to
maintaining two that overlap.

### Never put a backtick inside the stylesheet

`const CSS = \`…\`` is one template literal, so **a single backtick in a CSS comment ends it early
and the whole bundle stops parsing** — every client test fails with a syntax error and the page
shows nothing. This has now happened **seven times**, always the same way: a comment explains the
layout and reaches for a markdown-style code span, which is the natural way to write a note in this
file.

The rule: inside the `CSS` template literal, **plain prose only** — no backticks, in comments or
anywhere else. `test/client.test.mjs` → "the stylesheet contains no stray backtick" enforces it by
counting the delimiters and asserting none survive between them; if you need to fix a violation, the
same computation strips them safely:

```js
const bodyStart = text.indexOf("const CSS = " + tick) + ("const CSS = " + tick).length;
const close = text.indexOf(tick + ";", bodyStart);
const css = text.slice(bodyStart, close);
const fixed = css.replace(/\/\*[\s\S]*?\*\//gu, (block) => block.split(tick).join(""));
```

Writing the guard is not enough on its own: it only fires when the suite runs, and the failure it
reports looks like a broken implementation rather than a broken comment. When editing CSS, prefer
prose without code spans at all.

---

## 10. Commits

**Conventional Commits, by default.** The repository is a monorepo of two packages, so the format
carries real information here: it says which half changed without anyone reading the diff.

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

| Type | Use for |
|---|---|
| `feat` | A new capability the user can see — a setting, the picker, a reaction, rain |
| `fix` | A defect. Most of this project's history is `fix` |
| `docs` | `README*`, `AGENTS.md`, comments that carry no behaviour |
| `test` | Test-only changes: new assertions, a repaired stub, a new fixture |
| `refactor` | Same behaviour, different shape. If the output changes, it is not this |
| `chore` | Tooling, `.gitignore`, dependency bumps, release plumbing |
| `perf` | Measurably faster or lighter, with the measurement in the body |

### Scope

The scope is a **package or a surface**, not a file:

| Scope | Covers |
|---|---|
| `host` | `lib/index.js` — routes, config, catalog, storage, the prompt section |
| `client` | `lib/client.js` — settings page, picker, painters, rain |
| `tool` | `dsh-plugin-emote-chat-tool` — the `emote_reply` registry entry |
| `docs` | The four documentation files |
| `deps` | `package.json`, lockfiles |

Omit the scope when a change genuinely spans both halves — a renamed setting, for instance, moves
`host`, `client`, and `tool` together.

### Subject

- **Imperative, lower case, no trailing period**: "keep the transcript's own text intact", not
  "kept" or "Keeps".
- **Say what changed for the user, or what invariant now holds** — not which function you edited.
  `fix(client): keep a decorated bubble's text byte-identical` is reviewable; `fix(client): update
  createStickerPainter` is not.
- Aim for 72 characters.

### Body

Explain **why**, and record what was ruled out. This project's value is largely in its dead ends:
"four placements inside the bubble all failed because React rewrites the subtree" saves the next
person the same four attempts. Wrap at 72 columns.

For a fix, name the symptom that was reported and the cause that was found — they are often not the
same thing, and the difference is the point.

### Footer

`BREAKING CHANGE: <what breaks and what to do>` for an incompatible change. Reference an issue with
`Refs: #12` when there is one.

### Atomicity

**One logical change per commit**, and it must leave the suite green — `node --test test/` in both
packages. A commit that mixes a fix with an unrelated refactor makes the refactor impossible to
revert on its own.

### Examples from this project

```
feat(client): render sticker tokens as images in both directions
fix(client): keep a decorated bubble's text byte-identical

Replacing a token with an image changed the bubble's textContent, and any surface
comparing textContent decided the message had been modified and rewrote the DOM over
it. Four attempts at choosing a "safe" element to insert into all failed for this
reason — position was never the problem. A hidden ghost span now carries the original
token, so the text is unchanged.

Refs: #22
```

```
fix(tool): drop the emoji allow-list the UI half had already removed

The tool kept reading `emojiList`, which the UI half stopped writing, and treated an
empty list as "use the built-in 40-emoji fallback" — so a removed restriction stayed in
force and any emoji outside the fallback was rejected. Grep both packages whenever a
setting is removed.
```

Do not add tool-attribution trailers (`Co-Authored-By`, "Generated with …"). The commit describes
the change, not the tooling.
