import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Sql, Store } from './db.js';
import { after, ApiError, now, type User } from './records.js';

export const sha = (value: string) => createHash('sha256').update(value).digest('hex');
type Channel = 'wechat-oa'|'demo-oa';
export type Envelope = {
  channel:Channel;externalId:string;messageKey:string;kind:'text'|'image'|'voice';text:string;
  sourceSentAt?:string; meta?:{mediaId?:string;mediaId16k?:string;format?:string;toUser?:string};
  image?:{buffer:Buffer;mime:string};
};
export type Raw = {
  id:string;user_id:string|null;channel:Channel;external_id:string;kind:Envelope['kind'];text:string;
  received_at:string;status:string;reply:string|null;meta_json:string;
};
export type Job = {
  id:string;raw_message_id:string;status:string;attempts:number;error:string|null;
  created_at:string;updated_at:string;lease_id:string|null;
};

export function demoExternal(userId: string, name: string) { return userId + ':' + sha(name); }

export async function newSession(db: Sql, channel: 'demo-app'|'wechat-mp', externalId: string) {
  let identity = await db.one<{user_id:string}>('SELECT user_id FROM account_links WHERE channel=? AND external_id=?',[channel,externalId]);
  const timestamp = now();
  if (!identity) {
    identity = {user_id:randomUUID()};
    await db.run('INSERT INTO users (id,name,created_at,updated_at) VALUES (?,?,?,?)',[identity.user_id,'记录者',timestamp,timestamp]);
    await db.run('INSERT INTO account_links (channel,external_id,user_id,created_at) VALUES (?,?,?,?)',[channel,externalId,identity.user_id,timestamp]);
  }
  const token = randomBytes(32).toString('base64url');
  await db.run('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',
    [sha(token),identity.user_id,after(30 * 86400000),timestamp]);
  return {token};
}

const loginResponse = z.object({openid:z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/).optional(),errcode:z.number().optional()});
export async function wechatLogin(code: string, config: Config) {
  if (!config.WECHAT_MP_APP_ID || !config.WECHAT_MP_APP_SECRET) throw new ApiError(503,'WECHAT_LOGIN_UNAVAILABLE','微信登录尚未配置');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({
    appid:config.WECHAT_MP_APP_ID,secret:config.WECHAT_MP_APP_SECRET,js_code:code,grant_type:'authorization_code',
  }).toString();
  let body: z.infer<typeof loginResponse>;
  try {
    const response = await fetch(url,{signal:AbortSignal.timeout(4500),redirect:'error'});
    if (!response.ok) throw new Error();
    body = loginResponse.parse(await response.json());
  } catch {
    throw new ApiError(502,'WECHAT_LOGIN_UPSTREAM','微信登录服务暂时不可用');
  }
  if (!body.openid || body.errcode) throw new ApiError(401,'WECHAT_CODE_INVALID','微信登录凭证失效，请重新登录');
  return config.WECHAT_MP_APP_ID + ':' + body.openid;
}

export async function authenticatedUser(db: Sql, header?: string) {
  const token = /^Bearer ([a-zA-Z0-9_-]{43})$/.exec(header ?? '')?.[1];
  const user = token ? await db.one<User>(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>?`,[sha(token),now()]) : undefined;
  if (!user) throw new ApiError(401,'UNAUTHORIZED','登录已失效，请重新进入');
  return user;
}
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export async function issueCode(db: Sql,user: User) {
  const linked = await db.one("SELECT 1 AS present FROM account_links WHERE user_id=? AND channel IN ('wechat-oa','demo-oa')",[user.id]);
  if (linked) throw new ApiError(409,'ALREADY_BOUND','此账号已经绑定公众号');
  const bytes = randomBytes(8);
  const code = [...bytes].map(byte => CODE_ALPHABET[byte & 31]).join('');
  const expiresAt = after(10 * 60000);
  await db.run(`INSERT INTO bind_codes (code_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)
    ON CONFLICT (user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_at=excluded.created_at,used_at=NULL`,
    [sha(code),user.id,expiresAt,now()]);
  return {code,expiresAt};
}

async function enqueue(db: Sql,rawId: string,timestamp: string) {
  await db.run(`INSERT INTO ai_jobs(id,raw_message_id,status,available_at,created_at,updated_at) VALUES (?,?,'queued',?,?,?)
    ON CONFLICT (raw_message_id) DO UPDATE SET status='queued',attempts=0,available_at=excluded.available_at,updated_at=excluded.updated_at,error=NULL
    WHERE ai_jobs.status IN ('waiting','failed')`,[randomUUID(),rawId,timestamp,timestamp,timestamp]);
  await db.run("UPDATE raw_messages SET status='queued',updated_at=? WHERE id=? AND status NOT IN ('processing','done')",[timestamp,rawId]);
}
async function bindSender(db: Sql, input: Envelope, rawId: string, code: string, expectedUser?: string) {
  const time = now();
  const prior = await db.one<{window_at:string;attempts:number}>(
    'SELECT window_at,attempts FROM bind_attempts WHERE channel=? AND external_id=?',[input.channel,input.externalId]);
  const current = prior && prior.window_at > after(-15 * 60000) ? prior : {window_at:time,attempts:0};
  if (current.attempts >= 5) return '尝试次数过多，请 15 分钟后重试。';
  await db.run(`INSERT INTO bind_attempts(channel,external_id,window_at,attempts) VALUES (?,?,?,?)
    ON CONFLICT (channel,external_id) DO UPDATE SET window_at=excluded.window_at,attempts=excluded.attempts`,
    [input.channel,input.externalId,current.window_at,current.attempts + 1]);
  const target = await db.one<{user_id:string}>(`SELECT b.user_id FROM bind_codes b
    JOIN account_links a ON a.user_id=b.user_id AND a.channel=?
    WHERE b.code_hash=? AND b.expires_at>? AND b.used_at IS NULL`,
    [input.channel === 'demo-oa' ? 'demo-app' : 'wechat-mp',sha(code),time]);
  if (!target || (expectedUser && target.user_id !== expectedUser)) return '绑定码无效、已使用或已过期。';
  const conflict = await db.one('SELECT 1 AS present FROM account_links WHERE channel=? AND (external_id=? OR user_id=?)',
    [input.channel,input.externalId,target.user_id]);
  if (conflict) return '此账号已有绑定关系。';
  await db.run('UPDATE bind_codes SET used_at=? WHERE user_id=? AND code_hash=?',[time,target.user_id,sha(code)]);
  await db.run('INSERT INTO account_links(channel,external_id,user_id,created_at) VALUES (?,?,?,?)',
    [input.channel,input.externalId,target.user_id,time]);
  await db.run("UPDATE raw_messages SET user_id=?,updated_at=? WHERE channel=? AND external_id=? AND status IN ('unbound','queued','processing','failed')",
    [target.user_id,time,input.channel,input.externalId]);
  await db.run(`INSERT INTO ai_jobs(id,raw_message_id,status,available_at,created_at,updated_at)
    SELECT id,id,'queued',?,?,? FROM raw_messages WHERE user_id=? AND channel=? AND external_id=?
      AND status IN ('unbound','queued','processing','failed') AND id<>?
    ON CONFLICT (raw_message_id) DO UPDATE SET status='queued',attempts=0,available_at=excluded.available_at,
      updated_at=excluded.updated_at,error=NULL WHERE ai_jobs.status IN ('waiting','failed')`,
    [time,time,time,target.user_id,input.channel,input.externalId,rawId]);
  await db.run(`UPDATE raw_messages SET status='queued',updated_at=? WHERE user_id=? AND channel=?
    AND external_id=? AND status IN ('unbound','failed') AND id<>?`,
    [time,target.user_id,input.channel,input.externalId,rawId]);
  await db.run("UPDATE raw_messages SET user_id=?,status='bound',updated_at=? WHERE id=?",[target.user_id,time,rawId]);
  return '绑定成功。此账号的记录会显示在小程序中。';
}

export async function receiveMessage(store: Store,input: Envelope,retentionDays: number,canArchiveImage: boolean,expectedUser?: string) {
  return store.transaction(async (db) => {
    if (expectedUser && !await db.one('SELECT id FROM users WHERE id=?',[expectedUser])) {
      throw new ApiError(401,'UNAUTHORIZED','登录已失效，请重新进入');
    }
    const previous = await db.one<Raw>(
      'SELECT * FROM raw_messages WHERE channel=? AND external_id=? AND message_key=?',[input.channel,input.externalId,input.messageKey]);
    async function result(raw: Pick<Raw,'id'|'status'|'reply'>,duplicate: boolean) {
      const job = await db.one<{id:string}>('SELECT id FROM ai_jobs WHERE raw_message_id=?',[raw.id]);
      return {messageId:input.messageKey,duplicate,status:raw.status,reply:raw.reply ?? '已接收，正在整理记录。',...(job ? {jobId:job.id} : {})};
    }
    if (previous) return result(previous,true);
    const identity = await db.one<{user_id:string}>('SELECT user_id FROM account_links WHERE channel=? AND external_id=?',[input.channel,input.externalId]);
    const bindText = input.kind === 'text' ? /^绑定(?:\s+|$)(.*)$/i.exec(input.text.trim()) : null;
    const code = bindText?.[1].trim().toUpperCase() ?? '';
    const rawId = randomUUID();
    const time = now();
    await db.run(`INSERT INTO raw_messages(id,user_id,channel,external_id,message_key,kind,text,meta_json,source_sent_at,received_at,updated_at,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[rawId,identity?.user_id ?? null,input.channel,input.externalId,input.messageKey,
      input.kind,bindText ? '绑定指令' : input.text,JSON.stringify(input.meta ?? {}),input.sourceSentAt ?? null,time,time,bindText ? 'rejected' : 'unbound']);
    let reply: string;
    if (bindText) {
      reply = await bindSender(db,input,rawId,code,expectedUser);
    } else {
      if (input.image) {
        await db.run('INSERT INTO media(id,raw_message_id,mime,bytes_b64,expires_at,created_at) VALUES (?,?,?,?,?,?)',
          [randomUUID(),rawId,input.image.mime,input.image.buffer.toString('base64'),after(retentionDays*86400000),time]);
      }
      if (identity || (input.kind === 'image' && canArchiveImage)) await enqueue(db,rawId,time);
      reply = identity ? '已接收，正在整理记录。' : '已接收。请先在小程序获取绑定码，再发送「绑定 绑定码」。';
    }
    await db.run('UPDATE raw_messages SET reply=? WHERE id=?',[reply,rawId]);
    return result((await db.one<Raw>('SELECT * FROM raw_messages WHERE id=?',[rawId]))!,false);
  });
}

export function jobDto(job: Job & {channel:Channel}) {
  return {id:job.id,rawMessageId:job.raw_message_id,status:job.status,attempts:job.attempts,error:job.error,
    source:job.channel === 'demo-oa' ? 'demo' : 'wechat',createdAt:job.created_at,updatedAt:job.updated_at};
}
export async function userJob(db: Sql,userId: string,id: string) {
  const job = await db.one<Job & {channel:Channel}>(`SELECT j.*,r.channel FROM ai_jobs j JOIN raw_messages r ON r.id=j.raw_message_id
    WHERE j.id=? AND r.user_id=?`,[id,userId]);
  if (!job) throw new ApiError(404,'JOB_NOT_FOUND','未找到该处理任务');
  return job;
}
