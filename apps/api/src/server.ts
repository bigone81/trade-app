import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { detectLevels } from '@trade/domain';
import { appendSystemEvent, countUnreadNotifications, createAlert, createNotification, createJournalImage, createManualLevel, createRiskReward, deleteAlert, deleteJournalImage, deleteManualLevel, deleteRiskReward, getJournalImage, getNotificationSettings, listAlerts, listJournal, listJournalImages, listManualLevels, listNotifications, listRiskRewards, markAllNotificationsRead, markNotificationRead, markNotificationTelegram, openDatabase, recordJournalBybitExecution, setAlertActive, syncJournalBybitOrder, updateAlertPrice, updateManualLevel, updateNotificationSettings, updateRiskReward, updateJournalOrder, upsertJournalSubmittedOrder } from '@trade/database';
import { accounts, appConfig, publicAccounts } from './config.js';
import { getAccountBalance, getCandles, getExecutions, getOrders, getPositions, getPrivateClient, getTickers, normalizePrice, normalizeQty } from './bybit.js';

const app=Fastify({logger:{redact:['req.headers.authorization','*.key','*.secret','*.apiKey','*.apiSecret']}});
const db=openDatabase(appConfig.databasePath);
mkdirSync(appConfig.chartsDir,{recursive:true});

app.addHook('onRequest', async (req, reply) => {
  if(req.url==='/api/health' || !appConfig.username || !appConfig.password) return;
  const header=req.headers.authorization || '';
  if(!header.startsWith('Basic ')){reply.header('WWW-Authenticate','Basic realm="Trade App"').code(401).send({error:'Authentication required'});return reply;}
  const [u,p]=Buffer.from(header.slice(6),'base64').toString('utf8').split(':');
  if(u!==appConfig.username || p!==appConfig.password){reply.header('WWW-Authenticate','Basic realm="Trade App"').code(401).send({error:'Invalid credentials'});return reply;}
});

app.get('/api/health',async()=>({status:'ok',liveTradingEnabled:appConfig.liveTradingEnabled}));
app.get('/api/config',async()=>({accounts:publicAccounts(),liveTradingEnabled:appConfig.liveTradingEnabled,defaultSymbol:appConfig.defaultSymbol,defaultTimeframe:appConfig.defaultTimeframe,telegramConfigured:Boolean(process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID)}));

app.get('/api/market/tickers',async()=>getTickers());
app.get('/api/market/candles',async(req)=>{const q=z.object({symbol:z.string().min(2).max(30),interval:z.string().default('15'),limit:z.coerce.number().int().min(30).max(1000).default(300)}).parse(req.query);return getCandles(q.symbol,q.interval,q.limit);});
app.get('/api/market/levels',async(req)=>{const q=z.object({symbol:z.string(),interval:z.string().default('D')}).parse(req.query);const candles=await getCandles(q.symbol,q.interval,30);return detectLevels(candles);});
app.get('/api/market/atr',async(req)=>{const q=z.object({symbol:z.string(),interval:z.string().default('D'),period:z.coerce.number().int().min(2).max(100).default(14)}).parse(req.query);const candles=await getCandles(q.symbol,q.interval,Math.max(q.period+2,30));const tr:number[]=[];for(let i=1;i<candles.length;i++){const c=candles[i]!,p=candles[i-1]!;tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));}return {symbol:q.symbol.toUpperCase(),atr:tr.slice(-q.period).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(q.period,tr.length))};});

app.get('/api/drawings/levels',async(req)=>{const q=z.object({symbol:z.string()}).parse(req.query);return listManualLevels(db,q.symbol);});
app.post('/api/drawings/levels',async(req,reply)=>{const body=z.object({symbol:z.string(),price:z.number().positive(),label:z.string().max(100).nullable().optional()}).parse(req.body);reply.code(201);return createManualLevel(db,body);});
app.patch('/api/drawings/levels/:id',async(req,reply)=>{const id=z.coerce.number().int().positive().parse((req.params as any).id);const body=z.object({price:z.number().positive().optional(),label:z.string().max(100).nullable().optional()}).parse(req.body);const row=updateManualLevel(db,id,body);if(!row)return reply.code(404).send({error:'Not found'});return row;});
app.delete('/api/drawings/levels/:id',async(req,reply)=>{const id=z.coerce.number().parse((req.params as any).id);return deleteManualLevel(db,id)?{ok:true}:reply.code(404).send({error:'Not found'});});

app.get('/api/drawings/risk-rewards',async(req)=>{const q=z.object({symbol:z.string(),timeframe:z.string().optional()}).parse(req.query);return listRiskRewards(db,q.symbol,q.timeframe);});
app.post('/api/drawings/risk-rewards',async(req,reply)=>{const b=z.object({symbol:z.string(),timeframe:z.string(),direction:z.enum(['long','short']),entry:z.number().positive(),stop:z.number().positive(),target:z.number().positive(),startTime:z.number().int().positive(),endTime:z.number().int().positive()}).parse(req.body);reply.code(201);return createRiskReward(db,b);});
app.patch('/api/drawings/risk-rewards/:id',async(req,reply)=>{const id=z.coerce.number().parse((req.params as any).id);const b=z.object({direction:z.enum(['long','short']).optional(),entry:z.number().positive().optional(),stop:z.number().positive().optional(),target:z.number().positive().optional(),startTime:z.number().int().positive().optional(),endTime:z.number().int().positive().optional()}).parse(req.body);const row=updateRiskReward(db,id,b);if(!row)return reply.code(404).send({error:'Not found'});return row;});
app.delete('/api/drawings/risk-rewards/:id',async(req,reply)=>{const id=z.coerce.number().parse((req.params as any).id);return deleteRiskReward(db,id)?{ok:true}:reply.code(404).send({error:'Not found'});});

app.get('/api/alerts',async(req)=>{const q=z.object({symbol:z.string().optional(),active:z.coerce.boolean().optional()}).parse(req.query);return listAlerts(db,q.symbol,q.active??false);});
app.post('/api/alerts',async(req,reply)=>{const b=z.object({symbol:z.string(),price:z.number().positive(),condition:z.enum(['cross_up','cross_down','touch']).optional(),preAlertPercent:z.number().min(0).max(20).nullable().optional(),sourceType:z.enum(['manual','manual_level','risk_reward','automatic_level']).optional(),sourceId:z.number().int().nullable().optional(),telegramEnabled:z.boolean().optional(),triggerOnce:z.boolean().optional()}).parse(req.body);reply.code(201);return createAlert(db,b);});
app.patch('/api/alerts/:id',async(req,reply)=>{const id=z.coerce.number().parse((req.params as any).id);const b=z.object({price:z.number().positive()}).parse(req.body);const row=updateAlertPrice(db,id,b.price);if(!row)return reply.code(404).send({error:'Not found'});return row;});
app.patch('/api/alerts/:id/active',async(req,reply)=>{const id=z.coerce.number().parse((req.params as any).id);const b=z.object({active:z.boolean()}).parse(req.body);return setAlertActive(db,id,b.active)?{ok:true}:reply.code(404).send({error:'Not found'});});
app.delete('/api/alerts/:id',async(req,reply)=>{const id=z.coerce.number().parse((req.params as any).id);return deleteAlert(db,id)?{ok:true}:reply.code(404).send({error:'Not found'});});

app.get('/api/journal',async(req)=>{const q=z.object({accountId:z.coerce.number().int().min(1).max(5).optional(),symbol:z.string().optional(),limit:z.coerce.number().int().optional()}).parse(req.query);return listJournal(db,q);});
app.patch('/api/journal/:id',async(req,reply)=>{const id=z.coerce.number().int().positive().parse((req.params as any).id);const b=z.object({rr:z.number().min(-100).max(100).optional(),style:z.number().int().min(0).max(99).optional(),status:z.number().int().min(0).max(99).optional(),note:z.string().max(20000).nullable().optional(),setup:z.string().max(200).nullable().optional(),tags:z.array(z.string().max(80)).max(30).optional(),executionQuality:z.string().max(80).nullable().optional(),exitPrice:z.number().min(0).nullable().optional(),pnl:z.number().nullable().optional(),fees:z.number().min(0).nullable().optional()}).parse(req.body);const row=updateJournalOrder(db,id,b);if(!row)return reply.code(404).send({error:'Not found'});return row;});

app.post('/api/journal/sync',async(req)=>{
  const q=z.object({accountId:z.coerce.number().int().min(1).max(5).optional()}).parse(req.query);
  const ids=q.accountId?[q.accountId]:accounts.filter(a=>a.configured).map(a=>a.id);
  let ordersSynced=0,executionsSynced=0;
  const details:any[]=[];
  for(const id of ids){
    const account=accounts.find(a=>a.id===id);if(!account)continue;
    try{
      const [active,history,executions]=await Promise.all([getOrders(id,false),getOrders(id,true),getExecutions(id)]);
      const byId=new Map<string,any>();for(const o of [...history,...active])if(o.orderId)byId.set(o.orderId,o);
      const appOrders=[...byId.values()].filter(o=>String(o.orderLinkId||'').startsWith('tradev2-')&&!o.reduceOnly);
      for(const o of appOrders){syncJournalBybitOrder(db,{accountId:id,accountName:account.name,order:o});ordersSynced++;}
      const allowed=new Set(appOrders.map(o=>o.orderId));
      for(const x of executions){if(!allowed.has(x.orderId))continue;recordJournalBybitExecution(db,{accountId:id,accountName:account.name,execution:x});executionsSynced++;}
      details.push({accountId:id,accountName:account.name,ok:true,orders:appOrders.length,executions:executions.filter(x=>allowed.has(x.orderId)).length});
    }catch(e){details.push({accountId:id,accountName:account.name,ok:false,error:e instanceof Error?e.message:String(e)});}
  }
  return {ok:true,ordersSynced,executionsSynced,details};
});

const journalImageKinds=['before','entry','management','exit','other'] as const;
const journalImageExt=(buffer:Buffer,mime:string)=>{
  if(mime==='image/png' && buffer.length>=8 && buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return 'png';
  if(mime==='image/jpeg' && buffer.length>=3 && buffer[0]===0xff && buffer[1]===0xd8 && buffer[2]===0xff)return 'jpg';
  if(mime==='image/webp' && buffer.length>=12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP')return 'webp';
  return null;
};
app.get('/api/journal/:id/images',async(req)=>{const id=z.coerce.number().int().positive().parse((req.params as any).id);return listJournalImages(db,id);});
app.post('/api/journal/:id/images',{bodyLimit:12*1024*1024},async(req,reply)=>{
  const id=z.coerce.number().int().positive().parse((req.params as any).id);
  const b=z.object({kind:z.enum(journalImageKinds).default('other'),name:z.string().max(220).nullable().optional(),mime:z.enum(['image/png','image/jpeg','image/webp']),dataBase64:z.string().min(8)}).parse(req.body);
  let bytes:Buffer; try{bytes=Buffer.from(b.dataBase64,'base64');}catch{return reply.code(400).send({error:'Invalid image data'});}
  if(bytes.length<16)return reply.code(400).send({error:'Image is empty or invalid'});
  if(bytes.length>8*1024*1024)return reply.code(413).send({error:'Image is too large. Maximum size is 8 MB.'});
  const ext=journalImageExt(bytes,b.mime);if(!ext)return reply.code(400).send({error:'Only valid PNG, JPEG and WEBP images are allowed'});
  const rel=`journal/${id}/${randomUUID()}.${ext}`;const dir=join(appConfig.chartsDir,'journal',String(id));mkdirSync(dir,{recursive:true});
  const full=join(appConfig.chartsDir,rel);writeFileSync(full,bytes,{flag:'wx'});
  const row=createJournalImage(db,{journalOrderId:id,kind:b.kind,path:rel,originalName:b.name??null,mime:b.mime,sizeBytes:bytes.length});
  if(!row){try{unlinkSync(full);}catch{}return reply.code(404).send({error:'Journal trade not found'});}
  reply.code(201);return row;
});
app.delete('/api/journal/images/:imageId',async(req,reply)=>{
  const imageId=z.coerce.number().int().positive().parse((req.params as any).imageId);const row=getJournalImage(db,imageId);if(!row)return reply.code(404).send({error:'Image not found'});
  if(!deleteJournalImage(db,imageId))return reply.code(404).send({error:'Image not found'});
  try{unlinkSync(join(appConfig.chartsDir,row.path));}catch(e){req.log.warn({err:e,imageId,path:row.path},'Could not remove journal image file');}
  return {ok:true};
});
app.get('/api/system/events',async(req)=>{const q=z.object({limit:z.coerce.number().int().min(1).max(200).default(50)}).parse(req.query);return db.prepare('SELECT * FROM system_events ORDER BY id DESC LIMIT ?').all(q.limit);});

app.get('/api/notifications',async(req)=>{
  const q=z.object({limit:z.coerce.number().int().min(1).max(200).default(40),unreadOnly:z.coerce.boolean().optional()}).parse(req.query);
  return listNotifications(db,{limit:q.limit,unreadOnly:q.unreadOnly??false});
});
app.get('/api/notifications/unread-count',async()=>({count:countUnreadNotifications(db)}));
app.post('/api/notifications/:id/read',async(req,reply)=>{
  const id=z.coerce.number().int().positive().parse((req.params as any).id);
  return markNotificationRead(db,id)?{ok:true}:reply.code(404).send({error:'Notification not found'});
});
app.post('/api/notifications/read-all',async()=>({ok:true,updated:markAllNotificationsRead(db)}));
app.get('/api/notification-settings',async()=>getNotificationSettings(db));
app.put('/api/notification-settings',async(req)=>{
  const patch=z.object({
    marketAlerts:z.boolean().optional(),marketPreAlerts:z.boolean().optional(),tradingFilled:z.boolean().optional(),tradingPartial:z.boolean().optional(),tradingCancelled:z.boolean().optional(),tradingRejected:z.boolean().optional(),
    systemOffline:z.boolean().optional(),systemReconnect:z.boolean().optional(),telegramMarket:z.boolean().optional(),telegramTrading:z.boolean().optional(),telegramSystem:z.boolean().optional(),systemOfflineSeconds:z.number().int().min(10).max(600).optional(),
  }).parse(req.body);
  return updateNotificationSettings(db,patch);
});

app.post('/api/notifications/test',async(req,reply)=>{
  const b=z.object({telegram:z.boolean().default(false)}).parse(req.body??{});
  const row=createNotification(db,{category:'system',eventType:'notification.test',severity:'info',title:'Test notification',message:'Trade App notification center is working.',actionUrl:'/settings'});
  if(!row)return reply.code(500).send({error:'Could not create test notification'});
  if(b.telegram){
    const token=process.env.TELEGRAM_BOT_TOKEN||'';const chatId=process.env.TELEGRAM_CHAT_ID||'';
    if(!token||!chatId){markNotificationTelegram(db,row.id,'not_configured');return {...row,telegramStatus:'not_configured'};}
    try{const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:'✅ <b>Trade App</b>\n\nТестовое уведомление работает.',parse_mode:'HTML'})});if(!r.ok)throw new Error(`Telegram HTTP ${r.status}: ${await r.text()}`);markNotificationTelegram(db,row.id,'sent');}
    catch(e){const message=e instanceof Error?e.message:String(e);markNotificationTelegram(db,row.id,'error',message);return reply.code(502).send({error:message});}
  }
  return row;
});

async function accountIds(value:unknown){const q=z.coerce.number().int().min(1).max(5).optional().parse(value);return q?[q]:accounts.filter(a=>a.configured).map(a=>a.id);}
app.get('/api/trade/summary',async(req)=>{const ids=await accountIds((req.query as any)?.accountId);return Promise.all(ids.map(async id=>{try{const [balance,positions,orders]=await Promise.all([getAccountBalance(id),getPositions(id),getOrders(id)]);return {...balance,positions:positions.length,orders:orders.length,unrealisedPnl:positions.reduce((s,p)=>s+p.unrealisedPnl,0),online:true};}catch(e){return {accountId:id,accountName:accounts.find(a=>a.id===id)?.name,online:false,error:e instanceof Error?e.message:String(e)};}}));});
app.get('/api/trade/positions',async(req)=>{const ids=await accountIds((req.query as any)?.accountId);return (await Promise.all(ids.map(id=>getPositions(id).catch(()=>[])))).flat();});
app.get('/api/trade/orders',async(req)=>{const ids=await accountIds((req.query as any)?.accountId);return (await Promise.all(ids.map(id=>getOrders(id,false).catch(()=>[])))).flat();});
app.get('/api/trade/executions',async(req)=>{const ids=await accountIds((req.query as any)?.accountId);return (await Promise.all(ids.map(id=>getExecutions(id).catch(()=>[])))).flat();});
app.get('/api/trade/history',async(req)=>{const ids=await accountIds((req.query as any)?.accountId);return (await Promise.all(ids.map(id=>getOrders(id,true).catch(()=>[])))).flat();});

const requireLive=(reply:any)=>{if(!appConfig.liveTradingEnabled){reply.code(423).send({error:'Live trading actions are disabled. Set LIVE_TRADING_ENABLED=true explicitly.'});return false;}return true;};
const bybitOk=(reply:any,r:any)=>{if(Number(r?.retCode)!==0){reply.code(400).send({error:r?.retMsg||'Bybit rejected the request',retCode:r?.retCode});return false;}return true;};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const asPositionIdx=(value:number):0|1|2=>{if(value===1)return 1;if(value===2)return 2;return 0;};
async function waitOrdersGone(accountId:number,symbol:string,timeoutMs=5000){const end=Date.now()+timeoutMs;while(Date.now()<end){const open=(await getOrders(accountId,false)).filter(o=>o.symbol===symbol);if(open.length===0)return true;await sleep(250);}return false;}
app.post('/api/trade/orders/cancel',async(req,reply)=>{if(!requireLive(reply))return;const b=z.object({accountId:z.number().int().min(1).max(5),symbol:z.string(),orderId:z.string()}).parse(req.body);const r=await getPrivateClient(b.accountId).cancelOrder({category:'linear',symbol:b.symbol.toUpperCase(),orderId:b.orderId});appendSystemEvent(db,{eventType:'order.cancel.requested',accountId:b.accountId,symbol:b.symbol,message:`Cancel requested for ${b.orderId}`,payload:{retCode:r.retCode,retMsg:r.retMsg}});if(!bybitOk(reply,r))return;return r;});
app.post('/api/trade/orders/cancel-all',async(req,reply)=>{if(!requireLive(reply))return;const b=z.object({accountId:z.number().int().min(1).max(5),symbol:z.string()}).parse(req.body);const r=await getPrivateClient(b.accountId).cancelAllOrders({category:'linear',symbol:b.symbol.toUpperCase()});appendSystemEvent(db,{eventType:'orders.cancel_all.requested',accountId:b.accountId,symbol:b.symbol,message:'Cancel all requested',payload:{retCode:r.retCode,retMsg:r.retMsg}});if(!bybitOk(reply,r))return;return r;});

app.post('/api/trade/position/stops',async(req,reply)=>{if(!requireLive(reply))return;const b=z.object({accountId:z.number().int().min(1).max(5),symbol:z.string(),positionIdx:z.number().int().default(0),stopLoss:z.number().min(0).optional(),takeProfit:z.number().min(0).optional(),trailingStop:z.number().min(0).optional()}).parse(req.body);const symbol=b.symbol.toUpperCase();const stopLoss=b.stopLoss===undefined?undefined:(b.stopLoss===0?'0':await normalizePrice(symbol,b.stopLoss));const takeProfit=b.takeProfit===undefined?undefined:(b.takeProfit===0?'0':await normalizePrice(symbol,b.takeProfit));const trailingStop=b.trailingStop===undefined?undefined:String(b.trailingStop);const r=await getPrivateClient(b.accountId).setTradingStop({category:'linear',symbol,tpslMode:'Full',positionIdx:b.positionIdx,stopLoss,takeProfit,trailingStop} as any);appendSystemEvent(db,{eventType:'position.stops.requested',accountId:b.accountId,symbol,message:'Position TP/SL update requested'});if(!bybitOk(reply,r))return;return r;});

app.post('/api/trade/position/close',async(req,reply)=>{if(!requireLive(reply))return;const b=z.object({accountId:z.number().int().min(1).max(5),symbol:z.string(),percent:z.number().min(1).max(100).default(100),positionIdx:z.number().int().default(0)}).parse(req.body);const positions=await getPositions(b.accountId);const p=positions.find(x=>x.symbol===b.symbol.toUpperCase()&&x.positionIdx===b.positionIdx);if(!p)return reply.code(404).send({error:'Open position not found'});const rawQty=p.size*b.percent/100;const qty=await normalizeQty(p.symbol,rawQty);if(Number(qty)<=0)return reply.code(400).send({error:'Calculated close quantity is below instrument qtyStep'});const r=await getPrivateClient(b.accountId).submitOrder({category:'linear',symbol:p.symbol,side:p.side==='Buy'?'Sell':'Buy',orderType:'Market',qty,positionIdx:asPositionIdx(p.positionIdx),reduceOnly:true});appendSystemEvent(db,{severity:'warning',eventType:'position.close.requested',accountId:b.accountId,symbol:p.symbol,message:`Market reduce-only close requested for ${b.percent}%`,payload:{qty,retCode:r.retCode,retMsg:r.retMsg}});if(!bybitOk(reply,r))return;return r;});

app.post('/api/trade/position/flatten',async(req,reply)=>{if(!requireLive(reply))return;const b=z.object({accountId:z.number().int().min(1).max(5),symbol:z.string(),positionIdx:z.number().int().default(0)}).parse(req.body);const symbol=b.symbol.toUpperCase();const client=getPrivateClient(b.accountId);const cancel=await client.cancelAllOrders({category:'linear',symbol});if(!bybitOk(reply,cancel))return;const cleared=await waitOrdersGone(b.accountId,symbol,5000);if(!cleared){appendSystemEvent(db,{severity:'error',eventType:'position.flatten.aborted',accountId:b.accountId,symbol,message:'Flatten aborted: open orders did not clear within timeout'});return reply.code(409).send({error:'Flatten aborted because active orders are still present after Cancel All'});}const positions=await getPositions(b.accountId);const p=positions.find(x=>x.symbol===symbol&&x.positionIdx===b.positionIdx);let close:any=null;if(p){const qty=await normalizeQty(symbol,p.size);close=await client.submitOrder({category:'linear',symbol,side:p.side==='Buy'?'Sell':'Buy',orderType:'Market',qty,positionIdx:asPositionIdx(p.positionIdx),reduceOnly:true});if(!bybitOk(reply,close))return;}appendSystemEvent(db,{severity:'warning',eventType:'position.flatten.requested',accountId:b.accountId,symbol,message:'Flatten requested after active orders cleared',payload:{cancelRetCode:cancel.retCode,closeRetCode:close?.retCode}});return {cancel,close};});

app.post('/api/trade/order',async(req,reply)=>{
  if(!requireLive(reply))return;
  const b=z.object({
    accountId:z.number().int().min(1).max(5),symbol:z.string(),side:z.enum(['Buy','Sell']),orderType:z.enum(['Market','Limit']),qty:z.number().positive(),
    price:z.number().positive().optional(),triggerPrice:z.number().positive().optional(),stopLoss:z.number().positive().optional(),takeProfit:z.number().positive().optional(),positionIdx:z.number().int().default(0),
    pointType:z.number().int().optional(),priceLevel:z.number().positive().optional(),plannedRr:z.number().optional(),riskPercent:z.number().min(0).optional(),riskAmount:z.number().min(0).optional(),plannedEntry:z.number().positive().optional()
  }).parse(req.body);
  const symbol=b.symbol.toUpperCase();const qty=await normalizeQty(symbol,b.qty);if(Number(qty)<=0)return reply.code(400).send({error:'Position quantity is below instrument qtyStep'});
  const params:any={category:'linear',symbol,side:b.side,orderType:b.orderType,qty,positionIdx:b.positionIdx,timeInForce:'GTC',orderLinkId:`tradev2-${Date.now()}`};
  if(b.orderType==='Limit'){if(!b.price)return reply.code(400).send({error:'Limit price is required'});params.price=await normalizePrice(symbol,b.price);}
  if(b.triggerPrice){params.triggerPrice=await normalizePrice(symbol,b.triggerPrice);params.triggerDirection=b.side==='Buy'?1:2;}
  if(b.stopLoss)params.stopLoss=await normalizePrice(symbol,b.stopLoss);if(b.takeProfit)params.takeProfit=await normalizePrice(symbol,b.takeProfit);
  const r=await getPrivateClient(b.accountId).submitOrder(params);
  appendSystemEvent(db,{eventType:'order.submit.requested',accountId:b.accountId,symbol,message:'Order submit requested',payload:{retCode:r.retCode,retMsg:r.retMsg,orderLinkId:params.orderLinkId}});
  if(!bybitOk(reply,r))return;
  const account=accounts.find(a=>a.id===b.accountId)!;
  upsertJournalSubmittedOrder(db,{accountId:b.accountId,accountName:account.name,symbol,side:b.side,orderType:b.triggerPrice?'Stop Limit':b.orderType,triggerPrice:b.triggerPrice??null,entryPrice:b.plannedEntry??b.price??null,stopLoss:b.stopLoss??null,takeProfit:b.takeProfit??null,quantity:Number(qty),pointType:b.pointType??null,priceLevel:b.priceLevel??null,rr:b.plannedRr??null,riskPercent:b.riskPercent??null,riskAmount:b.riskAmount??null,exchangeOrderId:String((r as any)?.result?.orderId||'')||null,orderLinkId:params.orderLinkId,reduceOnly:false,raw:{request:b,response:{retCode:r.retCode,retMsg:r.retMsg,result:(r as any).result}}});
  return r;
});

const __dirname=dirname(fileURLToPath(import.meta.url));
const webRoot=resolve(__dirname,'../../web/dist');
await app.register(fastifyStatic,{root:appConfig.chartsDir,prefix:'/charts/'});
if(existsSync(webRoot))await app.register(fastifyStatic,{root:webRoot,prefix:'/',decorateReply:false});
app.setNotFoundHandler((req,reply)=>{if(req.url.startsWith('/api/'))return reply.code(404).send({error:'Not found'});const index=resolve(webRoot,'index.html');if(existsSync(index))return reply.type('text/html').sendFile('index.html',webRoot);return reply.code(404).send('Web build not found; run the Vite dev server on port 5173 or build @trade/web.');});

app.setErrorHandler((error,_req,reply)=>{app.log.error(error);const status=(error as any).name==='ZodError'?400:500;reply.code(status).send({error:status===400?'Invalid request':'Server error',details:status===400?(error as any).issues:undefined});});

await app.listen({host:'0.0.0.0',port:appConfig.port});
