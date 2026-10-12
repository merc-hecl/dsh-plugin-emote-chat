# src/client/
> L2 | 父级: ../AGENTS.md

runtime.js: 浏览器生命周期入口；单一配置投影、保存后强制刷新、随配置立即启停的单一订阅与宿主 slots
shared.js: 共享状态与统一 GET/POST JSON、标记解析和素材定位；不依赖业务组件
dom.js: 当前 Desktop CSS module 后缀匹配；供两种 painter 定位容器，不支持旧类名结构
feed.js: 当前 epoch/seq 完整快照长轮询；协议校验、禁用退避与卸载取消
stickers.js: 当前消息容器中的可逆贴纸投影；素材移除或宿主重建时清理旧投影、恢复原文与显示状态
reactions.js: 稳定消息 ID 到当前 bubble 的回应投影与 emoji 雨；无旧 key 或旧容器回退
components.js: 分组双栏选择器和设置页；当前输入接口、串行保存与刷新确认、宿主 Toast
styles.js: 组件、胶囊及雨的样式；负责样式挂载和卸载
locale.js: 中英文文案字典；由 runtime 注册到宿主 locale

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
