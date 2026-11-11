import express from 'express';
import { type WechatConfig, WechatError, verifyHandshake } from './intake/wechat.js';

export function createWechatVerificationService(config: WechatConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ ok: true, mode: 'wechat-verification', messageProcessing: false }));
  app.get('/webhooks/wechat', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.type('text/plain').send(verifyHandshake(req.query, config));
    } catch (error) {
      if (!(error instanceof WechatError)) throw error;
      res.status(error.statusCode).type('text/plain').send(error.message);
    }
  });
  app.post('/webhooks/wechat', (_req, res) => {
    res.status(503).type('text/plain').send('LifeLog 消息处理尚未启用');
  });
  return { app, close: async () => {} };
}
