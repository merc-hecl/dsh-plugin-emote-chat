---
description: "The model-facing half of dsh-plugin-emote-chat: registers the emote_reply tool, which lets the Agent attach one sticker or emoji reaction to a message."
---

# dsh-plugin-emote-chat-tool

The companion package of [dsh-plugin-emote-chat](../dsh-plugin-emote-chat/README.md).

**You do not install or configure this package on its own.** It exists because the DeepSeek
Harness registers model-facing tools only where the tool registry lives, and that is a scope the UI
package cannot reach. Install it next to the UI package, in the same profile — the UI package's
patch activates this one. See the [main README](../dsh-plugin-emote-chat/README.md#install) for the
two install commands.

## What it does

Registers one tool for the model, `emote_reply`, with two optional arguments:

| Argument | Effect |
|---|---|
| `sticker` | Sends a sticker by its id (`pack/name`). The chat renders the image; your transcript keeps the tag. |
| `emoji` | Attaches one emoji reaction to the message the Agent is answering. It shows as a chip under that message and never enters the conversation history. |

The tool is offered to the model only while the matching switch is on in
**Settings → Stickers & emoji**, and the pack list the model sees comes from the sticker folders you
configured there.

## Requirements

- `dsh-plugin-emote-chat` installed in the same profile
- The relevant switch enabled: **Enable sticker / meme replies** for stickers, **Enable emoji
  replies** for reactions
- Sticker folders configured and readable, for stickers

If the Agent never sends stickers or never reacts, check `plugin_manager list_plugins`: this
package's row should be `active`, and a row that failed to activate reports the reason.

## Test

```sh
node --test test/
```

## License

MIT
