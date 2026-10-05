---
description: "DeepSeek Harness 聊天的贴纸与 emoji 回应：输入框贴纸选择器、Agent 可发送贴纸、消息下方的 emoji 回应气泡，以及 emoji 雨效果。"
---

# dsh-plugin-emote-chat

[English](README.md) | 中文

为 DeepSeek Harness 聊天（Web 与 Desktop）提供贴纸与 emoji 回应。

## 功能

### 贴纸

- **输入框左下角的贴纸按钮。** 点开选择表情包，选中的贴纸会插入你正在写的消息里 —— 不会替你发送。
- **你发的贴纸会渲染成图片**，图片在你的那一侧，消息文字在图片下方。
- **Agent 也能发贴纸。** 它用贴纸回应时，图片同样会显示出来。
- **会话记录里保留的是简短标记** `[[sticker:pack/name]]` 而不是图片数据，因此纯文本导出依然可读，
  也不会有图片进入模型上下文。
- **支持 PNG、JPEG、GIF（含动图）、WebP、AVIF、BMP、SVG。**

### emoji 回应

- **Agent 用单个 emoji 回应你的消息。** 回应显示为你消息气泡内的小胶囊（Telegram 风格），
  **不进入回复正文，也不进入聊天历史**，因此不消耗上下文。
- **每条回应固定在触发当前回合的人类消息上。** 执行期间追加的消息不会改变回应目标。
- **重启后回应仍在**，因为它们保存在本地小文件里。
- **历史记录里的回应不会消失。** 向上滚动会话（包括滚动到曾被收起的部分）时，
  每条消息会连同它的回应一起回来。
- **emoji 雨（可选）。** 开启后，每条新回应会以 emoji 雨的形式飘落整个界面。

### 双语

所有文案跟随 Harness 的界面语言（`设置 → 通用 → 语言`）。

## 安装

### Desktop

在 Desktop 的插件管理界面安装包含 `package.json` 的本地插件目录。
Desktop 0.2.0-rc.2 的专用 profile 由应用管理。

### Web

需要可用的 dsh CLI 和 pnpm（`npm install -g pnpm`）。从本地目录安装：

```sh
npx @deepseek-ai/dsh plugin --profile web add link:/你的绝对路径/dsh-plugin-stickers -w
```

安装后重启 dsh 并刷新页面。

<details>
<summary>卸载 Web 插件</summary>

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-emote-chat -w
```

卸载后重启 dsh 并刷新页面。

</details>

## 配置

全部在 **设置 → 贴纸互动** 里：

| 设置项 | 作用 |
|---|---|
| **启用贴纸/表情包回复** | 打开输入框的贴纸按钮，并允许 Agent 发送贴纸。 |
| **表情包/贴纸读取路径** | 每行一个目录。**一个目录就是一个表情包，目录名就是包名。** 仅在贴纸开关打开时显示。 |
| **启用 emoji 回复** | 允许 Agent 用单个 emoji 回应你的消息。 |
| **启用 emoji 雨** | 把每条新回应画成 emoji 雨。仅在 emoji 回复打开时显示。 |

### 表情包路径

把路径指向一个或多个目录：

```
D:\stickers\cats          →  包 "cats"        cats/happy.png   →  [[sticker:cats/happy]]
D:\stickers\reactions     →  包 "reactions"   reactions/ok.gif →  [[sticker:reactions/ok]]
```

- **子目录会成为子包**，所以 `cats/happy/ok.png` 对应 `[[sticker:cats/happy/ok]]`。
- `~` 会展开为你的用户目录。
- 支持格式：`.png` `.jpg` `.jpeg` `.gif` `.webp` `.avif` `.bmp` `.svg`。
- SVG 必须声明尺寸（`width`/`height` 或 `viewBox`），否则渲染可能不符合预期。
- 超过 12 MiB 的文件和超过四层的目录会被跳过。

一个表情包只需要一个装着图片的目录。想造一个小包来试用（一张静态图、两个动图 GIF、一个声明了
尺寸的 SVG）：

```sh
python scripts/make-sample-pack.py            # 生成到 samples/packs/whale
```

需要 Pillow（`pip install pillow`）。把 **表情包/贴纸读取路径** 指向它输出的目录即可。

### 回应存储

回应保存在一个本地小文件里，所以重启后仍在原位：

```
$DSH_HOME/storages/emote-chat-reactions.json
```

上限 **500 条**（约 60 KB），超出后最旧的自动丢弃 —— 不需要你判断哪条已失效。
设置页的 **清空全部回应** 可一次全部删除；你的聊天消息不会受到任何影响。

## 常见问题

| 现象 | 排查方向 |
|---|---|
| `dsh: command not found` | 你用的是 npx 方式 —— 在命令前加 `npx @deepseek-ai/dsh`。 |
| `pnpm was not found`（退出码 127） | 安装它：`npm install -g pnpm`。 |
| `ERR_PNPM_ADDING_TO_ROOT` | 漏了 `-w` 参数。 |
| 装好了但界面没变化 | 重启 dsh 并刷新页面 —— 插件包不会热重载。 |
| 找不到贴纸按钮 | **启用贴纸/表情包回复** 没打开，或页面版本早于安装时间。 |
| 选择器显示「还没有可用表情包」 | **表情包/贴纸读取路径** 为空、目录不存在，或目录里没有受支持的图片。 |
| 某行路径标红 | 该目录不存在，或者它是一个文件而不是目录。 |
| Agent 从不发贴纸 | 需要先配置好可读取的表情包目录，设置保存后才生效。 |
| Agent 从不回应 emoji | 确认 **启用 emoji 回复** 已打开，并重启 dsh 以加载插件。 |
| 贴纸显示成了原始文本 | 该贴纸不在目录里，或页面版本早于安装时间。 |
| 较早的消息里看不到贴纸 | 那部分会话还没加载出来。滚到那条消息，图片会随消息一起回来。 |
| 较早的消息里看不到 emoji 回应 | 同样是会话未加载 —— 长会话界面上只保留已加载的部分。滚到那条消息，回应就出现了。 |
| 没有 emoji 雨 | **启用 emoji 雨** 需要先打开 **启用 emoji 回复**。打开页面前发生的回应只显示为气泡，不播雨。 |
| 重启后回应不见了 | 检查 `$DSH_HOME/storages/` 是否可写；没有该文件时，回应只在当前进程内有效。 |

## 许可证

MIT
