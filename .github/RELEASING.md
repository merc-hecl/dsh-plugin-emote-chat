# 发布插件

> 维护者手册；插件的用户安装说明见 [README.zh.md](../README.zh.md)。

## 首次发布前的准备

1. 注册 npm 账号，验证邮箱并启用 2FA。
2. 将发布配置与功能改动提交并推送到 `main`。首次在项目根目录检查、打包并手动发布 `0.1.0`，创建 npm 包：

   ```powershell
   npm run check
   npm pack
   npm login --registry=https://registry.npmjs.org/
   npm publish .\dsh-plugin-emote-chat-0.1.0.tgz --access public --registry=https://registry.npmjs.org/
   npm view dsh-plugin-emote-chat version --registry=https://registry.npmjs.org/
   ```

3. 在 npm 包页面 **Settings → Trusted publishing** 添加 GitHub Actions：

   | 字段 | 值 |
   |---|---|
   | Organization or user | `merc-hecl` |
   | Repository | `dsh-plugin-emote-chat` |
   | Workflow filename | `publish.yml`，不填完整路径 |
   | Environment name | 留空 |
   | Allowed actions | 允许直接 `npm publish` |

4. 同步更新中英文 README，删除“尚未发布到 npm”的说明，提交并推送。无需配置仓库变量或 `NPM_TOKEN`；每个正式 Release 都会通过 OIDC 同步发布 npm。

## 正式 Release

1. 确保工作区干净。修复版本执行 `npm version patch`，功能版本执行 `npm version minor`。该命令会更新包与锁文件、创建提交和 `v版本号` 标签。
2. 执行 `git push origin main` 和 `git push origin v版本号`。首次已手动发布 `0.1.0` 时，自动发布从 `v0.1.1` 等新版本开始，避免重复发布同一 npm 版本。
3. 在仓库 Releases 页面创建 Release，选择对应标签，填写说明，点击 **Publish release**。标签必须为 `v` 加包版本；不要选择 prerelease。
4. 在 Actions 页面查看 `Publish plugin`。测试通过后，工作流上传 `dsh-plugin-emote-chat-版本号.tgz` 并将同一安装包发布到 npm。GitHub 自动生成的源码 ZIP 不是这个安装包。

该工作流必须已包含在发布标签指向的提交中。单独推送标签或保存 Release 草稿不会触发发布。

## 验证与失败恢复

- GitHub：确认 Actions 成功，Release 中存在 `.tgz` 附件。
- npm：执行 `npm view dsh-plugin-emote-chat version --registry=https://registry.npmjs.org/`，确认与 Release 标签对应。
- GitHub 附件上传完成后才进行 npm 发布；npm 失败时，安装包仍可下载。修正授权后可重跑失败工作流，但须先确认该版本尚未在 npm 发布。
- 已发布版本不可覆盖；修改内容应发布新版本。

参考：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
