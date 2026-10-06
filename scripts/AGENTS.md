# scripts/
> L2 | 父级: ../AGENTS.md

build.mjs: esbuild 构建入口；将浏览器模块打包为宿主 ModuleLoader 工厂
boot-graph.mjs: 只读启动图诊断；检查认证页面清单与插件 bundle 路由
probe.mjs: 只读 HTTP 诊断；用本地认证测试插件的准确路由
verify.mjs: 宿主 settings 契约诊断；默认只读，显式 --write 时通过 revision 写配置

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
