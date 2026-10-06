---
description: "Stickers and emoji reactions for the DeepSeek Harness chat: a composer sticker picker, stickers the Agent can send, emoji reactions under your message, and an emoji-rain effect."
---

# dsh-plugin-emote-chat

English | [中文](README.zh.md)

Stickers and emoji reactions for the DeepSeek Harness chat — Web and Desktop.

## What it adds

### Stickers

- **A sticker button at the composer's left edge.** It opens a pack browser and inserts the
  sticker you pick into the message you are writing. Nothing is sent for you.
- **Stickers you send appear as images**, with the image on your side of the conversation and the
  message text below it.
- **The Agent sends stickers too.** It can browse your available packs and stickers when needed,
  then choose one to include in its reply. The image appears just the same.
- **Your transcript keeps the short tag** `[[sticker:pack/name]]` instead of any image data, so a
  plain-text export stays readable and no image ever goes to the model.
- **PNG, JPEG, GIF (animated), WebP, AVIF, BMP, SVG.**

### Emoji reactions

- **The Agent reacts to your message with one emoji.** The reaction appears as a small chip inside
  your message bubble — Telegram style. It never enters the reply text and never enters the
  conversation history, so it costs no context.
- **Each reaction stays with the human message that started the turn.** Messages added while the Agent is working do not move it.
- **Reactions survive a restart**, because they are kept in a small local file.
- **History keeps its reactions.** When you scroll back into a conversation — including into parts
  that had been collapsed — each message brings its reactions back with it.
- **Emoji rain (optional).** With the rain switch on, each fresh reaction falls across the window.

### Both languages

Every label follows the harness UI language (`Settings → General → Language`).

## Install

### Desktop

Download the `.tgz` plugin package from [Releases](https://github.com/merc-hecl/dsh-plugin-emote-chat/releases),
extract it, then install the extracted `package` directory containing `package.json` through Desktop plugin management.
If no release is available yet, download and extract the [source archive](https://github.com/merc-hecl/dsh-plugin-emote-chat/archive/refs/heads/main.zip)
and install its root directory instead. Both include the prebuilt client.
Desktop 0.2.0-rc.2 manages its own profile.

### Web

You need the dsh CLI and pnpm (`npm install -g pnpm`). Download and extract the package or source archive above,
then install its directory:

```sh
npx @deepseek-ai/dsh plugin --profile web add link:/absolute/path/to/plugin-directory -w
```

Restart dsh and refresh the page after installation.

### npm

The plugin has not been published to npm yet. Once it is published, you can install it with:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-emote-chat -w
```

For installation issues, [open an issue](https://github.com/merc-hecl/dsh-plugin-emote-chat/issues).

<details>
<summary>Remove the Web plugin</summary>

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-emote-chat -w
```

Restart dsh and refresh the page afterwards.

</details>

## Configure

Everything lives in **Settings → Stickers & emoji**:

| Setting | What it does |
|---|---|
| **Enable sticker / meme replies** | Turns on the composer sticker button and lets the Agent send stickers. |
| **Sticker folders** | One folder per line. Each folder is one pack, and the folder name is the pack name. Shown only while stickers are on. |
| **Enable emoji replies** | Lets the Agent react to your message with one emoji. |
| **Enable emoji rain** | Draws each fresh reaction as rain. Shown only while emoji replies are on. |

### Sticker folders

Point the field at one or more directories:

```
D:\stickers\cats          →  pack "cats"        cats/happy.png  →  [[sticker:cats/happy]]
D:\stickers\reactions     →  pack "reactions"   reactions/ok.gif →  [[sticker:reactions/ok]]
```

- **A sub-folder becomes a sub-pack**, so `cats/happy/ok.png` is `[[sticker:cats/happy/ok]]`.
- `~` expands to your home directory.
- Supported files: `.png` `.jpg` `.jpeg` `.gif` `.webp` `.avif` `.bmp` `.svg`.
- An SVG must declare a size (`width`/`height` or a `viewBox`), otherwise it may paint unpredictably.
- Files over 12 MiB and folders deeper than four levels are skipped.

### Reaction storage

Reactions are kept in a small local file so they are still there after a restart:

```
$DSH_HOME/storages/emote-chat-reactions.json
```

It holds at most **500** reactions (about 60 KB). Past that, the oldest are dropped. Nothing asks
you to decide which reaction is stale. **Clear all reactions** in the settings removes them all at
once; your messages are never touched.

## Troubleshooting

| Symptom | What to check |
|---|---|
| `dsh: command not found` | You are using the npx-only route — prefix the command with `npx @deepseek-ai/dsh`. |
| `pnpm was not found` (exit 127) | Install it: `npm install -g pnpm`. |
| `ERR_PNPM_ADDING_TO_ROOT` | The `-w` flag is missing. |
| Installed, but the UI is unchanged | Restart dsh and refresh the page. Plugin bundles do not hot-reload. |
| The sticker button is missing | **Enable sticker / meme replies** is off, or the page is older than the install. |
| The picker says "No stickers yet" | **Sticker folders** is empty, the folders do not exist, or they hold no supported images. |
| A folder line is highlighted red | That directory is missing or is a file, not a directory. |
| The Agent never sends stickers | Sticker folders must be configured and readable before the setting takes effect. |
| The Agent never reacts with an emoji | Check that **Enable emoji replies** is on, then restart dsh to load the plugin. |
| A sticker shows as raw text | The sticker is not in the catalog, or the page is older than the install. |
| A sticker is missing from an older message | That part of the conversation is not loaded yet. Scroll to it — the image comes back with the message. |
| A reaction chip is missing from an older message | Same reason: only the loaded part of a long conversation is on screen. Scroll to the message and its reaction appears. |
| No emoji rain | **Enable emoji rain** needs **Enable emoji replies** on. A reaction from before you opened the page shows as a chip, not as rain. |
| Reactions vanished after a restart | Check that `$DSH_HOME/storages/` is writable; without the file, reactions are per-session. |

## Acknowledgements

The sticker interaction design draws on these projects:

- [yyh-001/dsh-meme](https://github.com/yyh-001/dsh-meme): representing stickers as text in the conversation while rendering images in the chat UI.
- [william-jin-cmu/dsh-stickers](https://github.com/william-jin-cmu/dsh-stickers): user and Agent sticker interactions backed by a shared catalog, with guidance for proactive Agent use.

Thanks to their authors for sharing these designs and implementations.

## License

MIT
