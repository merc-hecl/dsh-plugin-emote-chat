# test/
> L2 | 父级: ../AGENTS.md

host.test.mjs: 跨平台配置路径归一化、目录扫描和贴纸完整 ID 的单元测试；素材路径采用系统原生路径
client.test.mjs: 生成 bundle 的 VM 测试；覆盖 slots、静态设置 UI 与完整消息身份匹配
settings.test.mjs: 真实配置适配器的设置集成回归；覆盖写入、重新读取、扫描结果和通知
release-notes.test.mjs: 临时 Git 仓库验证标签范围、英文分类、贡献者与发布说明 CLI
painter.test.mjs: 贴纸 DOM 回归；覆盖原文还原、宿主重渲染和不可用素材
reaction-painter.test.mjs: 回应 DOM 回归；覆盖身份、清空、跨 epoch 更新与雨释放
dom-fixture.mjs: 测试专用 ModuleLoader/React/DOM fixture；支持实际 painter 的标签、类名与属性选择器
runtime-fixture.mjs: 客户端集成 fixture；模拟 HTTP、计时器、observer 和宿主生命周期
runtime.test.mjs: 真实 apply 的卸载与重载回归；验证资源释放、订阅与在途请求取消
feed.test.mjs: 受控网络和计时器回归；覆盖快照、退避、重启与取消
regression.test.mjs: Host 组装契约及存储回归；独立临时目录隔离真实配置
discovery.test.mjs: 模型素材发现契约；覆盖两级查询、分页边界、刷新、开关及可见输出

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
