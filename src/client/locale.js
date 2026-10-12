/**
 * [INPUT]: 宿主 locale 文案键约定
 * [OUTPUT]: zh、en；设置说明保留关键行为与限制
 * [POS]: 共享双语文案；由 runtime 注册，组件不维护独立字典
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
const zh = {
  "section.nav": "贴纸互动",
  "section.stickerReply.label": "启用贴纸/表情包回复",
  "section.stickerReply.hint":
    "从输入框发送贴纸，Agent 也可使用。",
  "section.paths.label": "表情包/贴纸读取路径",
  "section.paths.hint":
    "目录名即包名，子目录作为子包。",
  "section.paths.placeholder": "D:\\stickers\\cats",
  "section.paths.add": "添加目录",
  "section.paths.remove": "移除这一行",
  "section.emojiReply.label": "启用 emoji 回复",
  "section.emojiReply.hint":
    "回应显示在消息下方，不计入聊天历史。",
  "section.emojiRain.label": "启用 emoji 雨",
  "section.emojiRain.hint":
    "让 emoji 回应飘落整个页面。",
  "section.save": "保存",
  "section.saveFailed": "保存失败：{message}",
  "section.loadFailed": "无法读取设置：{message}",
  "section.scan": "重新扫描",
  "section.scanned": "{packs} 个表情包 · {stickers} 张图片",
  "section.scanEmpty": "没有找到图片，请检查路径是否存在。",
  "section.scanError": "以下路径不可用：{paths}",
  "section.unavailable": "当前部署没有可写的设置存储，修改只在本进程内生效。",
  "section.loading": "加载中…",
  "picker.open": "发送贴纸/表情包",
  "picker.title": "贴纸",
  "picker.close": "关闭",
  "picker.empty": "还没有可用表情包。请到「设置 → 贴纸互动」里填写表情包路径。",
  "picker.failed": "无法读取表情包目录：{message}",
  "picker.loading": "加载中…",
  "sticker.alt": "贴纸 {name}",
  "sticker.label": "贴纸",
  "reaction.title": "emoji 回应",
  "section.store.label": "emoji 回应存储",
  "section.store.hint":
    "本地保存，重启保留；最多 {limit} 条，自动移除最旧回应。",
  "section.store.clear": "清空全部回应",
  "section.store.cleared": "已清空 {removed} 条。",
  "section.store.clearFailed": "清空失败：{message}",
  "section.store.busy": "处理中…",
};

const en = {
  "section.nav": "Stickers & emoji",
  "section.stickerReply.label": "Enable sticker / meme replies",
  "section.stickerReply.hint":
    "Send stickers from the composer or let the Agent use them.",
  "section.paths.label": "Sticker folders",
  "section.paths.hint":
    "Folder names become pack names; nested folders become sub-packs.",
  "section.paths.placeholder": "D:\\stickers\\cats",
  "section.paths.add": "Add folder",
  "section.paths.remove": "Remove this row",
  "section.emojiReply.label": "Enable emoji replies",
  "section.emojiReply.hint":
    "Reactions appear below messages and stay out of chat history.",
  "section.emojiRain.label": "Enable emoji rain",
  "section.emojiRain.hint":
    "Let emoji reactions rain across the page.",
  "section.save": "Save",
  "section.saveFailed": "Could not save: {message}",
  "section.loadFailed": "Could not read the settings: {message}",
  "section.scan": "Rescan",
  "section.scanned": "{packs} packs · {stickers} images",
  "section.scanEmpty": "No images found — check that the folders exist.",
  "section.scanError": "Unusable paths: {paths}",
  "section.unavailable":
    "This deployment cannot persist settings; changes apply to this process only.",
  "section.loading": "Loading…",
  "picker.open": "Send a sticker",
  "picker.title": "Stickers",
  "picker.close": "Close",
  "picker.empty":
    "No stickers yet. Add sticker folders in Settings → Stickers & emoji.",
  "picker.failed": "Could not read the sticker folders: {message}",
  "picker.loading": "Loading…",
  "sticker.alt": "Sticker {name}",
  "sticker.label": "Sticker",
  "reaction.title": "Emoji reaction",
  "section.store.label": "Reaction storage",
  "section.store.hint":
    "Saved locally across restarts. Keeps up to {limit} reactions, removing the oldest automatically.",
  "section.store.clear": "Clear all reactions",
  "section.store.cleared": "Cleared {removed}.",
  "section.store.clearFailed": "Could not clear: {message}",
  "section.store.busy": "Working…",
};

export { zh, en };
