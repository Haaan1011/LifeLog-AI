import { createHash, createHmac } from 'node:crypto';
import type { Config } from './config.js';
import type { Sql } from './db.js';
import { now } from './records.js';

export type Image = {buffer:Buffer;mime:string};
export type MediaRow = {id:string;raw_message_id:string;mime:string;bytes_b64:string|null;expires_at:string};
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g,char =>
  '%' + char.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key: string,message: string) => createHmac('sha1',key).update(message).digest('hex');

// COS XML API canonicalization. Object paths are fixed ASCII keys and there are no query parameters.
export function cosSignature(method: string,path: string,headers: Record<string,string>,keyTime: string,signKey: string) {
  const names = Object.keys(headers).sort();
  const canonical = names.map(name => encode(name) + '=' + encode(headers[name])).join('&');
  const hash = createHash('sha1').update(method.toLowerCase() + '\n' + path + '\n\n' + canonical + '\n').digest('hex');
  return {headerList:names.join(';'),signature:hmac(signKey,'sha1\n' + keyTime + '\n' + hash + '\n')};
}

export function objectStorage(config: Config) {
  const {COS_BUCKET:bucket,COS_REGION:region,TENCENTCLOUD_SECRET_ID:secretId,TENCENTCLOUD_SECRET_KEY:secretKey} = config;
  if (!bucket || !region || !secretId || !secretKey) return undefined;
  const host = bucket + '.cos.' + region + '.myqcloud.com';
  async function request(method: 'GET'|'PUT'|'DELETE',id: string,image?: Image) {
    const path = '/lifelog/private/' + id;
    const timestamp = Math.floor(Date.now()/1000);
    const keyTime = (timestamp - 30) + ';' + (timestamp + 90);
    const headers: Record<string,string> = {host};
    if (config.TENCENTCLOUD_SESSION_TOKEN) headers['x-cos-security-token'] = config.TENCENTCLOUD_SESSION_TOKEN;
    if (image) {
      headers['content-type'] = image.mime;
      headers['content-length'] = String(image.buffer.length);
      headers['content-md5'] = createHash('md5').update(image.buffer).digest('base64');
    }
    const {headerList,signature} = cosSignature(method,path,headers,keyTime,hmac(secretKey!,keyTime));
    headers.authorization = 'q-sign-algorithm=sha1&q-ak=' + secretId + '&q-sign-time=' + keyTime + '&q-key-time=' + keyTime +
      '&q-header-list=' + headerList + '&q-url-param-list=&q-signature=' + signature;
    const response = await fetch('https://' + host + path,{
      method,headers,body:image ? new Uint8Array(image.buffer) : undefined,
      redirect:'error',signal:AbortSignal.timeout(10000),
    });
    if (response.ok && method === 'GET') {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('COS_EMPTY');
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (let next = await reader.read(); !next.done; next = await reader.read()) {
          size += next.value.length;
          if (size > 10*1024*1024) throw new Error('COS_SIZE');
          chunks.push(next.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      return Buffer.concat(chunks);
    }
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) throw new Error('COS_HTTP_ERROR');
    return Buffer.alloc(0);
  }
  return {
    put: async (id: string,image: Image) => { await request('PUT',id,image); },
    get: (id: string) => request('GET',id),
    remove: async (id: string) => { await request('DELETE',id); },
  };
}
export type Objects = ReturnType<typeof objectStorage>;

export async function loadImage(row: MediaRow, objects: Objects): Promise<Image> {
  const buffer = row.bytes_b64 ? Buffer.from(row.bytes_b64,'base64') : await objects?.get(row.id);
  if (!buffer) throw new Error('MEDIA_STORAGE_UNAVAILABLE');
  return {buffer,mime:row.mime};
}

export async function eraseAccount(db: Sql,userId: string) {
  await db.run(`INSERT INTO media_gc(id,created_at) SELECT m.id,? FROM media m JOIN raw_messages r
    ON r.id=m.raw_message_id WHERE r.user_id=? AND m.bytes_b64 IS NULL ON CONFLICT DO NOTHING`,[now(),userId]);
  await db.run(`DELETE FROM bind_attempts WHERE EXISTS (
    SELECT 1 FROM account_links a WHERE a.channel=bind_attempts.channel AND a.external_id=bind_attempts.external_id AND a.user_id=?)`,[userId]);
  // Demo senders are scoped to this account, including messages received before linking.
  await db.run("DELETE FROM raw_messages WHERE channel='demo-oa' AND external_id LIKE ?",[userId + ':%']);
  await db.run("DELETE FROM bind_attempts WHERE channel='demo-oa' AND external_id LIKE ?",[userId + ':%']);
  await db.run('DELETE FROM users WHERE id=?',[userId]);
}

