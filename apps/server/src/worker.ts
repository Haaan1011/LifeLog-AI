import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Config } from './config.js';
import type { Store } from './db.js';
import type { Job, Raw } from './identity.js';
import { downloadWechatMedia, MediaError, transcribeWechatVoice } from './intake/media.js';
import { ProviderError, type AIProvider } from './intake/provider.js';
import { after, dailySummary, insertRecord, now, type User } from './records.js';
import { loadImage, type Image, type MediaRow, type Objects } from './storage.js';

const MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60000;
type Work = {raw:Raw;job:Job;lease:string};
type Meta = {mediaId?:string;mediaId16k?:string;format?:string};

export function createWorker(store: Store,config: Config,ai: AIProvider,objects: Objects) {
  let active: Promise<boolean>|undefined;
  let maintenanceAt = 0;
  async function claim(): Promise<Work|undefined> {
    return store.transaction(async (db) => {
      const time = now();
      const expired = await db.all<Job>("SELECT * FROM ai_jobs WHERE status='processing' AND lease_until<=? AND attempts>=? LIMIT 20",[time,MAX_ATTEMPTS]);
      for (const job of expired) {
        await db.run("UPDATE ai_jobs SET status='failed',error=?,updated_at=?,lease_id=NULL,lease_until=NULL WHERE id=?",
          ['任务多次超时，可手动重试。',time,job.id]);
        await db.run("UPDATE raw_messages SET status='failed',updated_at=? WHERE id=?",[time,job.raw_message_id]);
      }
      const job = await db.one<Job>(`SELECT * FROM ai_jobs WHERE attempts<? AND
        ((status='queued' AND available_at<=?) OR (status='processing' AND lease_until<=?))
        ORDER BY available_at,id LIMIT 1`,[MAX_ATTEMPTS,time,time]);
      if (!job) return;
      const raw = await db.one<Raw>('SELECT * FROM raw_messages WHERE id=?',[job.raw_message_id]);
      if (!raw) return;
      const lease = randomUUID();
      await db.run("UPDATE ai_jobs SET status='processing',attempts=attempts+1,lease_id=?,lease_until=?,updated_at=? WHERE id=?",
        [lease,after(LEASE_MS),time,job.id]);
      await db.run("UPDATE raw_messages SET status='processing',updated_at=? WHERE id=?",[time,raw.id]);
      return {raw,job:{...job,attempts:job.attempts + 1},lease};
    });
  }

  async function resolveImage(work: Work,meta: Meta): Promise<Image|undefined> {
    const existing = await store.query(db => db.one<MediaRow>('SELECT * FROM media WHERE raw_message_id=? AND expires_at>?',[work.raw.id,now()]));
    if (existing) return loadImage(existing,objects);
    if (!config.WECHAT_MEDIA_DOWNLOAD || !objects || !meta.mediaId || work.raw.channel !== 'wechat-oa') return;
    const image = await downloadWechatMedia(meta.mediaId,'image',config.env);
    const id = randomUUID();
    const reserved = await store.transaction(async db => {
      if (!await db.one('SELECT id FROM ai_jobs WHERE id=? AND lease_id=?',[work.job.id,work.lease])) return false;
      // A crash after upload leaves the reserved object in the deletion queue.
      await db.run('INSERT INTO media_gc(id,created_at) VALUES (?,?)',[id,now()]);
      return true;
    });
    if (!reserved) return;
    await objects.put(id,image);
    await store.transaction(async db => {
      if (!await db.one('SELECT id FROM ai_jobs WHERE id=? AND lease_id=?',[work.job.id,work.lease])) return;
      const inserted = await db.run(`INSERT INTO media(id,raw_message_id,mime,expires_at,created_at) VALUES (?,?,?,?,?)
        ON CONFLICT (raw_message_id) DO NOTHING`,[id,work.raw.id,image.mime,after(config.MEDIA_RETENTION_DAYS*86400000),now()]);
      if (inserted) await db.run('DELETE FROM media_gc WHERE id=?',[id]);
    });
    return image;
  }

  async function handle(work: Work) {
    const {raw,job,lease} = work;
    let stage = 'AI';
    try {
      const meta: Meta = JSON.parse(raw.meta_json);
      stage = raw.kind === 'image' ? 'IMAGE' : 'AI';
      const image = raw.kind === 'image' ? await resolveImage(work,meta) : undefined;
      const user = await store.query(db => db.one<User>(
        'SELECT u.* FROM users u JOIN raw_messages r ON r.user_id=u.id WHERE r.id=?',[raw.id]));
      if (!user) {
        await store.transaction(async db => {
          const message = await db.one<Raw>('SELECT * FROM raw_messages WHERE id=?',[raw.id]);
          if (!message) return;
          const linked = !!message.user_id;
          const count = await db.run(`UPDATE ai_jobs SET status=?,available_at=?,attempts=0,error=NULL,
            lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=?`,
            [linked ? 'queued' : 'waiting',now(),now(),job.id,lease]);
          if (count) await db.run('UPDATE raw_messages SET status=?,updated_at=? WHERE id=?',[linked ? 'queued' : 'unbound',now(),raw.id]);
        });
        return;
      }
      let text = raw.text;
      if (raw.kind === 'voice' && !text.trim()) {
        stage = 'VOICE';
        const mediaId = meta.mediaId16k || meta.mediaId;
        if (!mediaId || !config.WECHAT_MEDIA_DOWNLOAD) throw new Error('VOICE_MEDIA_UNAVAILABLE');
        const audio = await downloadWechatMedia(mediaId,'voice',config.env);
        text = await transcribeWechatVoice(audio.buffer,meta.format,meta.mediaId16k ? 16000 : 8000,config.env);
      }
      stage = ai.kind === 'unconfigured' ? 'CONFIG' : 'AI';
      const records = await ai.parse({text,receivedAt:raw.received_at,timezone:user.timezone,image,
        imageMissing:raw.kind === 'image' && !image});
      stage = 'PERSIST';
      await store.transaction(async db => {
        if (!await db.one('SELECT id FROM ai_jobs WHERE id=? AND lease_id=?',[job.id,lease])) return;
        for (let i=0;i<records.length;i++) {
          const {confidence,...record} = records[i];
          await insertRecord(db,user,record,{source:raw.channel === 'demo-oa' ? 'demo' : 'wechat',
            rawId:raw.id,index:i,version:ai.version,confidence});
        }
        await db.run("UPDATE ai_jobs SET status='done',error=NULL,updated_at=?,lease_id=NULL,lease_until=NULL WHERE id=?",[now(),job.id]);
        await db.run("UPDATE raw_messages SET status='done',text=?,updated_at=? WHERE id=?",[text,now(),raw.id]);
      });
    } catch (error) {
      const errors: Record<string,string> = {
        IMAGE:'图片无法读取或保存，请确认公众号媒体权限和图片时效。',
        VOICE:'未取得可用的微信转写或音频，请确认公众号媒体权限和语音识别配置。',
        CONFIG:'服务端尚未配置 AI 模型。配置后可手动重试。',
        AI:'AI 处理失败或输出不符合校验规则，可重试。',
        PERSIST:'暂时无法写入记录，可重试。',
      };
      const known = error instanceof MediaError || error instanceof ProviderError ? error : undefined;
      await store.transaction(async db => {
        const retry = job.attempts < MAX_ATTEMPTS && stage !== 'CONFIG' && known?.retryable !== false;
        const status = retry ? 'queued' : 'failed';
        const count = await db.run(`UPDATE ai_jobs SET status=?,error=?,available_at=?,updated_at=?,lease_id=NULL,lease_until=NULL
          WHERE id=? AND lease_id=?`,[status,known?.message ?? errors[stage],after(1000 * 2 ** job.attempts),now(),job.id,lease]);
        if (count) await db.run('UPDATE raw_messages SET status=?,updated_at=? WHERE id=?',[status,now(),raw.id]);
      });
    }
  }

  async function maintenance() {
    const keys = await store.transaction(async db => {
      const time = now();
      await db.run('DELETE FROM sessions WHERE expires_at<=?',[time]);
      await db.run('DELETE FROM bind_codes WHERE expires_at<=?',[time]);
      await db.run('DELETE FROM bind_attempts WHERE window_at<=?',[after(-86400000)]);
      await db.run(`INSERT INTO media_gc(id,created_at) SELECT id,? FROM media
        WHERE expires_at<=? AND bytes_b64 IS NULL ON CONFLICT DO NOTHING`,[time,time]);
      await db.run('DELETE FROM media WHERE expires_at<=?',[time]);
      await db.run(`DELETE FROM raw_messages WHERE user_id IS NULL AND received_at<?
        AND status NOT IN ('queued','processing')`,[after(-Math.max(30,config.MEDIA_RETENTION_DAYS)*86400000)]);
      const users = await db.all<User>('SELECT * FROM users');
      for (const user of users) {
        const zoneTime = Temporal.Now.zonedDateTimeISO(user.timezone);
        if (zoneTime.hour < 7) continue;
        const date = zoneTime.toPlainDate().toString();
        if (!await db.one('SELECT user_id FROM daily_summaries WHERE user_id=? AND local_date=?',[user.id,date])) {
          await dailySummary(db,user,true);
        }
      }
      return objects ? db.all<{id:string}>('SELECT id FROM media_gc WHERE created_at<=? ORDER BY created_at LIMIT 8',[after(-LEASE_MS)]) : [];
    });
    if (!objects) return;
    for (const {id} of keys) {
      try {
        await objects.remove(id);
        await store.transaction(db => db.run('DELETE FROM media_gc WHERE id=?',[id]));
      } catch { /* The durable deletion request remains for a later pass. */ }
    }
  }

  async function execute() {
    const work = await claim();
    if (work) await handle(work);
    if (maintenanceAt <= Date.now()) {
      maintenanceAt = Date.now() + 60000;
      await maintenance();
    }
    return Boolean(work);
  }
  return {
    tick() {
      if (active) return Promise.resolve(false);
      active = execute().finally(() => { active = undefined; });
      return active;
    },
    async idle() { await active?.catch(() => undefined); },
  };
}
