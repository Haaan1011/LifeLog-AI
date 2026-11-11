import { createService } from './app.js';
import { readConfig } from './config.js';
import { createWechatVerificationService } from './wechat-verification.js';

try {
  const config = readConfig();
  const service = config.LIFELOG_MODE === 'wechat-verification'
    ? createWechatVerificationService(config.wechat!)
    : await createService(config);
  const server = service.app.listen(config.PORT,config.host,() =>
    console.log(`LifeLog AI API http://${config.host}:${config.PORT} · ${config.LIFELOG_MODE}`));
  server.on('error',() => {
    console.error('无法监听 API 端口');
    void service.close().finally(() => { process.exitCode = 1; });
  });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => {
    server.close(() => { void service.close(); });
  });
} catch (error) {
  console.error('服务启动失败。请检查环境变量、数据库连通性及 lifelog Schema。');
  if (error instanceof Error && /^(配置字段无效|生产模式需要|公众号安全模式需要|公众号验证模式需要|私有图片存储需要)/.test(error.message)) console.error(error.message);
  process.exitCode = 1;
}
