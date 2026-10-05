/**
 * [INPUT]: 宿主 locale 文案键约定
 * [OUTPUT]: zh、en
 * [POS]: 共享双语文案；由 runtime 注册，组件不维护独立字典
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
const zh = {
  "section.nav": "贴纸互动",
  "section.stickerReply.label": "启用贴纸/表情包回复",
  "section.stickerReply.hint":
    "开启后输入框左下角出现贴纸按钮，Agent 也可以回复表情包。",
  "section.paths.label": "表情包/贴纸读取路径",
  "section.paths.hint":
    "每个目录是一个表情包，目录名就是包名；子目录会成为子包。支持 png、jpg、gif、webp、svg。",
  "section.paths.placeholder": "D:\\stickers\\cats",
  "section.paths.add": "添加目录",
  "section.paths.remove": "移除这一行",
  "section.emojiReply.label": "启用 emoji 回复",
  "section.emojiReply.hint":
    "开启后 Agent 会用 emoji 回应你的消息；emoji 显示在消息下方，不进入聊天历史。",
  "section.emojiRain.label": "启用 emoji 雨",
  "section.emojiRain.hint":
    "开启后 Agent 的 emoji 回应会以 emoji 雨的形式飘落整个界面。",
  "section.save": "保存",
  "section.saveFailed": "保存失败：{message}",
  "section.loadFailed": "无法读取设置：{message}",
  "section.scan": "重新扫描",
  "section.scanned": "已找到 {packs} 个表情包、{stickers} 张图片。",
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
    "回应保存在本地文件里，因此重启后仍在原位。存储上限 {limit} 条，超出后最旧的自动丢弃 —— 不需要你判断哪条已失效。",
  "section.store.clear": "清空全部回应",
  "section.store.cleared": "已清空 {removed} 条。",
  "section.store.clearFailed": "清空失败：{message}",
  "section.store.busy": "处理中…",
};

const en = {
  "section.nav": "Stickers & emoji",
  "section.stickerReply.label": "Enable sticker / meme replies",
  "section.stickerReply.hint":
    "Adds a sticker button at the composer's left edge and lets the Agent reply with stickers.",
  "section.paths.label": "Sticker folders",
  "section.paths.hint":
    "Each directory is one pack and its folder name is the pack name; nested folders become sub-packs. PNG, JPG, GIF, WebP, and SVG are supported.",
  "section.paths.placeholder": "D:\\stickers\\cats",
  "section.paths.add": "Add folder",
  "section.paths.remove": "Remove this row",
  "section.emojiReply.label": "Enable emoji replies",
  "section.emojiReply.hint":
    "The Agent reacts to your messages with one emoji, shown under the message instead of entering the chat history.",
  "section.emojiRain.label": "Enable emoji rain",
  "section.emojiRain.hint":
    "Draws the Agent's emoji reply as an emoji rain across the conversation.",
  "section.save": "Save",
  "section.saveFailed": "Could not save: {message}",
  "section.loadFailed": "Could not read the settings: {message}",
  "section.scan": "Rescan",
  "section.scanned": "Found {packs} packs with {stickers} images.",
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
    "Reactions are kept in a local file, which is why they survive a restart. The store holds at most {limit} of them; past that the oldest are dropped — nothing here asks you to judge which reaction is stale.",
  "section.store.clear": "Clear all reactions",
  "section.store.cleared": "Cleared {removed}.",
  "section.store.clearFailed": "Could not clear: {message}",
  "section.store.busy": "Working…",
};

export { zh, en };
