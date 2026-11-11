import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

for (const path of [resolve('.env'), resolve('../../.env')]) {
  if (existsSync(path)) loadEnv({ path, quiet: true });
}

const bool = z.preprocess(value => value === 'true' || value === '1', z.boolean());
const envSchema = z.object({
  LIFELOG_MODE: z.enum(['demo','production']).default('demo'),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DEMO_DB_PATH: z.string().optional(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//).optional(),
  DATABASE_SSL_CA: z.string().optional(),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  WECHAT_MP_APP_ID: z.string().optional(),
  WECHAT_MP_APP_SECRET: z.string().optional(),
  WECHAT_OA_APP_ID: z.string().optional(),
  WECHAT_OA_TOKEN: z.string().optional(),
  WECHAT_OA_MODE: z.enum(['plain','safe']).default('safe'),
  WECHAT_OA_ENCODING_AES_KEY: z.string().optional(),
  WECHAT_MEDIA_DOWNLOAD: bool,
  INTERNAL_TICK_SECRET: z.string().min(32).optional(),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COS_BUCKET: z.string().regex(/^[a-z0-9-]+-\d+$/).optional(),
  COS_REGION: z.string().regex(/^[a-z]{2}-[a-z0-9-]+$/).optional(),
  TENCENTCLOUD_SECRET_ID: z.string().optional(),
  TENCENTCLOUD_SECRET_KEY: z.string().optional(),
  TENCENTCLOUD_SESSION_TOKEN: z.string().optional(),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const nonempty = Object.fromEntries(Object.entries(env).filter(([,value]) => value !== ''));
  const result = envSchema.safeParse(nonempty);
  if (!result.success) throw new Error('配置字段无效：' + result.error.issues.map(issue => issue.path.join('.')).join(', '));
  const cfg = result.data;
  const demo = cfg.LIFELOG_MODE === 'demo';
  const cos = [cfg.COS_BUCKET,cfg.COS_REGION,cfg.TENCENTCLOUD_SECRET_ID,cfg.TENCENTCLOUD_SECRET_KEY];
  if (!demo && (!cfg.DATABASE_URL || !cfg.WECHAT_MP_APP_ID || !cfg.WECHAT_MP_APP_SECRET)) {
    throw new Error('生产模式需要 DATABASE_URL、WECHAT_MP_APP_ID 和 WECHAT_MP_APP_SECRET');
  }
  if (cfg.WECHAT_OA_TOKEN && cfg.WECHAT_OA_MODE === 'safe' &&
      (!cfg.WECHAT_OA_APP_ID || !/^[a-zA-Z0-9+/]{43}$/.test(cfg.WECHAT_OA_ENCODING_AES_KEY ?? ''))) {
    throw new Error('公众号安全模式需要 AppID 和有效的 EncodingAESKey');
  }
  if ((cfg.COS_BUCKET || cfg.COS_REGION || (!demo && cfg.WECHAT_MEDIA_DOWNLOAD)) && !cos.every(Boolean)) {
    throw new Error('私有图片存储需要 COS_BUCKET、COS_REGION 和腾讯云服务端凭据');
  }
  return {
    ...cfg,
    demo,
    host: cfg.HOST || (demo ? '127.0.0.1' : '0.0.0.0'),
    databaseUrl: demo ? undefined : cfg.DATABASE_URL,
    databaseCa: cfg.DATABASE_SSL_CA?.replace(/\\n/g,'\n'),
    sqlitePath: cfg.DEMO_DB_PATH || resolve(import.meta.dirname,'../../../.data/lifelog.sqlite'),
    origins: cfg.CORS_ORIGINS.split(',').map(value => value.trim()).filter(Boolean),
    wechat: !demo && cfg.WECHAT_OA_TOKEN ? {
      token: cfg.WECHAT_OA_TOKEN, mode: cfg.WECHAT_OA_MODE,
      appId: cfg.WECHAT_OA_APP_ID, aesKey: cfg.WECHAT_OA_ENCODING_AES_KEY,
    } : undefined,
    env,
  };
}
export type Config = ReturnType<typeof readConfig>;
