# 接口协议
所有路径以 /api 开头，另有 /healthz、/webhooks/wechat、/internal/tick。JSON 直接返回下述对象，错误 {error:string,code:string}。需要鉴权的接口用 Authorization: Bearer <token>。请求和输出时间戳均为 ISO 8601，日期是用户当地 YYYY-MM-DD。记录统一 payload。

POST /api/auth/demo {deviceId} -> {token}（仅 Demo，deviceId 是本客户端生成并保留的至少 32 字符随机凭证，不是公开帐号）
POST /api/auth/wechat {code} -> {token}
GET /api/status 公开 -> {mode:'demo'|'production',ai:'local'|'remote'|'unconfigured',wechat:boolean,notifications:'in-app',vision:boolean}
GET /api/me -> {id,name,timezone,weightKg:number|null,bound:boolean,goals:{mode:'cut'|'maintain'|'gain',kcal:number|null,protein:number|null,carbs:number|null,fat:number|null}}
PUT（或 PATCH）/api/me {name?,timezone?,weightKg?} -> 同上
PUT /api/goals {mode,kcal,protein,carbs,fat} -> 同上
POST /api/binding/code -> {code,expiresAt}，用户发送 绑定 <code>。GET /api/me 查询状态。
GET /api/records?type=diet|workout|memo|todo&from=YYYY-MM-DD&to=YYYY-MM-DD&q=全文查询&limit=1..200&offset=0... -> {items:Record[],total:number}
POST /api/records RecordInput -> Record
PUT（或 PATCH）/api/records/:id RecordInput（完整字段）-> Record
DELETE /api/records/:id -> {ok:true}
POST /api/records/:id/complete {completed:boolean} -> {record:Record,next:Record|null}
RecordInput {type:'diet'|'workout'|'memo'|'todo',title:string,content:string,eventDate:string,note?:string,status?:'confirmed'|'review',data:对应下面对象}
Record 同上加 {id,timezone,createdAt,updatedAt,confidence:number|null,source:'manual'|'wechat'|'demo',rawMessageId:string|null,imageId:string|null,originalText:string|null,aiVersion:string|null}
diet.data {meal:'breakfast'|'lunch'|'dinner'|'snack'|'unknown',items:[{name,quantity?:number|null,unit?:string,grams?:number|null,cooking?:string,estimated?:boolean,nutrition?:null|{kcal,protein,carbs,fat},nutritionSource?:string,manualNutrition?:boolean}]}
workout.data {muscleGroups:string[],durationMinutes?:number|null,intensity?:'light'|'moderate'|'vigorous'|null,exercises:[{name,sets:[{weightKg?:number|null,reps?:number|null}]}],estimatedKcal?:number|null,volumeKg?:number}
memo.data {tags:string[]}
todo.data {startAt?:string|null,dueAt?:string|null,remindAt?:string|null,repeat?:'none'|'daily'|'weekly'|'monthly',priority?:'low'|'normal'|'high',completed?:boolean}
GET /api/stats?days=7|30 -> {today,timezone,days:[{date,kcal,protein,carbs,fat,workouts,minutes,estimatedKcal,volumeKg,todos,completed}],week:{workouts,minutes,estimatedKcal,volumeKg,groups:{[name]:number}},totals:{workouts,minutes,estimatedKcal,volumeKg,todos,completed,completionRate:number},exerciseTrends:[{name,points:[{date,weightKg}]}],nutritionUnknownToday:number}
GET /api/summary/today -> {date,todoCount,dueReminders:number,generatedAt:string|null}
POST /api/summary/memo {date} -> {date,text,provider:'local'|'remote',count}
GET /api/media/:id -> 图片字节（鉴权；微信端可用 uni.downloadFile 加 Authorization）
GET /api/export -> JSON 对象（客户端自行展示或保存）
GET /api/calendar -> text/calendar
DELETE /api/me {confirm:'DELETE'} -> {ok:true}
POST /api/demo/messages multipart (sender:string stable between requests, messageId:string, text?:string, image?: file) -> {messageId:string,duplicate:boolean,status:'unbound'|'queued'|'processing'|'done'|'failed'|'bound'|'rejected',reply:string,jobId?:string}
GET /api/jobs -> {items:[{id,status,attempts,error:string|null,source:'demo'|'wechat',createdAt,updatedAt,rawMessageId}]}（仅自己）
GET /api/jobs/:id -> 单个 job
POST /api/jobs/:id/retry -> {ok:true}
GET /api/records/:id -> Record
