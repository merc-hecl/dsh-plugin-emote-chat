# lib/
> L2 | 父级: ../AGENTS.md

index.js: Host 组装入口；可选注入工具与 settings，公开统一业务服务及 HTTP 路由
config.js: Schema 与有效值归一化；每次读取 volatile 引用，避免配置快照过期
catalog.js: 有界目录扫描与完整贴纸 ID 索引；为 HTTP 和工具提供同一素材目录
reactions.js: 会话事件定位回应目标；维护 500 条快照、epoch、长轮询与原子持久化
tool.js: emote_reply JSON Schema 与主动互动指导；按交流场景鼓励回应和贴纸，通过业务服务读取配置、查素材和记录回应
client.js: src/client 的可复现构建产物；适配宿主 ModuleLoader，禁止直接编辑

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
