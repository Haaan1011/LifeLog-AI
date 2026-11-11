# 微信个人主体权限与外部接口边界

核对日期为 2026 年 11 月 10 日。微信旧版 `offiaccount` 入口已迁移。下表引用微信分别维护的公众号（原订阅号）、服务号与小程序文档。公开文档说明能力边界，单个账号的开通状态、可用模板和审核结论需在对应管理后台确认。

| 功能 | 个人主体条件 | LifeLog AI 行为 |
| --- | --- | --- |
| 公众号文本、图片、语音回调 | 开启开发者消息推送。官方普通消息文档列出文本、图片和语音 XML。 | 支持 URL 验证、明文或安全模式、签名校验、持久化、去重和后台处理。[消息推送配置](https://developers.weixin.qq.com/doc/subscription/guide/dev/push/) · [普通消息字段](https://developers.weixin.qq.com/doc/subscription/guide/product/message/Receiving_standard_messages.html) |
| 公众号被动回执 | 在公众号回调内发送。微信等待窗口为五秒，超时触发重投。 | 接收后及时回执，解析结果通过小程序读取。[被动回复](https://developers.weixin.qq.com/doc/subscription/guide/product/message/Passive_user_reply_message.html) |
| 公众号下载临时素材 | 当前官方 API 表将公众号列为可调用。部署时需配置接口凭据、检查白名单及实际账号返回。 | 默认关闭下载。开启后凭 MediaId 及时获取并保存图片，持久化读取使用私有 COS。下载失败可在任务状态查看。[获取临时素材](https://developers.weixin.qq.com/doc/subscription/api/material/temporary/api_getmedia.html) · [获取稳定凭据](https://developers.weixin.qq.com/doc/subscription/api/base/api_getstableaccesstoken.html) |
| 公众号语音转写 | 普通语音 XML 可提供 MediaId 和编码，转写文本取决于实际回调。无可用文本时需能下载音频并配置 ASR。 | 优先读取回调提供的转写。缺失时尝试腾讯云短音频识别，服务凭证、支持格式和调用结果需独立验证。[语音回调字段](https://developers.weixin.qq.com/doc/subscription/guide/product/message/Receiving_standard_messages.html) · [腾讯云一句话识别](https://cloud.tencent.com/document/api/1093/35646) |
| 公众号主动客服消息与一次性订阅消息 | 官方 API 表对公众号与服务号均列为企业主体认证后可用。 | 当前使用被动回执与小程序查询。[客服消息账号表](https://developers.weixin.qq.com/doc/subscription/api/customer/message/api_sendcustommessage.html) · [公众号一次性订阅账号表](https://developers.weixin.qq.com/doc/subscription/api/notify/subscribe/api_templatesubscribe.html) |
| 小程序登录与绑定 | 小程序调用 `wx.login`，服务端用小程序凭证兑换 OpenID。公众号回调 OpenID 属于另一个应用。 | 独立保存两套账号标识，用户通过一次性绑定码关联。[小程序登录流程](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html) · [凭证校验 API](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session.html) |
| 小程序订阅通知 | 普通一次性订阅需匹配的模板和用户授权。长期订阅主要针对指定线下公共服务。新版一次性通知也有指定模板、类目和触发场景。 | 当前可用提醒是小程序内摘要、待办和日历导出。微信主动通知未启用。[订阅消息能力](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html) · [新版一次性订阅](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-2.html) |
| 微信小程序上线 | 个人类目中有健康管理记录、备忘录、日历。项目还涉及 AI 处理、隐私和小程序备案，须结合实际功能提交审核。 | 代码可构建并导入开发者工具。请使用本人账号确认服务范围、填写隐私指引并上传体验版。[服务类目](https://developers.weixin.qq.com/miniprogram/product/material/#个人主体小程序开放的服务类目) · [隐私保护](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/) · [备案操作](https://developers.weixin.qq.com/miniprogram/product/record/record_guidelines.html) |

## 验证状态

- Demo 模式提供本地模拟公众号入口、测试绑定和 SQLite 持久化。无模型密钥时，文本由本地规则处理，单独上传的照片需要手工确认。模拟消息经同一套任务和记录处理流程。
- 生产代码提供微信官方回调、小程序登录、OpenAI 兼容模型、腾讯云 ASR 与私有 COS 接入点。实际公众号 AppID、各应用密钥、CloudBase 环境、私有桶、域名和合规模型账号由所有者配置。真实接口联通需在该账号下逐项验收。
- 公众号启用服务器回调可能影响现有的后台自动回复和自定义菜单。先用独立测试账号或维护窗口切换，再检查原有公众号行为。[微信接入注意事项](https://developers.weixin.qq.com/doc/subscription/guide/dev/push/)
- 微信平台可用的服务类目、模板、认证或审核要求可能调整，部署时以最新官方页面和当前账号后台为准。生产部署步骤见 [部署指南](DEPLOY.md)。
