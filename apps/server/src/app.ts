import { randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { readConfig, type Config } from './config.js';
import { migrate, openStore, type Sql } from './db.js';
import { authenticatedUser, demoExternal, issueCode, jobDto, newSession, receiveMessage, sha, userJob, wechatLogin, type Job } from './identity.js';
import { createAIProvider, type AIProvider } from './intake/provider.js';
import { validateImage } from './intake/media.js';
import { makeWechatReply, readWechatCallback, verifyHandshake, WechatError } from './intake/wechat.js';
import { after, ApiError, checkedRecord, completeTodo, dailySummary, dateSchema, getRecord, goalsSchema, idSchema,
  insertRecord, listRecords, now, parse, profile, profileSchema, recordFilter, recordRange, removeRecord, statistics,
  updateRecord, type User } from './records.js';
import { eraseAccount, loadImage, objectStorage, type MediaRow } from './storage.js';
import { createWorker } from './worker.js';

const json = (res: Response,data: unknown) => res.json(data);
const senderInput = z.object({
  sender:z.string().trim().min(1).max(80),
  messageId:z.string().regex(/^[\w-]{1,128}$/),
  text:z.string().max(8000).default(''),
}).strict();
function escapeCalendar(value: string) {
  return value.replace(/\\/g,'\\\\').replace(/\r\n|[\r\n]/g,'\\n').replace(/[;,]/g,'\\$&');
}
function calendarTime(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
}
function foldCalendar(line: string) {
  let result = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
    result += char;
    bytes += size;
  }
  return result;
}

export async function createService(config: Config = readConfig(), options: {ai?:AIProvider;poll?:boolean} = {}) {
  const store = await openStore(config);
  try { await migrate(store); } catch (error) { await store.close(); throw error; }
  const ai = options.ai ?? createAIProvider(config.env);
  const objects = objectStorage(config);
  const worker = createWorker(store,config,ai,objects);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy',config.TRUST_PROXY_HOPS);
  app.use((_req,res,next) => {
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    next();
  });
  app.use(cors({origin: (origin,callback) => callback(null,!!origin && config.origins.includes(origin))}));
  app.use(express.json({limit:'128kb'}));
  app.get('/healthz',(_req,res) => json(res,{ok:true,mode:config.LIFELOG_MODE}));
  app.use('/api',rateLimit({windowMs:60000,limit:240,standardHeaders:'draft-8',legacyHeaders:false,
    message:{code:'RATE_LIMIT',error:'请求过于频繁，请稍后再试'}}));
  const loginLimit = rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,
    message:{code:'RATE_LIMIT',error:'登录过于频繁，请稍后再试'}});

  app.get('/api/status',(_req,res) => json(res,{
    mode:config.LIFELOG_MODE,ai:ai.kind,wechat:!!config.wechat,notifications:'in-app',vision:ai.vision,
  }));
  app.post('/api/auth/demo',loginLimit,async (req,res) => {
    if (!config.demo) throw new ApiError(404,'DEMO_DISABLED','演示入口已关闭');
    const {deviceId} = parse(z.object({deviceId:z.string().regex(/^[a-zA-Z0-9_-]{32,128}$/)}).strict(),req.body);
    json(res,await store.transaction(db => newSession(db,'demo-app',sha(deviceId))));
  });
  app.post('/api/auth/wechat',loginLimit,async (req,res) => {
    if (config.demo) throw new ApiError(404,'WECHAT_DISABLED','当前为本地演示模式');
    const {code} = parse(z.object({code:z.string().regex(/^[a-zA-Z0-9_-]{6,256}$/)}).strict(),req.body);
    const id = await wechatLogin(code,config);
    json(res,await store.transaction(db => newSession(db,'wechat-mp',id)));
  });

  function read<T>(req: Request,fn: (db: Sql,user: User) => Promise<T>) {
    return store.query(async db => fn(db,await authenticatedUser(db,req.get('Authorization'))));
  }
  function write<T>(req: Request,fn: (db: Sql,user: User) => Promise<T>) {
    return store.transaction(async db => fn(db,await authenticatedUser(db,req.get('Authorization'))));
  }

  app.get('/api/me',async (req,res) => json(res,await read(req,profile)));
  const updateMe: express.RequestHandler = async (req,res) => {
    const values = parse(profileSchema,req.body);
    json(res,await write(req,async (db,user) => {
      const updated = {...user,name:values.name ?? user.name,timezone:values.timezone ?? user.timezone,
        weight_kg:values.weightKg === undefined ? user.weight_kg : values.weightKg,updated_at:now()};
      await db.run('UPDATE users SET name=?,timezone=?,weight_kg=?,updated_at=? WHERE id=?',
        [updated.name,updated.timezone,updated.weight_kg,updated.updated_at,user.id]);
      return profile(db,updated);
    }));
  };
  app.route('/api/me').patch(updateMe).put(updateMe);
  app.put('/api/goals',async (req,res) => {
    const goals = parse(goalsSchema,req.body);
    json(res,await write(req,async (db,user) => {
      await db.run(`INSERT INTO nutrition_goals(user_id,mode,kcal,protein,carbs,fat,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (user_id) DO UPDATE SET mode=excluded.mode,kcal=excluded.kcal,
        protein=excluded.protein,carbs=excluded.carbs,fat=excluded.fat,updated_at=excluded.updated_at`,
      [user.id,goals.mode,goals.kcal,goals.protein,goals.carbs,goals.fat,now(),now()]);
      return profile(db,user);
    }));
  });
  app.post('/api/binding/code',async (req,res) => json(res,await write(req,issueCode)));
  app.get('/api/records',async (req,res) => json(res,await read(req,(db,user) => listRecords(db,user.id,parse(recordFilter,req.query)))));
  app.get('/api/records/:id',async (req,res) => json(res,await read(req,(db,user) => getRecord(db,user.id,parse(idSchema,req.params.id)))));
  app.post('/api/records',async (req,res) => res.status(201).json(await write(req,(db,user) => insertRecord(db,user,checkedRecord(req.body)))));
  const editRecord: express.RequestHandler = async (req,res) => {
    json(res,await write(req,(db,user) => updateRecord(db,user,parse(idSchema,req.params.id),checkedRecord(req.body))));
  };
  app.route('/api/records/:id').patch(editRecord).put(editRecord);
  app.delete('/api/records/:id',async (req,res) => {
    await write(req,(db,user) => removeRecord(db,user,parse(idSchema,req.params.id)));
    json(res,{ok:true});
  });
  app.post('/api/records/:id/complete',async (req,res) => {
    const {completed} = parse(z.object({completed:z.boolean()}).strict(),req.body);
    json(res,await write(req,(db,user) => completeTodo(db,user,parse(idSchema,req.params.id),completed)));
  });
  app.get('/api/stats',async (req,res) => {
    const days = parse(z.enum(['7','30']).default('7'),req.query.days) === '7' ? 7 : 30;
    json(res,await read(req,(db,user) => statistics(db,user,days)));
  });
  app.get('/api/summary/today',async (req,res) => json(res,await read(req,(db,user) => dailySummary(db,user,false))));
  app.post('/api/summary/memo',loginLimit,async (req,res) => {
    const {date} = parse(z.object({date:dateSchema}).strict(),req.body);
    const memos = await read(req,(db,user) => recordRange(db,user.id,date,date,'memo'));
    if (memos.length > 100 || memos.reduce((size,record) => size + record.content.length + record.title.length,0) > 30000) {
      throw new ApiError(422,'SUMMARY_TOO_LONG','当日备忘录内容超过摘要输入上限');
    }
    if (!memos.length) return json(res,{date,count:0,provider:ai.kind === 'remote' ? 'remote' : 'local',text:'这一天暂无备忘录。'});
    if (ai.kind === 'unconfigured') throw new ApiError(503,'AI_UNCONFIGURED','服务端尚未配置 AI 模型');
    let text: string;
    try { text = await ai.summarize(memos); }
    catch { throw new ApiError(502,'AI_SUMMARY_FAILED','摘要生成失败，请稍后重试'); }
    json(res,{date,text,provider:ai.kind,count:memos.length});
  });
  app.get('/api/media/:id',async (req,res) => {
    const row = await read(req,async (db,user) => db.one<MediaRow>(`SELECT m.* FROM media m JOIN raw_messages r ON m.raw_message_id=r.id
      WHERE m.id=? AND r.user_id=? AND m.expires_at>?`,[parse(idSchema,req.params.id),user.id,now()]));
    if (!row) throw new ApiError(404,'MEDIA_NOT_FOUND','图片不存在或已到期');
    const image = await loadImage(row,objects).catch(() => { throw new ApiError(503,'MEDIA_UNAVAILABLE','暂时无法读取图片'); });
    res.type(image.mime).send(image.buffer);
  });
  app.get('/api/jobs',async (req,res) => json(res,await read(req,async (db,user) => ({
    items:(await db.all<Job & {channel:'wechat-oa'|'demo-oa'}>(`SELECT j.*,r.channel FROM ai_jobs j JOIN raw_messages r ON r.id=j.raw_message_id
      WHERE r.user_id=? ORDER BY j.created_at DESC LIMIT 100`,[user.id])).map(jobDto),
  }))));
  app.get('/api/jobs/:id',async (req,res) => json(res,await read(req,async (db,user) => jobDto(await userJob(db,user.id,parse(idSchema,req.params.id))))));
  app.post('/api/jobs/:id/retry',async (req,res) => {
    await write(req,async (db,user) => {
      const job = await userJob(db,user.id,parse(idSchema,req.params.id));
      if (job.status !== 'failed') throw new ApiError(409,'JOB_NOT_FAILED','仅处理失败的任务可以重试');
      await db.run("UPDATE ai_jobs SET status='queued',attempts=0,error=NULL,available_at=?,updated_at=? WHERE id=?",[now(),now(),job.id]);
      await db.run("UPDATE raw_messages SET status='queued',updated_at=? WHERE id=?",[now(),job.raw_message_id]);
    });
    json(res,{ok:true});
  });
  app.get('/api/export',loginLimit,async (req,res) => {
    const data = await read(req,async (db,user) => ({
      version:1,exportedAt:now(),profile:await profile(db,user),
      records:await recordRange(db,user.id,'1900-01-01','2200-12-31'),
      messages:await db.all(`SELECT id,message_key AS message_id,channel,kind,text,meta_json,source_sent_at,received_at,status
        FROM raw_messages WHERE user_id=? ORDER BY received_at`,[user.id]),
    }));
    res.attachment('lifelog.json').json(data);
  });
  app.get('/api/calendar',async (req,res) => {
    const records = await read(req,(db,user) => recordRange(db,user.id,'1900-01-01','2200-12-31','todo'));
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//LifeLog AI//Personal calendar//ZH','CALSCALE:GREGORIAN'];
    for (const record of records) {
      if (record.type !== 'todo' || record.data.completed) continue;
      const {startAt,dueAt,remindAt,repeat} = record.data;
      const start = startAt ?? dueAt;
      lines.push('BEGIN:VEVENT','UID:' + record.id + '@lifelog.local','DTSTAMP:' + calendarTime(record.updatedAt),
        start ? 'DTSTART:' + calendarTime(start) : 'DTSTART;VALUE=DATE:' + record.eventDate.replace(/-/g,''),
        'SUMMARY:' + escapeCalendar(record.title));
      if (startAt && dueAt && dueAt !== startAt) lines.push('DTEND:' + calendarTime(dueAt));
      if (record.content) lines.push('DESCRIPTION:' + escapeCalendar(record.content));
      if (repeat && repeat !== 'none') {
        // An already-materialized successor represents the rest of the series.
        lines.push('RRULE:FREQ=' + repeat.toUpperCase());
      }
      if (remindAt) lines.push('BEGIN:VALARM','TRIGGER;VALUE=DATE-TIME:' + calendarTime(remindAt),'ACTION:DISPLAY',
        'DESCRIPTION:' + escapeCalendar(record.title),'END:VALARM');
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR','');
    res.attachment('lifelog.ics').type('text/calendar').send(lines.map(foldCalendar).join('\r\n'));
  });
  app.delete('/api/me',async (req,res) => {
    parse(z.object({confirm:z.literal('DELETE')}).strict(),req.body);
    await write(req,(db,user) => eraseAccount(db,user.id));
    json(res,{ok:true});
  });

  const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:3,fieldSize:32*1024,parts:5}});
  app.post('/api/demo/messages',async (req,_res,next) => {
    if (!config.demo) throw new ApiError(404,'DEMO_DISABLED','演示入口已关闭');
    await read(req,async () => true);
    next();
  },upload.single('image'),async (req,res) => {
    const {sender,messageId,text} = parse(senderInput,req.body);
    let image;
    if (req.file) {
      try { image = validateImage(req.file.buffer,req.file.mimetype); }
      catch { throw new ApiError(400,'INVALID_IMAGE','仅接受真实的 PNG、JPEG 或 WebP 图片'); }
    }
    if (!image && !text.trim()) throw new ApiError(400,'EMPTY_MESSAGE','请填写文字或选择图片');
    const user = await read(req,async (_db,user) => user);
    const data = await receiveMessage(store,{channel:'demo-oa',externalId:demoExternal(user.id,sender),messageKey:messageId,
      kind:image ? 'image' : 'text',text,image},config.MEDIA_RETENTION_DAYS,false,user.id);
    json(res,data);
  });

  app.get('/webhooks/wechat',(req,res) => {
    if (!config.wechat) throw new ApiError(404,'WECHAT_DISABLED','微信公众号回调未启用');
    res.type('text/plain').send(verifyHandshake(req.query,config.wechat));
  });
  app.post('/webhooks/wechat',express.text({type:['text/xml','application/xml','text/plain','application/octet-stream'],limit:'96kb'}),async (req,res) => {
    if (!config.wechat) throw new ApiError(404,'WECHAT_DISABLED','微信公众号回调未启用');
    if (typeof req.body !== 'string') throw new ApiError(400,'INVALID_XML','微信回调须使用 XML');
    const message = readWechatCallback(req.body,req.query,config.wechat);
    if (!message) return res.type('text/plain').send('success');
    const {id,openid,toUser,kind,text,sentAt,mediaId,mediaId16k,format} = message;
    const persist = receiveMessage(store,{channel:'wechat-oa',externalId:(config.WECHAT_OA_APP_ID ?? 'oa') + ':' + openid,
      messageKey:id,kind,text,sourceSentAt:sentAt,meta:{toUser,mediaId,mediaId16k,format}},
      config.MEDIA_RETENTION_DAYS,config.WECHAT_MEDIA_DOWNLOAD && !!objects);
    const deadline = new AbortController();
    try {
      const result = await Promise.race([persist,delay(4000,null,{signal:deadline.signal})]);
      if (!result) throw new ApiError(503,'CALLBACK_BUSY','回调处理繁忙，请重投');
      return res.type('application/xml').send(makeWechatReply(message,result.reply,config.wechat));
    } finally { deadline.abort(); }
  });

  app.post('/internal/tick',async (req,res) => {
    const secret = config.INTERNAL_TICK_SECRET;
    const given = /^Bearer (.+)$/.exec(req.get('Authorization') ?? '')?.[1] ?? '';
    if (!secret || !timingSafeEqual(Buffer.from(sha(secret),'hex'),Buffer.from(sha(given),'hex'))) {
      throw new ApiError(404,'NOT_FOUND','接口不可用');
    }
    void worker.tick().catch(() => console.error('定时触发后的队列暂时不可用'));
    res.status(202).json({ok:true,accepted:true});
  });
  if (config.demo) app.use(express.static(resolve(import.meta.dirname,'../../web/dist/build/h5')));
  app.use((_req,_res,next) => next(new ApiError(404,'NOT_FOUND','接口不存在')));
  app.use((error: unknown,_req: Request,res: Response,_next: express.NextFunction) => {
    if (error instanceof ApiError) return res.status(error.status).json({code:error.code,error:error.message});
    if (error instanceof WechatError) return res.status(error.statusCode).json({code:'WECHAT_INVALID',error:'微信消息校验失败'});
    if (error instanceof multer.MulterError) return res.status(400).json({code:'UPLOAD_INVALID',error:'上传文件过大或表单无效'});
    const status = (error as {status?:number})?.status;
    if (status === 400 || status === 413 || status === 415) return res.status(status).json({code:'BODY_INVALID',error:'请求格式无效或超出大小限制'});
    console.error('请求处理失败',randomUUID());
    return res.status(500).json({code:'SERVER_ERROR',error:'服务暂时不可用'});
  });
  const timer = options.poll === false ? undefined : setInterval(() => {
    void worker.tick().catch(() => console.error('后台队列暂时不可用'));
  },750);
  timer?.unref();

  return {app,store,worker,async close() {
    clearInterval(timer);
    await worker.idle();
    await store.close();
  }};
}
