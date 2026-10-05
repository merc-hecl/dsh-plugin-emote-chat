# test/
> L2 | 父级: ../AGENTS.md

host.test.mjs: 配置归一化、目录扫描和贴纸完整 ID 的单元测试
client.test.mjs: 生成 bundle 的 VM 测试；覆盖 slots、设置 UI 与回应匹配
painter.test.mjs: 贴纸 DOM 回归；覆盖原文还原、宿主重渲染和不可用素材
reaction-painter.test.mjs: 回应 DOM 回归；覆盖身份、清空、跨 epoch 更新与雨释放
dom-fixture.mjs: 测试专用 ModuleLoader/React/DOM 夹具；不执行真实宿主操作
feed.test.mjs: 受控网络和计时器回归；覆盖快照、退避、重启与取消
regression.test.mjs: Host 组装契约及存储回归；独立临时目录隔离真实配置

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
