# dsh-plugin-stickers - DSH 聊天贴纸与消息回应
JavaScript ESM + Cordis + React + esbuild + node:test

<directory>
dsh-plugin-emote-chat/ - 唯一发布包；Host、Client 与业务模块
.agents/ - 项目技能
.scratch/ - 不发布的本地诊断产物
</directory>

<config>
.gitignore - 排除本地技能、依赖、日志和诊断产物
</config>

配置只由宿主 settings 写入；工具与路由共享业务状态。源码单文件不超过 800 行；lib/client.js 是可复现构建产物，不手改。
