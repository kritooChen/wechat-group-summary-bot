# WeChat Group Summary Bot

普通微信群 AI 总结机器人。机器人账号进群后，群里 `@机器人 总结`，它会总结缓存到的近期文字聊天。
也可以直接 `@机器人` 提问，让它帮忙制定计划、整理思路或回答问题。

## 注意

个人微信机器人没有稳定官方接口，可能遇到扫码登录失败、掉线、风控或封号。建议使用不重要的小号，并先征得群成员同意。

## 准备

1. 安装 Node.js 18 或更新版本，并确认 `npm` 可用。
2. 在本目录运行：

```bash
npm run check
npm install
cp .env.example .env
```

3. 编辑 `.env`，填入新生成的 DeepSeek API Key：

```bash
AI_API_KEY=你的 DeepSeek API Key
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
AI_THINKING=disabled
```

如果想用更强的模型，可以把 `AI_MODEL` 改成 `deepseek-v4-pro`。如果想启用思考模式，把 `AI_THINKING` 改成 `enabled`。

可以在 `.env` 里调整机器人的性格和语气：

```bash
BOT_PERSONA=温暖、机灵、靠谱，有一点轻松的幽默感，但不过度卖萌。
BOT_TONE=中文口语化，简洁但不冷冰冰。
BOT_EMOJI_STYLE=可以少量使用微信表情码，比如 /强、/抱拳、/呲牙。每条回复最多用 0-2 个。
```

先测试模型配置：

```bash
npm run test:ai
```

## 启动

```bash
npm start
```

终端出现二维码后，用准备用作机器人的微信号扫码登录。把这个微信号拉进微信群。

## 群内指令

```text
@机器人 总结
@机器人 总结最近100条
@机器人 总结今天
@机器人 总结本周
@机器人 总结最近2小时
@机器人 提取待办
@机器人 搜索群聊 关键词
@机器人 状态
@机器人 帮助
@机器人 帮我们定一个计划
@机器人 问 这个方案怎么安排
@机器人 搜索 某个概念
@机器人 联网搜索 最新消息
```

机器人会把近期文字消息保存到 `data/messages.json`，重启后会自动恢复缓存。可以在 `.env` 里用 `MESSAGE_STORE_PATH` 修改保存位置。
普通聊天会自动带上最近 30 条群聊作为上下文，可以在 `.env` 里用 `CHAT_CONTEXT_MESSAGES` 调整。`搜索群聊` 是查本地聊天记录。
群聊记录按当前群隔离：机器人只能总结、搜索和回答当前群的聊天内容。有人在一个群里要求查看另一个群、所有群或跨群记录时，会直接拒绝。
安全默认值：机器人不会保存 @ 它的指令消息；会脱敏 API Key、token、密码、Cookie 等敏感串；不会在群里展示本地历史文件路径；默认不按同名群迁移历史，避免两个同名群串数据。

如果要真正联网搜索，在 `.env` 配置：

```bash
TAVILY_API_KEY=你的 Tavily API Key
WEB_SEARCH_MAX_RESULTS=5
```

配置后，`@机器人 联网搜索 最新消息` 会搜索网页并返回来源。为了避免把群聊内容误发给外部搜索服务，只有明确使用 `联网搜索`、`网上搜索` 或 `实时搜索` 才会调用联网搜索；`搜索群聊` 只查本群本地记录。

可选安全配置：

```bash
REDACT_SENSITIVE_DATA=true
ENABLE_ROOM_NAME_HISTORY_MIGRATION=false
```
