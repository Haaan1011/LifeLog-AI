import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import type { Sql } from './db.js';
import { normalizeRecord, RecordInputSchema, type RecordInput } from './intake/records.js';

export const now = () => new Date().toISOString();
export const after = (ms: number) => new Date(Date.now() + ms).toISOString();
export const localDate = (timezone: string, instant = now()) =>
  Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toPlainDate().toString();
export const shiftDate = (date: string, days: number) => Temporal.PlainDate.from(date).add({ days }).toString();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { return Temporal.PlainDate.from(value).year >= 1900; } catch { return false; }
}, '日期无效');
export const timezoneSchema = z.string().max(64).refine(value => {
  try { new Intl.DateTimeFormat('zh-CN',{timeZone: value}).format(); return true; } catch { return false; }
}, '时区无效');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiError(400,'INVALID_INPUT','请检查输入' + (issue.path.length ? '（' + issue.path.join('.') + '）' : ''));
  }
  return result.data;
}
export const notFound = () => new ApiError(404,'NOT_FOUND','未找到该记录');
export const idSchema = z.string().uuid();

export type User = {id:string;name:string;timezone:string;weight_kg:number|null;created_at:string;updated_at:string};
const target = (max: number) => z.number().finite().min(0.1).max(max).nullable();
export const goalsSchema = z.object({
  mode:z.enum(['cut','maintain','gain']), kcal:target(20000), protein:target(2000),
  carbs:target(3000), fat:target(2000),
}).strict();
export const profileSchema = z.object({
  name:z.string().trim().min(1).max(48).optional(),
  timezone:timezoneSchema.optional(), weightKg:z.number().finite().min(15).max(700).nullable().optional(),
}).strict();
export async function profile(db: Sql, user: User) {
  const goals = await db.one<z.infer<typeof goalsSchema>>('SELECT mode,kcal,protein,carbs,fat FROM nutrition_goals WHERE user_id=?',[user.id]);
  const bound = !!await db.one("SELECT 1 AS present FROM account_links WHERE user_id=? AND channel IN ('wechat-oa','demo-oa')",[user.id]);
  return {
    id:user.id,name:user.name,timezone:user.timezone,weightKg:user.weight_kg,bound,
    goals: goals ?? {mode:'maintain',kcal:null,protein:null,carbs:null,fat:null},
  };
}

type Source = 'manual'|'wechat'|'demo';
type RecordRow = {
  id:string;raw_message_id:string|null;type:RecordInput['type'];title:string;content:string;note:string;status:RecordInput['status'];
  data_json:string;event_date:string;timezone:string;confidence:number|null;source:Source;ai_version:string|null;
  created_at:string;updated_at:string;image_id:string|null;original_text:string|null;
};
const recordView = `SELECT r.*, m.id AS image_id, w.text AS original_text
  FROM records r LEFT JOIN raw_messages w ON w.id=r.raw_message_id
  LEFT JOIN media m ON m.raw_message_id=r.raw_message_id AND m.expires_at>?`;

function recordDto(row: RecordRow) {
  const input = {type:row.type,title:row.title,content:row.content,note:row.note,
    status:row.status,eventDate:row.event_date,data:JSON.parse(row.data_json)} as RecordInput;
  return {
    ...input,id:row.id,timezone:row.timezone,confidence:row.confidence,source:row.source,aiVersion:row.ai_version,
    createdAt:row.created_at,updatedAt:row.updated_at,rawMessageId:row.raw_message_id,imageId:row.image_id,originalText:row.original_text,
  };
}
export type LifeRecord = ReturnType<typeof recordDto>;
export async function getRecord(db: Sql, userId: string, id: string): Promise<LifeRecord> {
  const row = await db.one<RecordRow>(recordView + ' WHERE r.user_id=? AND r.id=?',[now(),userId,id]);
  if (!row) throw notFound();
  return recordDto(row);
}

export const recordFilter = z.object({
  type:z.enum(['diet','workout','memo','todo']).optional(), from:dateSchema.optional(),to:dateSchema.optional(),
  q:z.string().trim().max(200).optional(), limit:z.coerce.number().int().min(1).max(200).default(50),
  offset:z.coerce.number().int().min(0).max(1000000).default(0),
}).refine(v => !v.from || !v.to || v.from <= v.to);
export async function listRecords(db: Sql, userId: string, options: z.infer<typeof recordFilter>) {
  const clauses = ['r.user_id=?'];
  const args = [userId];
  if (options.type) { clauses.push('r.type=?'); args.push(options.type); }
  if (options.from) { clauses.push('r.event_date>=?'); args.push(options.from); }
  if (options.to) { clauses.push('r.event_date<=?'); args.push(options.to); }
  if (options.q) {
    clauses.push("LOWER(r.title || ' ' || r.content || ' ' || r.note || ' ' || r.data_json || ' ' || COALESCE(w.text,'')) LIKE ? ESCAPE '!'");
    args.push('%' + options.q.toLowerCase().replace(/[!%_]/g,'!$&') + '%');
  }
  const where = ' WHERE ' + clauses.join(' AND ');
  const total = await db.one<{total:number|string}>(
    'SELECT COUNT(*) AS total FROM records r LEFT JOIN raw_messages w ON w.id=r.raw_message_id' + where,args);
  const rows = await db.all<RecordRow>(recordView + where + ' ORDER BY r.event_date DESC,r.created_at DESC,r.id DESC LIMIT ? OFFSET ?',
    [now(), ...args,options.limit,options.offset]);
  return {items:rows.map(recordDto),total:Number(total?.total ?? 0)};
}
export async function recordRange(db: Sql, userId: string, from: string, to: string, type?: RecordInput['type']) {
  const rows = await db.all<RecordRow>(recordView + ' WHERE r.user_id=? AND r.event_date>=? AND r.event_date<=?' +
    (type ? ' AND r.type=?' : '') + ' ORDER BY r.event_date,r.created_at,r.id',[now(),userId,from,to,...(type ? [type] : [])]);
  return rows.map(recordDto);
}

export function checkedRecord(value: unknown) {
  const result = parse(RecordInputSchema,value);
  parse(dateSchema,result.eventDate);
  return result;
}
type Origin = {source:Source;rawId?:string;index?:number;version?:string;confidence?:number;parent?:string};
export async function insertRecord(db: Sql, user: User, input: RecordInput, origin: Origin = {source:'manual'}) {
  const record = normalizeRecord(input,user.weight_kg ?? undefined);
  const id = randomUUID();
  const timestamp = now();
  await db.run(`INSERT INTO records(id,user_id,raw_message_id,raw_index,recurring_parent,type,title,content,note,status,
      data_json,event_date,timezone,confidence,source,ai_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,user.id,origin.rawId ?? null,origin.index ?? null,origin.parent ?? null,record.type,record.title,record.content,
      record.note ?? '',record.status ?? 'confirmed',JSON.stringify(record.data),record.eventDate,user.timezone,
      origin.confidence ?? null,origin.source,origin.version ?? null,timestamp,timestamp]);
  return getRecord(db,user.id,id);
}

export async function updateRecord(db: Sql, user: User, id: string, input: RecordInput) {
  const previous = await getRecord(db,user.id,id);
  if (previous.type !== input.type && previous.status !== 'review') throw new ApiError(400,'TYPE_IMMUTABLE','只有待确认记录可以调整类别');
  const record = normalizeRecord(input,user.weight_kg ?? undefined);
  await db.run(`UPDATE records SET type=?,title=?,content=?,note=?,status=?,data_json=?,event_date=?,updated_at=?
    WHERE id=? AND user_id=?`,[record.type,record.title,record.content,record.note ?? '',record.status ?? 'confirmed',
      JSON.stringify(record.type === 'todo' && previous.type === 'todo' ? {...record.data,completed:previous.data.completed ?? false} : record.data),
      record.eventDate,now(),id,user.id]);
  return getRecord(db,user.id,id);
}

export async function removeRecord(db: Sql, user: User, id: string) {
  const record = await getRecord(db,user.id,id);
  await db.run('DELETE FROM records WHERE id=? AND user_id=?',[id,user.id]);
  if (!record.rawMessageId) return;
  const sibling = await db.one('SELECT 1 AS present FROM records WHERE raw_message_id=? AND user_id=?',[record.rawMessageId,user.id]);
  if (!sibling) {
    // Keep a minimal deduplication receipt while erasing content and attachments.
    await db.run('INSERT INTO media_gc(id,created_at) SELECT id,? FROM media WHERE raw_message_id=? AND bytes_b64 IS NULL ON CONFLICT DO NOTHING',[now(),record.rawMessageId]);
    await db.run('DELETE FROM media WHERE raw_message_id=?',[record.rawMessageId]);
    await db.run("UPDATE raw_messages SET text='',meta_json='{}',updated_at=? WHERE id=? AND user_id=?",[now(),record.rawMessageId,user.id]);
  }
}

export async function completeTodo(db: Sql,user: User,id: string,completed:boolean) {
  const record = await getRecord(db,user.id,id);
  if (record.type !== 'todo') throw new ApiError(400,'TYPE_MISMATCH','请选择待办事项');
  await db.run('UPDATE records SET data_json=?,updated_at=? WHERE id=? AND user_id=?',
    [JSON.stringify({...record.data,completed}),now(),id,user.id]);
  let next: LifeRecord|null = null;
  if (completed && !record.data.completed && record.data.repeat && record.data.repeat !== 'none') {
    const existing = await db.one<{id:string}>('SELECT id FROM records WHERE user_id=? AND recurring_parent=?',[user.id,id]);
    if (existing) next = await getRecord(db,user.id,existing.id);
    else {
      const period = record.data.repeat === 'daily' ? {days:1} : record.data.repeat === 'weekly' ? {weeks:1} : {months:1};
      const move = (value?:string|null) => value ? Temporal.Instant.from(value)
        .toZonedDateTimeISO(record.timezone).add(period).toInstant().toString() : null;
      next = await insertRecord(db,{...user,timezone:record.timezone},{
        type:'todo', title:record.title,content:record.content,note:record.note,status:record.status,
        eventDate:Temporal.PlainDate.from(record.eventDate).add(period).toString(),
        data:{...record.data,completed:false,startAt:move(record.data.startAt),dueAt:move(record.data.dueAt),remindAt:move(record.data.remindAt)},
      },{source:'manual',parent:id});
    }
  }
  return {record:await getRecord(db,user.id,id),next};
}

function emptyDay(date: string) {
  return {date,kcal:0,protein:0,carbs:0,fat:0,workouts:0,minutes:0,estimatedKcal:0,volumeKg:0,todos:0,completed:0};
}
const round = (number: number) => Math.round(number * 10) / 10;
export async function statistics(db: Sql, user: User, days: 7|30) {
  const today = localDate(user.timezone);
  const weekStart = shiftDate(today,1-Temporal.PlainDate.from(today).dayOfWeek);
  const start = shiftDate(today,1-days);
  const dates = Array.from({length:days},(_,i) => emptyDay(shiftDate(start,i)));
  const indexed = new Map(dates.map(day => [day.date,day]));
  const week = {workouts:0,minutes:0,estimatedKcal:0,volumeKg:0,groups:Object.create(null) as Record<string,number>};
  const workouts = new Map<string,Map<string,number>>();
  let nutritionUnknownToday = 0;
  for (const record of await recordRange(db,user.id,start,today)) {
    const day = indexed.get(record.eventDate)!;
    if (record.type === 'diet') {
      if (day.date === today && record.status === 'review' && !record.data.items.length) nutritionUnknownToday++;
      for (const item of record.data.items) {
        if (!item.nutrition) { if (day.date === today) nutritionUnknownToday++; continue; }
        for (const key of ['kcal','protein','carbs','fat'] as const) day[key] += item.nutrition[key];
      }
    } else if (record.type === 'workout') {
      const {durationMinutes,estimatedKcal,volumeKg} = record.data;
      day.workouts++;
      day.minutes += durationMinutes ?? 0;
      day.estimatedKcal += estimatedKcal ?? 0;
      day.volumeKg += volumeKg ?? 0;
      if (day.date >= weekStart) {
        for (const group of new Set(record.data.muscleGroups)) week.groups[group] = (week.groups[group] ?? 0) + 1;
      }
      for (const exercise of record.data.exercises) {
        const weights = exercise.sets.flatMap(set => set.weightKg == null ? [] : [set.weightKg]);
        if (!weights.length) continue;
        const series = workouts.get(exercise.name) ?? new Map<string,number>();
        series.set(day.date,Math.max(series.get(day.date) ?? 0,...weights));
        workouts.set(exercise.name,series);
      }
    } else if (record.type === 'todo') {
      day.todos++;
      if (record.data.completed) day.completed++;
    }
  }
  for (const day of dates.filter(item => item.date >= weekStart)) {
    for (const key of ['workouts','minutes','estimatedKcal','volumeKg'] as const) week[key] += day[key];
  }
  const totals = dates.reduce((sum,day) => {
    for (const key of ['workouts','minutes','estimatedKcal','volumeKg','todos','completed'] as const) sum[key] += day[key];
    return sum;
  },{workouts:0,minutes:0,estimatedKcal:0,volumeKg:0,todos:0,completed:0,completionRate:0});
  totals.completionRate = totals.todos ? totals.completed / totals.todos : 0;
  for (const aggregate of [...dates,week,totals]) {
    aggregate.estimatedKcal = round(aggregate.estimatedKcal);
    aggregate.volumeKg = round(aggregate.volumeKg);
  }
  for (const day of dates) for (const key of ['kcal','protein','carbs','fat'] as const) day[key] = round(day[key]);
  const exerciseTrends = [...workouts].map(([name,series]) => ({
    name,points:[...series].map(([date,weightKg]) => ({date,weightKg})),
  }));
  return {today,timezone:user.timezone,days:dates,week,totals,exerciseTrends,nutritionUnknownToday};
}

export async function dailySummary(db: Sql,user: User, persist: boolean) {
  const date = localDate(user.timezone);
  const records = await recordRange(db,user.id,'1900-01-01','2200-12-31','todo');
  const open = records.filter(record => record.type === 'todo' && !record.data.completed);
  const todoCount = open.filter(record => record.eventDate === date).length;
  const dueReminders = open.filter(record => record.type === 'todo' && record.data.remindAt &&
    Temporal.Instant.compare(record.data.remindAt,now()) <= 0).length;
  const existing = await db.one<{generated_at:string}>('SELECT generated_at FROM daily_summaries WHERE user_id=? AND local_date=?',[user.id,date]);
  const timestamp = now();
  if (persist) await db.run(`INSERT INTO daily_summaries(user_id,local_date,todo_count,generated_at,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT (user_id,local_date) DO UPDATE SET todo_count=excluded.todo_count,updated_at=excluded.updated_at`,
    [user.id,date,todoCount,timestamp,timestamp]);
  return {date,todoCount,dueReminders,generatedAt:existing?.generated_at ?? (persist ? timestamp : null)};
}
