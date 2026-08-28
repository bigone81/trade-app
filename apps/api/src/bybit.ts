import { RestClientV5 } from 'bybit-api';
import type { AccountId, TradeExecution, TradeOrder, TradePosition } from '@trade/shared';
import { accounts, type AccountConfig } from './config.js';

const publicClient = new RestClientV5();
const privateClients = new Map<number, RestClientV5>();

export function getPublicClient() { return publicClient; }
export function getAccountConfig(id: number): AccountConfig {
  const account = accounts.find(a => a.id === id);
  if (!account) throw new Error(`Unknown account ${id}`);
  if (!account.configured) throw new Error(`Account ${account.name} is not configured`);
  return account;
}
export function getPrivateClient(id:number) {
  const existing = privateClients.get(id); if(existing) return existing;
  const a = getAccountConfig(id);
  const client = new RestClientV5({key:a.key, secret:a.secret, demoTrading:a.demo});
  privateClients.set(id,client); return client;
}


const instrumentCache = new Map<string, { tickSize: string; qtyStep: string; at: number }>();
function decimals(value:string){const normalized=value.replace(/0+$/,'');const i=normalized.indexOf('.');return i<0?0:normalized.length-i-1;}
function align(value:number,stepText:string,mode:'round'|'floor'='round'){
  const step=Number(stepText);if(!Number.isFinite(step)||step<=0)return String(value);
  const units=mode==='floor'?Math.floor(value/step+1e-10):Math.round(value/step);
  return (units*step).toFixed(decimals(stepText));
}
export async function getInstrumentRules(symbol:string){
  const key=symbol.toUpperCase();const cached=instrumentCache.get(key);if(cached&&Date.now()-cached.at<10*60_000)return cached;
  const res=await publicClient.getInstrumentsInfo({category:'linear',symbol:key,status:'Trading'} as any);
  if(res.retCode!==0)throw new Error(res.retMsg||'Instrument info error');
  const x=(res.result.list as any[])?.[0];if(!x)throw new Error(`Instrument ${key} not found`);
  const rules={tickSize:String(x.priceFilter.tickSize),qtyStep:String(x.lotSizeFilter.qtyStep),at:Date.now()};instrumentCache.set(key,rules);return rules;
}
export async function normalizeQty(symbol:string,value:number){const r=await getInstrumentRules(symbol);return align(value,r.qtyStep,'floor');}
export async function normalizePrice(symbol:string,value:number){const r=await getInstrumentRules(symbol);return align(value,r.tickSize,'round');}

const num=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:0};
const nullable=(v:unknown)=>v===undefined||v===null||v===''?null:num(v);

export async function getCandles(symbol:string, interval:string, limit=300) {
  const res=await publicClient.getKline({category:'linear',symbol:symbol.toUpperCase(),interval:interval as any,limit});
  if(res.retCode!==0) throw new Error(res.retMsg || 'Bybit kline error');
  return res.result.list.map((k:any)=>({time:Math.floor(Number(k[0])/1000),open:num(k[1]),high:num(k[2]),low:num(k[3]),close:num(k[4]),volume:num(k[5])})).reverse();
}

export async function getTickers() {
  const res=await publicClient.getTickers({category:'linear'});
  if(res.retCode!==0) throw new Error(res.retMsg || 'Bybit ticker error');
  return res.result.list.map((x:any)=>({symbol:x.symbol,lastPrice:num(x.lastPrice),price24hPcnt:num(x.price24hPcnt),turnover24h:num(x.turnover24h)}));
}

export async function getAccountBalance(accountId:number) {
  const account=getAccountConfig(accountId); const client=getPrivateClient(accountId);
  const res=await client.getWalletBalance({accountType:'UNIFIED'} as any);
  if(res.retCode!==0) throw new Error(res.retMsg || 'Wallet balance error');
  const item=(res.result.list as any[])?.[0] || {};
  return {accountId:account.id,accountName:account.name,equity:num(item.totalEquity),walletBalance:num(item.totalWalletBalance),availableBalance:num(item.totalAvailableBalance)};
}

export async function getPositions(accountId:number):Promise<TradePosition[]> {
  const a=getAccountConfig(accountId); const c=getPrivateClient(accountId);
  const res=await c.getPositionInfo({category:'linear',settleCoin:'USDT'} as any);
  if(res.retCode!==0) throw new Error(res.retMsg || 'Position error');
  return (res.result.list as any[]).filter(x=>num(x.size)>0).map(x=>({
    accountId:a.id,accountName:a.name,symbol:x.symbol,side:x.side,size:num(x.size),avgPrice:num(x.avgPrice),markPrice:num(x.markPrice),
    unrealisedPnl:num(x.unrealisedPnl),cumRealisedPnl:num(x.cumRealisedPnl),takeProfit:nullable(x.takeProfit),stopLoss:nullable(x.stopLoss),
    trailingStop:nullable(x.trailingStop),liqPrice:nullable(x.liqPrice),positionIdx:num(x.positionIdx),updatedAt:num(x.updatedTime)||Date.now(),
  }));
}

export async function getOrders(accountId:number, history=false):Promise<TradeOrder[]> {
  const a=getAccountConfig(accountId); const c=getPrivateClient(accountId);
  const res=history ? await c.getHistoricOrders({category:'linear',settleCoin:'USDT',limit:50} as any) : await c.getActiveOrders({category:'linear',settleCoin:'USDT',limit:50} as any);
  if(res.retCode!==0) throw new Error(res.retMsg || 'Order query error');
  return (res.result.list as any[]).map(x=>({accountId:a.id,accountName:a.name,orderId:x.orderId,orderLinkId:x.orderLinkId||'',symbol:x.symbol,side:x.side,orderType:x.orderType,orderStatus:x.orderStatus,
    price:num(x.price),qty:num(x.qty),leavesQty:num(x.leavesQty),cumExecQty:num(x.cumExecQty),triggerPrice:nullable(x.triggerPrice),stopLoss:nullable(x.stopLoss),takeProfit:nullable(x.takeProfit),
    reduceOnly:Boolean(x.reduceOnly),createdTime:num(x.createdTime),updatedTime:num(x.updatedTime)}));
}

export async function getExecutions(accountId:number):Promise<TradeExecution[]> {
  const a=getAccountConfig(accountId); const c=getPrivateClient(accountId);
  const res=await c.getExecutionList({category:'linear',limit:50} as any);
  if(res.retCode!==0) throw new Error(res.retMsg || 'Execution query error');
  return (res.result.list as any[]).map(x=>({accountId:a.id,accountName:a.name,execId:x.execId,orderId:x.orderId,symbol:x.symbol,side:x.side,execPrice:num(x.execPrice),execQty:num(x.execQty),execFee:num(x.execFee),execTime:num(x.execTime)}));
}
