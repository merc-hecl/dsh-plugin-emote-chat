# dsh-plugin-emote-chat - DSH 聊天贴纸与消息回应
JavaScript ESM + Cordis + React + esbuild + node:test

<directory>
lib/ - Host 业务模块及生成的 Client 入口；见 lib/AGENTS.md
src/ - 浏览器源码；见 src/AGENTS.md
scripts/ - 构建与宿主诊断；见 scripts/AGENTS.md
test/ - 单元、DOM、订阅与宿主契约测试；见 test/AGENTS.md
.github/ - Release 打包与 npm 同步发布；见 .github/AGENTS.md
.agents/ - 本地项目技能，不发布
.scratch/ - 本地诊断产物，不发布
</directory>

<config>
package.json - 唯一发布包；Host/Client 入口、构建、静态检查及测试命令
package-lock.json - npm 构建与开发依赖锁定
cordis.patch.yml - 单 Host row，Client 由 package manifest 发现
eslint.config.mjs - 源码未定义标识符及未使用变量检查
.gitignore - 排除本地技能、依赖、日志和诊断产物
.gitattributes - 仓库文本行尾规则
README.md、README.zh.md - 插件功能、安装、配置与使用说明
LICENSE - MIT
</config>

仓库根目录即插件包根目录。配置只由宿主 settings 写入；工具与路由共享业务状态。源码单文件不超过 800 行；lib/client.js 是可复现构建产物，不手改。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
