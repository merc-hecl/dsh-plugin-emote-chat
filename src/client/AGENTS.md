# src/client/
> L2 | 父级: ../AGENTS.md

runtime.js: 浏览器生命周期入口；组装配置投影、单一订阅、DOM 增强与宿主 slots
shared.js: 共享状态与统一 GET/POST JSON、标记解析和素材定位；不依赖业务组件
dom.js: 宿主 CSS module 类名适配；集中 DOM 查找规则供两种 painter 使用
feed.js: epoch/seq 长轮询订阅；完整快照替换、禁用退避与卸载取消
stickers.js: 贴纸标记到图片的 DOM 投影；保留原始文本并在禁用或卸载时还原
reactions.js: 消息 ID 到回应胶囊的 DOM 投影与 emoji 雨；无浏览器目标推断
components.js: 贴纸选择器和设置页；使用配置适配器写入路径及开关
styles.js: 组件、胶囊及雨的样式；负责样式挂载和卸载
locale.js: 中英文文案字典；由 runtime 注册到宿主 locale

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
