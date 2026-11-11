# LifeLog AI 部署指南

本项目的生产部署使用上海地域的腾讯云 CloudBase 云托管、PostgreSQL 环境、定时云函数和私有腾讯云 COS。部署涉及账号登录、实名认证、可能的云资源费用、域名和小程序备案以及微信审核。以下步骤由账号所有者执行。部署前先完成本地验收，参见 [README](README.md) 和 [测试报告](TEST_REPORT.md)。

## 1. 准备正式环境

1. 注册并准备个人微信小程序。获取小程序 AppID 和 AppSecret。准备公众号时，分别获取公众号的 AppID、回调 Token、EncodingAESKey，以及媒体下载所需的公众号 AppSecret。两个应用的 AppID 与 AppSecret 各自独立。
2. 在 [CloudBase 控制台](https://console.cloud.tencent.com/tcb) 新建上海地域 PostgreSQL 模式环境，记下环境 ID。官方能力表列明上海 PostgreSQL 环境支持云托管，新加坡 PostgreSQL 环境当前不支持云托管。核对套餐中的云函数超时上限、固定公网出口 IP 和所需私有网络能力。当前免费体验版的云函数超时固定为 3 秒，且没有云托管固定公网出口 IP。开通前按控制台核对费用和资源能力。[环境快速开始](https://cloud.tencent.com/document/product/876/121103) · [地域与套餐能力表](https://cloud.tencent.com/document/product/876/127357)
3. 在数据库控制台获取 PostgreSQL **直连**地址、端口和 SSL 配置，优先选择云托管同地域内网。部署使用可执行本项目迁移的独立数据库角色。应用保持自己的连接池和短事务，启动时通过 `search_path` 限定业务 schema。[PG 服务端连接](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql) · [连接方式](https://docs.cloudbase.net/database/postgresql/connection-management)
4. 使用有权限的数据库账号在目标库中创建 `lifelog` schema，将 `lifelog_app` 替换为实际的应用数据库角色。CloudBase 的自动 PostgREST 接口当前只暴露 `public` schema。应用业务表置于 `lifelog`，微信端只调用本项目 API。[PG 模式与 REST schema](https://docs.cloudbase.net/database/postgresql/initialization)

   ```sql
   CREATE SCHEMA IF NOT EXISTS lifelog AUTHORIZATION lifelog_app;
   REVOKE ALL ON SCHEMA lifelog FROM PUBLIC;
   ```

   服务启动会运行 `apps/server/migrations` 中的待执行迁移，启动成功后才能通过 `/healthz`。迁移先在测试环境验证，升级正式环境前先备份。服务从 `DATABASE_URL` 获取凭证，URL 内账号、密码中的特殊字符需要编码。按控制台要求校验服务端证书，私有 CA 可使用 `DATABASE_SSL_CA` 注入 PEM 内容。使用可信公共 CA 时按连接要求配置 `sslmode=verify-full`。
5. 需要图片时，在腾讯云创建同地域**私有读写** COS 桶，准备专用的最小权限 CAM 凭证。授权该桶的对象读、写、删除操作。创建存储生命周期规则，按 `MEDIA_RETENTION_DAYS` 清理过期对象，覆盖孤立对象或后端清理中断的情况。专用桶保持版本控制及对象锁定关闭。若桶已保存历史版本，还需设置非当前版本到期删除并核验清理，否则普通对象删除后可能留下历史版本。[COS 访问鉴权](https://intl.cloud.tencent.com/zh/document/product/436/45228) · [权限粒度](https://cloud.tencent.com/document/product/598/69901) · [生命周期配置](https://cloud.tencent.com/document/product/436/17031)

## 2. 部署 CloudBase 云托管

先在项目根目录安装并验证，再生成允许上传的源代码包。脚本只复制 Docker 构建需要的服务器代码、迁移、包清单和锁文件，输出一个临时文件夹。上传该文件夹可避免将本地 `.env`、SQLite、测试输出或 Git 历史打包。

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
$stage = node scripts/stage-cloudbase.mjs
$stage
```

1. 在云开发控制台选择该环境，开通云托管，创建 `lifelog-api` 容器型服务。源代码选择上一步的文件夹，Dockerfile 位置设为根目录，应用端口设为 `8080`，健康路径 `/healthz`。运行环境配置时选择可连通 PostgreSQL 的网络。公众号需要较低的回调延迟，正式启用时建议把最小实例数设为 `1`，并根据费用和数据库连接上限设定最大实例数。[云托管部署](https://docs.cloudbase.net/run/deploy/deploy/deploying-source-code) · [云托管 CLI](https://docs.cloudbase.net/cli-v1/cloudrun/deploy)
2. 在服务配置内填入 `.env.example` 对应环境变量，再部署版本。Docker 镜像默认设置 `NODE_ENV=production`、`LIFELOG_MODE=production`、`HOST=0.0.0.0`、`PORT=8080`。当前数据库直连模式启动需要 `DATABASE_URL`，小程序登录需要 `WECHAT_MP_APP_ID` 和 `WECHAT_MP_APP_SECRET`。`INTERNAL_TICK_SECRET` 使用至少 32 位独立随机密钥。配置可信代理跳数时以实际网关链路为准，默认 `TRUST_PROXY_HOPS=0`。密钥保存在后台，开发目录与小程序构建环境只需要公开 API URL。
3. 公众号文本需要 `WECHAT_OA_APP_ID`、`WECHAT_OA_TOKEN`、`WECHAT_OA_MODE=safe`、`WECHAT_OA_ENCODING_AES_KEY`。开启媒体时，先确认该账号的临时素材权限和固定出口 IP 能用，再设置 `WECHAT_OA_APP_SECRET`、`WECHAT_MEDIA_DOWNLOAD=true`、`COS_BUCKET`、`COS_REGION`、`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`。启用腾讯云短音频转写需开通 ASR 并授权 `SentenceRecognition`，设置 `WECHAT_VOICE_ASR=true`，可用 `TENCENTCLOUD_ASR_REGION` 指定地域，默认 `ap-guangzhou`。使用临时云密钥时补 `TENCENTCLOUD_SESSION_TOKEN` 并在到期前轮换。[腾讯云一句话识别](https://cloud.tencent.com/document/api/1093/35646)
4. 配置 OpenAI 兼容 AI 服务的 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` 和支持图片输入的 `AI_VISION_MODEL`，并在正式环境验证公网出口、模型权限和结构化返回。`AI_BASE_URL` 填兼容 API 的基础 URL，例如供应商提供的 `https://example.com/v1`。
5. 在 CloudBase HTTP 网关添加已备案的自定义 HTTPS 域名和完整证书链。创建指向云托管服务的路由，开启路径透传。`/webhooks/wechat` 必须允许微信请求抵达本应用，由应用验证微信签名。小程序 `/api` 使用 LifeLog 登录凭证，定时接口使用独立 Bearer 密钥。网关应保留 `Authorization`、查询参数和 XML 请求体。默认云托管域名适用于临时测试，正式小程序使用在微信控制台配置过的域名。[CloudBase 自定义域名与路由](https://docs.cloudbase.net/run/deploy/networking/custom-domains) · [微信小程序网络规则](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)

使用 `https://<API 域名>/healthz` 验证健康状态，并打开 `https://<API 域名>/api/status` 核对 `mode`、`wechat`、`ai` 和 `vision`。`/api/status` 反映服务配置，微信与模型可用性要通过后续真实消息验证。

## 3. 部署定时云函数

`cloudbaserc.json` 中的 `lifelog-tick` 使用普通事件云函数，触发器每分钟发起一次请求。函数向 `POST /internal/tick` 发送服务端密钥，业务端负责认领任务、回收过期租约、清理过期媒体和按用户当地日期维护待办摘要。每分钟触发避免把用户时区绑定到 CloudBase cron 的时区。函数代码不需要安装第三方依赖。实际可通过控制台首次部署，或运行下列命令。两种方式任选其一。

- **控制台**。新建事件函数 `lifelog-tick`，运行时选 Node.js 20.19，入口 `index.main`，超时 120 秒。上传 `cloudfunctions/lifelog-tick` 文件夹内代码，配置 `LIFELOG_API_URL` 为 HTTPS 源站地址以及与容器一致的 `INTERNAL_TICK_SECRET`。创建名为 `every-minute` 的定时触发器，表达式 `0 * * * * * *`。
- **CLI**。安装官方 CLI 后，用本人账号登录。`LIFELOG_API_URL` 为 HTTPS 源站地址，`INTERNAL_TICK_SECRET` 从安全渠道注入当前终端变量。

  ```powershell
  npm.cmd install -g @cloudbase/cli
  tcb.cmd login
  $cloudEnv = '替换为实际环境ID'
  $env:LIFELOG_API_URL = 'https://lifelog.example.com'
  # 在本地安全地设置 $env:INTERNAL_TICK_SECRET 后执行。
  tcb.cmd fn deploy lifelog-tick -e $cloudEnv
  ```

部署后检查函数「触发器」。如果当前 CLI 未随部署创建触发器，执行 `tcb.cmd fn trigger create lifelog-tick -e $cloudEnv`。查看调用记录，确认 `/internal/tick` 返回 HTTP 202，再在小程序核对任务完成状态。云托管内的后台处理继续执行，HTTP 202 表示已接收触发。随后测试两次触发期间的数据结果。触发器可能重复调用，队列根据数据库状态认领。将定时接口响应和任务失败状态加入生产巡检。[定时云函数](https://docs.cloudbase.net/recipes/schedule-cloud-function-cron-job) · [创建触发器](https://docs.cloudbase.net/cli-v1/functions/trigger-create)

## 4. 配置公众号回调

1. 在「微信开发者平台 → 我的业务 → 公众号 → 消息与事件推送」配置 `https://<API 域名>/webhooks/wechat`，填入与后台一致的 Token 和 EncodingAESKey，消息格式选 XML，加密选安全模式。服务端亦支持双方都明确配置为明文模式的调试。平台保存配置时会请求 GET 验证签名并要求原样返回 `echostr`。[消息与事件接入](https://developers.weixin.qq.com/doc/subscription/guide/dev/push/) · [消息加解密](https://developers.weixin.qq.com/doc/subscription/guide/dev/push/encryption.html)
2. 开启后，先用自己的微信号发送一条普通文本，核对公众号的被动回执、小程序绑定和后台处理状态。回调接收并落库后回复，AI 处理在后台。微信普通消息的回调等待窗口为五秒，超时会重投，先验证冷启动和重复投递行为再开放使用。[接收普通消息](https://developers.weixin.qq.com/doc/subscription/guide/product/message/Receiving_standard_messages.html) · [被动回复](https://developers.weixin.qq.com/doc/subscription/guide/product/message/Passive_user_reply_message.html)
3. 需要图片、语音时，在公众号后台确认凭证和素材权限，配置云托管固定公网出口 IP 到接口白名单。发送样本图片，确认 COS 对象为私有、小程序能读取且第二个用户不可访问，再验证语音转写。接口不可用时任务保留具体失败状态。[稳定凭证](https://developers.weixin.qq.com/doc/subscription/api/base/api_getstableaccesstoken.html) · [临时素材](https://developers.weixin.qq.com/doc/subscription/api/material/temporary/api_getmedia.html) · [固定公网出口 IP](https://docs.cloudbase.net/run/deploy/networking/staticip)

## 5. 构建和发布微信小程序

1. 将 `apps/web/src/manifest.json` 的 `mp-weixin.appid` 改为实际小程序 AppID。`VITE_API_BASE` 仅用于指定公开 API HTTPS 源站。项目根目录运行以下命令。

   ```powershell
   $env:VITE_API_BASE = 'https://lifelog.example.com'
   npm.cmd run build:mp
   ```

2. 微信开发者工具选择「导入项目」，目录为 `apps/web/dist/build/mp-weixin`，使用实际 AppID 和有开发权限的微信账号。使用 HBuilderX 时可在项目终端执行同一 npm 构建命令，再用微信开发者工具导入输出目录。小程序后台将 API HTTPS 域名加入 `request`、`downloadFile` 合法域名，若该版本使用小程序端上传也配置 `uploadFile` 合法域名。保持域名校验开启，使用手机预览完成正式登录、绑定、编辑、照片读取和导出验证。[网络规范](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html) · [微信登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)
3. 核对个人主体可选服务类目及实际功能，填写隐私保护指引，列清生活文本、照片、体重等数据的处理目的、第三方模型处理、保存期限、导出和删除。按平台要求完成小程序备案。提交前向平台说明 AI 用于私人记录结构化和摘要，若当前主体或类目需要附加资质，按后台审核要求处理。健康管理记录与备忘录类目可供核对，最终按账号后台可选范围和审核意见确定。[个人主体服务类目](https://developers.weixin.qq.com/miniprogram/product/material/#个人主体小程序开放的服务类目) · [小程序备案](https://developers.weixin.qq.com/miniprogram/product/record/record_guidelines.html) · [用户隐私保护指引](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/)
4. 开发者工具上传代码，先使用体验版验收。之后由管理员在小程序后台提交审核，审核通过后决定发布。[微信官方上传、审核与发布流程](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)

## 6. 正式接入后验收

- 验证微信登录、一次性绑定、绑定前消息归属、混合文本拆分和重复投递。
- 验证图片权限与删除，语音仅在当前账号和 ASR 可用时验收。用两个独立测试账号交叉核对记录、照片和任务隔离。
- 验证定时摘要的用户时区与待办新增、完成后的更新，导入日历文件后核对事件时间。
- 测量微信回调响应时间，观察 PostgreSQL 连接数、媒体失败状态和队列错误。微信推送渠道边界见 [外部接口权限与限制](PERMISSIONS.md)。
