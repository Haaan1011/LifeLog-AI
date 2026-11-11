import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { newSession } from '../src/identity.js';
import { localDate, shiftDate } from '../src/records.js';
import type { AIProvider } from '../src/intake/provider.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+rWv8AAAAASUVORK5CYII=','base64');
const today = localDate('Asia/Shanghai');
const tomorrow = shiftDate(today,1);
const tokenSecret = 'internal-test-secret-with-32-characters';
type Body = Record<string, unknown> | FormData | string;
type Expected = {status?:number;token?:string;body?:Body;headers?:Record<string,string>};

test('公众号服务可先配置，数据库和小程序登录分别检查所需凭据', () => {
  const config = readConfig({LIFELOG_MODE:'production',DATABASE_URL:'postgresql://localhost/lifelog'});
  assert.equal(config.demo, false);
  assert.equal(config.WECHAT_MP_APP_ID, undefined);
  assert.throws(() => readConfig({LIFELOG_MODE:'production'}), /DATABASE_URL/);
});

async function fixture(opts: {ai?:AIProvider;wechat?:boolean;path?:string} = {}) {
  const cfg = readConfig({LIFELOG_MODE:'demo',DEMO_DB_PATH:opts.path ?? ':memory:',INTERNAL_TICK_SECRET:tokenSecret});
  if (opts.wechat) cfg.wechat = {token:'test-token',mode:'plain',appId:'wx-test',aesKey:undefined};
  const service = await createService(cfg,{poll:false,ai:opts.ai});
  const listener = service.app.listen(0,'127.0.0.1');
  await once(listener,'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  async function request(method:string,path:string,options:Expected = {}) {
    const body = options.body;
    const response = await fetch(base + path,{method,headers:{
      ...(body && !(body instanceof FormData) ? {'Content-Type':typeof body === 'string' ? 'text/xml' : 'application/json'} : {}),
      ...(options.token ? {Authorization:'Bearer ' + options.token} : {}), ...options.headers,
    },body:!body ? undefined : body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body)});
    assert.equal(response.status,options.status ?? 200,path + ' ' + (response.status === (options.status ?? 200) ? '' : await response.clone().text()));
    return response;
  }
  async function api(method:string,path:string,options?:Expected) {
    return (await request(method,path,options)).json();
  }
  async function session(deviceId=randomUUID()) {
    return (await api('POST','/api/auth/demo',{body:{deviceId}})).token as string;
  }
  async function message(token:string,text:string,opts:{id?:string;image?:Buffer;sender?:string;mime?:string;status?:number} = {}) {
    const form = new FormData();
    form.append('sender',opts.sender ?? 'primary');
    form.append('messageId',opts.id ?? randomUUID());
    form.append('text',text);
    if (opts.image) form.append('image',new Blob([new Uint8Array(opts.image)],{type:opts.mime ?? 'image/png'}),'meal.png');
    return api('POST','/api/demo/messages',{token,body:form,status:opts.status});
  }
  async function bind(token:string,sender?:string) {
    const {code} = await api('POST','/api/binding/code',{token});
    const result = await message(token,'绑定 ' + code,{sender});
    assert.equal(result.status,'bound');
    return code;
  }
  return {api,request,session,message,bind,service,close:async () => {
    await new Promise<void>((resolve,reject) => listener.close(error => error ? reject(error) : resolve()));
    await service.close();
  }};
}

test('SQLite 演示闭环、绑定前暂存、重复投递和图片隐私',async () => {
  const f = await fixture();
  try {
    const token = await f.session();
    const other = await f.session();
    const prebound = await f.message(token,'今天早餐吃了两个鸡蛋、一杯250ml牛奶和两片面包。',{id:'meal-1'});
    assert.equal(prebound.status,'unbound');
    assert.equal((await f.api('GET','/api/records',{token})).total,0);
    const code = await f.api('POST','/api/binding/code',{token});
    assert.equal((await f.message(other,'绑定 ' + code.code)).status,'rejected');
    assert.equal((await f.message(token,'绑定 ' + code.code)).status,'bound');
    assert.equal((await f.message(token,'绑定 ' + code.code,{sender:'another'})).status,'rejected');
    assert.equal((await f.api('GET','/api/me',{token})).bound,true);
    assert.equal(await f.service.worker.tick(),true);
    const results = await f.api('GET','/api/records?type=diet',{token});
    assert.equal(results.total,1);
    assert.equal(results.items[0].data.items.length,3);
    assert.ok(results.items[0].data.items.every((item:{nutrition:unknown}) => item.nutrition));
    const originalKcal = (await f.api('GET','/api/stats',{token})).days.at(-1).kcal;
    const {type,title,content,eventDate,data} = results.items[0];
    data.items[0].grams *= 2;
    const updated = await f.api('PATCH','/api/records/' + results.items[0].id,{token,body:{type,title,content,eventDate,data}});
    assert.equal(updated.data.items[0].nutrition.kcal > 0,true);
    assert.ok((await f.api('GET','/api/stats',{token})).days.at(-1).kcal > originalKcal);
    assert.equal((await f.message(token,'这是重复内容',{id:'meal-1'})).duplicate,true);
    assert.equal((await f.api('GET','/api/records?type=diet',{token})).total,1);

    const picture = await f.message(token,'',{image:PNG,id:'image-1'});
    assert.equal(picture.status,'queued');
    await f.service.worker.tick();
    const imageRecord = (await f.api('GET','/api/records?type=diet',{token})).items.find((record:{imageId:string}) => record.imageId);
    assert.equal(imageRecord.status,'review');
    assert.deepEqual(Buffer.from(await (await f.request('GET','/api/media/' + imageRecord.imageId,{token})).arrayBuffer()),PNG);
    await f.request('GET','/api/media/' + imageRecord.imageId,{token:other,status:404});
    await f.request('GET','/api/records/' + imageRecord.id,{token:other,status:404});
    await f.request('DELETE','/api/records/' + imageRecord.id,{token:other,status:404});
    await f.message(token,'',{image:Buffer.from('<svg>fake</svg>'),status:400});
    await f.api('DELETE','/api/records/' + results.items[0].id,{token});
    assert.equal((await f.api('GET','/api/stats',{token})).days.at(-1).kcal,0);
    assert.equal((await f.message(token,'原记录已删仍要去重',{id:'meal-1'})).duplicate,true);
    assert.equal((await f.api('GET','/api/records',{token:other})).total,0);
  } finally { await f.close(); }
});

test('混合消息、筛选、训练、待办循环、目标和导出',async () => {
  const f = await fixture();
  try {
    const token = await f.session();
    await f.bind(token);
    await f.api('PATCH','/api/me',{token,body:{weightKg:70,timezone:'Asia/Shanghai'}});
    const goals = {mode:'maintain',kcal:2100,protein:120,carbs:250,fat:70};
    assert.deepEqual((await f.api('PUT','/api/goals',{token,body:goals})).goals,goals);
    const intake = await f.message(token,'今天下午做了实验，晚上练了腿，明天上午十点交报告。');
    await f.service.worker.tick();
    assert.equal((await f.api('GET','/api/jobs/' + intake.jobId,{token})).status,'done');
    const all = await f.api('GET','/api/records',{token});
    assert.deepEqual(all.items.map((row:{type:string}) => row.type).sort(),['memo','todo','workout']);
    assert.equal((await f.api('GET','/api/records?type=memo&q=' + encodeURIComponent('实验'),{token})).total,1);
    assert.equal((await f.api('GET','/api/records?from=' + tomorrow + '&to=' + tomorrow,{token})).total,1);
    assert.match((await f.api('POST','/api/summary/memo',{token,body:{date:today}})).text,/实验/);
    await f.message(token,'今天练背，硬拉80kg做了4组，每组8次，高位下拉50kg做了3组，每组12次，训练大概60分钟。');
    await f.service.worker.tick();
    const stats = await f.api('GET','/api/stats?days=30',{token});
    assert.equal(stats.days.length,30);
    assert.equal(stats.days.at(-1).volumeKg,4360);
    assert.ok(stats.days.at(-1).estimatedKcal > 0);
    assert.equal(stats.exerciseTrends.find((entry:{name:string}) => entry.name === '硬拉').points.at(-1).weightKg,80);
    const body = {type:'todo',title:'刷牙',content:'每天晚上',eventDate:today,data:{repeat:'daily',priority:'normal'}};
    const todo = await f.api('POST','/api/records',{token,body,status:201});
    const {next} = await f.api('POST','/api/records/' + todo.id + '/complete',{token,body:{completed:true}});
    assert.equal(next.eventDate,tomorrow);
    await f.api('POST','/api/records/' + todo.id + '/complete',{token,body:{completed:true}});
    assert.equal((await f.api('GET','/api/records?type=todo&q=' + encodeURIComponent('刷牙'),{token})).total,2);
    const edit = await f.api('PATCH','/api/records/' + next.id,{token,body:{...body,title:'整理笔记',eventDate:tomorrow}});
    assert.equal(edit.title,'整理笔记');
    const ics = await (await f.request('GET','/api/calendar',{token})).text();
    assert.match(ics,/RRULE:FREQ=DAILY/);
    assert.match(ics,/整理笔记/);
    await f.api('DELETE','/api/records/' + next.id,{token});
    assert.equal((await f.api('GET','/api/summary/today',{token})).todoCount,0);
    assert.ok((await f.api('GET','/api/export',{token})).records.length >= 5);
    await f.api('DELETE','/api/me',{token,body:{confirm:'DELETE'}});
    await f.api('GET','/api/me',{token,status:401});
  } finally { await f.close(); }
});

test('队列失败可见、手动重试、无重复写入',async () => {
  let fail = true;
  const ai: AIProvider = {kind:'local',vision:false,version:'test',
    async parse() {
      if (fail) throw new Error('private failure');
      return [{type:'memo',title:'恢复后记录',content:'ok',data:{tags:[]},eventDate:today,confidence:1}];
    },async summarize(){return 'ok';},
  };
  const f = await fixture({ai});
  try {
    const token = await f.session();
    await f.bind(token);
    const received = await f.message(token,'故意触发失败');
    for (let count=0; count<3; count++) {
      await f.service.worker.tick();
      await f.service.store.transaction(db => db.run("UPDATE ai_jobs SET available_at=? WHERE status='queued'",[new Date(0).toISOString()]));
    }
    const job = await f.api('GET','/api/jobs/' + received.jobId,{token});
    assert.equal(job.status,'failed');
    assert.doesNotMatch(job.error,/private failure/);
    assert.equal(job.attempts,3);
    assert.equal((await f.api('GET','/api/records',{token})).total,0);
    fail = false;
    await f.api('POST','/api/jobs/' + received.jobId + '/retry',{token});
    await f.api('POST','/api/jobs/' + received.jobId + '/retry',{token,status:409});
    await f.request('POST','/internal/tick',{token:'bad',status:404});
    assert.equal((await f.api('POST','/internal/tick',{token:tokenSecret,status:202})).accepted,true);
    await f.service.worker.idle();
    assert.equal((await f.api('GET','/api/records',{token})).total,1);
  } finally { await f.close(); }
});

test('真实 XML 接口协议的本地签名测试与并发重复投递',async () => {
  const f = await fixture({wechat:true});
  try {
    const {token} = await f.service.store.transaction(db => newSession(db,'wechat-mp','wx-test:mp'));
    const {code} = await f.api('POST','/api/binding/code',{token});
    const time = String(Math.floor(Date.now()/1000));
    const nonce = 'nonce123';
    const signature = createHash('sha1').update(['test-token',time,nonce].sort().join('')).digest('hex');
    const path = `/webhooks/wechat?timestamp=${time}&nonce=${nonce}&signature=${signature}`;
    assert.equal(await (await f.request('GET',path + '&echostr=hello')).text(),'hello');
    const msg = (id:string,content:string) => `<xml><ToUserName>gh_test</ToUserName><FromUserName>openid_abcdefgh</FromUserName><CreateTime>${time}</CreateTime><MsgType>text</MsgType><Content><![CDATA[${content}]]></Content><MsgId>${id}</MsgId></xml>`;
    await f.request('POST',path.replace(signature,'b'.repeat(40)),{body:msg('100','无效'),status:403});
    assert.match(await (await f.request('POST',path,{body:msg('100','绑定 ' + code)})).text(),/绑定成功/);
    const duplicate = msg('9223372036854775807','今天开完了组会');
    await Promise.all(Array.from({length:5},() => f.request('POST',path,{body:duplicate})));
    await f.service.worker.tick();
    assert.equal((await f.api('GET','/api/records',{token})).total,1);
    assert.equal((await f.api('GET','/api/jobs',{token})).items.length,1);
  } finally { await f.close(); }
});

test('磁盘重启保留数据、会话和账号归属',async () => {
  const dir = await mkdtemp(join(tmpdir(),'lifelog-test-'));
  const path = join(dir,'persist.sqlite');
  let token: string;
  try {
    const before = await fixture({path});
    try {
      token = await before.session();
      await before.api('POST','/api/records',{token,status:201,body:{
        type:'memo',title:'持久化',content:'跨进程保留',eventDate:today,data:{tags:['测试']},
      }});
    } finally { await before.close(); }
    const afterRestart = await fixture({path});
    try { assert.equal((await afterRestart.api('GET','/api/records',{token})).items[0].title,'持久化'); }
    finally { await afterRestart.close(); }
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('过期绑定码、尝试限额和截止日前的站内提醒',async () => {
  const f = await fixture();
  try {
    const token = await f.session();
    const expired = await f.api('POST','/api/binding/code',{token});
    await f.service.store.transaction(db => db.run('UPDATE bind_codes SET expires_at=?',[new Date(0).toISOString()]));
    assert.match((await f.message(token,'绑定 ' + expired.code)).reply,/过期/);
    for (let i=0;i<4;i++) await f.message(token,'绑定 INVALID' + i);
    const valid = await f.api('POST','/api/binding/code',{token});
    assert.match((await f.message(token,'绑定 ' + valid.code)).reply,/次数过多/);
    assert.equal((await f.api('GET','/api/me',{token})).bound,false);
    const dueLater = {type:'todo',title:'明天提交',content:'',eventDate:tomorrow,data:{remindAt:new Date(Date.now()-10000).toISOString()}};
    await f.api('POST','/api/records',{token,status:201,body:dueLater});
    const summary = await f.api('GET','/api/summary/today',{token});
    assert.equal(summary.todoCount,0);
    assert.equal(summary.dueReminders,1);
  } finally { await f.close(); }
});
