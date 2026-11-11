'use strict';

exports.main = async () => {
  const baseUrl = process.env.LIFELOG_API_URL;
  const secret = process.env.INTERNAL_TICK_SECRET;
  if (!baseUrl || !secret || secret.length < 32) {
    throw new Error('请配置服务地址及至少 32 位的定时任务密钥');
  }
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('服务地址必须是单独的 HTTPS 源站');
  }
  url.pathname = '/internal/tick';
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
    redirect: 'error',
    signal: AbortSignal.timeout(110_000),
  });
  if (!response.ok) throw new Error(`定时任务返回 HTTP ${response.status}`);
  return { ok: true };
};
