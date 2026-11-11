# LifeLog AI

在公众号聊天窗口记录饮食、健身、备忘和待办，用微信小程序查看与管理。仓库同时提供可离线试用的 H5 演示。演示输入经过消息落库、账号绑定、异步处理和记录统计，数据保存在本机 SQLite。

## 在本机使用

需要 Node.js 22.13 或以上版本和 npm。在项目根目录运行：

```powershell
npm.cmd ci
npm.cmd run dev
```

打开 [本地 LifeLog AI](http://127.0.0.1:5173)。Windows PowerShell 中使用 `npm.cmd`，macOS 或 Linux 将其换成 `npm`。默认 API 在 `127.0.0.1:3000`，启动会自动迁移数据库。数据位于 `.data/lifelog.sqlite`。同一浏览器会保留演示登录身份，浏览器存储中只保存演示设备凭证与会话。

1. 首页点 **演示入口**，点击 **模拟绑定**。也可以先发消息，绑定后再看此前暂存的记录。
2. 发送「今天早餐吃了两个鸡蛋、一杯250ml牛奶和两片面包。」或用混合消息示例。等待状态变为 **已保存**。
3. 点击 **重复投递** 检查 **已去重**。到「记录」修改食物份量或删除记录，到「统计」核对更新。
4. 上传一张 JPEG、PNG 或 WebP 图片。默认本地规则保存附件并标记 **图片待确认**，需要手动填写食物。接入视觉模型后，可对真实照片提取食物。
5. 可以手动添加饮食、训练、备忘或待办。在「我的」设置营养目标与体重，导出数据或系统日历。

默认不需要 `.env`。需要改端口、启用真实模型或准备微信接入时，复制 `.env.example` 到根目录 `.env`。H5 开发时如需改变 API 地址，运行前设置 `VITE_API_PROXY`；正式小程序前端只需要公开的 `VITE_API_BASE`。图片下载、微信小程序登录与 AI 密钥全在服务端配置。

## 检查与构建

```powershell
npm.cmd run typecheck
npm.cmd test
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd run build
```

已安装 Microsoft Edge 时，可以用 `$env:PLAYWRIGHT_CHANNEL = 'msedge'` 执行浏览器测试。浏览器测试另起端口并使用临时 SQLite，不接触演示数据。手动执行迁移使用 `npm.cmd run db:migrate`。

构建产物：

- H5 为 `apps/web/dist/build/h5`。先完整构建，再执行 `npm.cmd start` 可通过 [本机 API 端口上的 H5](http://127.0.0.1:3000) 使用单进程演示。
- 微信小程序为 `apps/web/dist/build/mp-weixin`。正式构建前填写小程序 AppID 和 HTTPS API 地址。
- 服务端为 `apps/server/dist`。正式环境随容器部署迁移 SQL 并启动。

## 已实现与外部接入

| 领域 | 本机功能 | 微信与云端接入 |
| --- | --- | --- |
| 消息 | 模拟发送、一次性绑定、图片上传、持久化队列、失败重试、重复投递 | 官方 XML 明文与安全模式回调、被动回复、可选临时素材与 ASR |
| AI | 无密钥时使用可预测的中文规则。照片保存为待确认 | OpenAI 兼容文本和视觉模型，服务端 JSON Schema 校验 |
| 饮食与健身 | 手动与消息记录、食物参考值、目标、周月趋势、训练重量及容量 | 同一套计算逻辑。照片份量、营养与运动能耗为估算 |
| 备忘与待办 | 日期时间线、搜索和标签、当日摘要、循环待办、日历、导出 | CloudBase 定时触发维护摘要，小程序内查看 |
| 隐私 | 登录、用户隔离、附件受保护、数据导出及账户删除 | 私有 PostgreSQL schema 与私有 COS。隐私指引与服务类目需平台审核 |

营养使用 USDA FoodData Central 的参考条目，原料、配方和烹饪方式不同会影响实际数值。未知的营养不纳入合计。设置减脂、维持、增肌目标时由用户自行输入。训练能耗根据明确提供的时长、体重和已匹配的 MET 估算，不用于医学判断。详见 [架构说明](ARCHITECTURE.md)。

[正式部署](DEPLOY.md) · [微信个人主体权限](PERMISSIONS.md) · [测试报告](TEST_REPORT.md) · [API 协议](API_CONTRACT.md)
