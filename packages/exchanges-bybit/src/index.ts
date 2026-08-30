import { RestClientV5, WebsocketClient } from 'bybit-api';
import type { AccountId, ExchangeCapabilities, TradeExecution, TradeOrder, TradePosition } from '@trade/shared';
import type { ExchangeAccountResolver } from '@trade/exchanges-core';

const num=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:0};
const nullable=(v:unknown)=>v===undefined||v===null||v===''?null:num(v);
const decimals=(value:string)=>{const normalized=value.replace(/0+$/,'');const i=normalized.indexOf('.');return i<0?0:normalized.length-i-1;};
const align=(value:number,stepText:string,mode:'round'|'floor'='round')=>{
  const step=Number(stepText);if(!Number.isFinite(step)||step<=0)return String(value);
  const units=mode==='floor'?Math.floor(value/step+1e-10):Math.round(value/step);
  return (units*step).toFixed(decimals(stepText));
};

export class BybitAdapter {
  readonly exchange='bybit' as const;
  readonly capabilities:ExchangeCapabilities={market:true,limit:true,stop:true,reduceOnly:true,hedgeMode:true,tpsl:true,trailingStop:true,privateWebsocket:true};
  private readonly publicClient=new RestClientV5();
  private readonly privateClients=new Map<number,RestClientV5>();
  private readonly instrumentCache=new Map<string,{tickSize:string;qtyStep:string;at:number}>();

  constructor(private readonly resolveAccount:ExchangeAccountResolver){}

  supportsMarket(market:string){return market==='linear';}
  getAccount(accountId:AccountId){
    const account=this.resolveAccount(accountId);
    if(account.exchange!=='bybit')throw new Error(`Account ${account.name} belongs to ${account.exchange}, not Bybit`);
    if(!this.supportsMarket(account.market))throw new Error(`Bybit market ${account.market} is not supported yet`);
    if(!account.enabled)throw new Error(`Account ${account.name} is disabled`);
    if(!account.configured)throw new Error(`Account ${account.name} is not configured`);
    return account;
  }
  getPublicClient(){return this.publicClient;}
  getPrivateClient(accountId:AccountId){
    const existing=this.privateClients.get(accountId);if(existing)return existing;
    const a=this.getAccount(accountId);
    const client=new RestClientV5({key:a.apiKey,secret:a.apiSecret,demoTrading:a.demo});
    this.privateClients.set(accountId,client);return client;
  }
  createPublicWebsocket(){return new WebsocketClient();}
  createPrivateWebsocket(accountId:AccountId){const a=this.getAccount(accountId);return new WebsocketClient({key:a.apiKey,secret:a.apiSecret,demoTrading:a.demo});}

  async getInstrumentRules(symbol:string){
    const key=symbol.toUpperCase();const cached=this.instrumentCache.get(key);if(cached&&Date.now()-cached.at<10*60_000)return cached;
    const res=await this.publicClient.getInstrumentsInfo({category:'linear',symbol:key,status:'Trading'} as any);
    if(res.retCode!==0)throw new Error(res.retMsg||'Instrument info error');
    const x=(res.result.list as any[])?.[0];if(!x)throw new Error(`Instrument ${key} not found`);
    const rules={tickSize:String(x.priceFilter.tickSize),qtyStep:String(x.lotSizeFilter.qtyStep),at:Date.now()};this.instrumentCache.set(key,rules);return rules;
  }
  async normalizeQty(symbol:string,value:number){const r=await this.getInstrumentRules(symbol);return align(value,r.qtyStep,'floor');}
  async normalizePrice(symbol:string,value:number){const r=await this.getInstrumentRules(symbol);return align(value,r.tickSize,'round');}

  async getCandles(symbol:string,interval:string,limit=300,range:{start?:number;end?:number}={}){
    const params:any={category:'linear',symbol:symbol.toUpperCase(),interval:interval as any,limit};
    if(Number.isFinite(range.start))params.start=Math.max(0,Math.floor(Number(range.start)));
    if(Number.isFinite(range.end))params.end=Math.max(0,Math.floor(Number(range.end)));
    const res=await this.publicClient.getKline(params);
    if(res.retCode!==0)throw new Error(res.retMsg||'Bybit kline error');
    return res.result.list.map((k:any)=>({time:Math.floor(Number(k[0])/1000),open:num(k[1]),high:num(k[2]),low:num(k[3]),close:num(k[4]),volume:num(k[5])})).reverse();
  }
  async getTickers(){
    const res=await this.publicClient.getTickers({category:'linear'});if(res.retCode!==0)throw new Error(res.retMsg||'Bybit ticker error');
    return res.result.list.map((x:any)=>({symbol:x.symbol,lastPrice:num(x.lastPrice),price24hPcnt:num(x.price24hPcnt),turnover24h:num(x.turnover24h)}));
  }
  async getLastPrice(symbol:string){
    const key=symbol.toUpperCase();
    const res=await this.publicClient.getTickers({category:'linear',symbol:key} as any);
    if(res.retCode!==0)throw new Error(res.retMsg||'Bybit ticker error');
    const x=(res.result.list as any[])?.[0];const price=num(x?.lastPrice);
    if(!x||price<=0)throw new Error(`Ticker ${key} not found`);
    return price;
  }
  async getAccountBalance(accountId:AccountId){
    const a=this.getAccount(accountId),c=this.getPrivateClient(accountId);const res=await c.getWalletBalance({accountType:'UNIFIED'} as any);
    if(res.retCode!==0)throw new Error(res.retMsg||'Wallet balance error');const item=(res.result.list as any[])?.[0]||{};
    return {accountId:a.id,accountName:a.name,equity:num(item.totalEquity),walletBalance:num(item.totalWalletBalance),availableBalance:num(item.totalAvailableBalance)};
  }
  async getPositions(accountId:AccountId):Promise<TradePosition[]>{
    const a=this.getAccount(accountId),c=this.getPrivateClient(accountId);const res=await c.getPositionInfo({category:'linear',settleCoin:'USDT'} as any);
    if(res.retCode!==0)throw new Error(res.retMsg||'Position error');
    return (res.result.list as any[]).filter(x=>num(x.size)>0).map(x=>({accountId:a.id,accountName:a.name,symbol:x.symbol,side:x.side,size:num(x.size),avgPrice:num(x.avgPrice),markPrice:num(x.markPrice),unrealisedPnl:num(x.unrealisedPnl),cumRealisedPnl:num(x.cumRealisedPnl),takeProfit:nullable(x.takeProfit),stopLoss:nullable(x.stopLoss),trailingStop:nullable(x.trailingStop),liqPrice:nullable(x.liqPrice),positionIdx:num(x.positionIdx),updatedAt:num(x.updatedTime)||Date.now()}));
  }
  async getOrders(accountId:AccountId,history=false):Promise<TradeOrder[]>{
    const a=this.getAccount(accountId),c=this.getPrivateClient(accountId);const res=history?await c.getHistoricOrders({category:'linear',settleCoin:'USDT',limit:50} as any):await c.getActiveOrders({category:'linear',settleCoin:'USDT',limit:50} as any);
    if(res.retCode!==0)throw new Error(res.retMsg||'Order query error');
    return (res.result.list as any[]).map(x=>({accountId:a.id,accountName:a.name,orderId:x.orderId,orderLinkId:x.orderLinkId||'',symbol:x.symbol,side:x.side,orderType:x.orderType,orderStatus:x.orderStatus,price:num(x.price),qty:num(x.qty),leavesQty:num(x.leavesQty),cumExecQty:num(x.cumExecQty),triggerPrice:nullable(x.triggerPrice),triggerDirection:nullable(x.triggerDirection),stopOrderType:x.stopOrderType?String(x.stopOrderType):null,stopLoss:nullable(x.stopLoss),takeProfit:nullable(x.takeProfit),reduceOnly:Boolean(x.reduceOnly),createdTime:num(x.createdTime),updatedTime:num(x.updatedTime)}));
  }
  async getExecutions(accountId:AccountId):Promise<TradeExecution[]>{
    const a=this.getAccount(accountId),c=this.getPrivateClient(accountId);const res=await c.getExecutionList({category:'linear',limit:50} as any);
    if(res.retCode!==0)throw new Error(res.retMsg||'Execution query error');
    return (res.result.list as any[]).map(x=>({accountId:a.id,accountName:a.name,execId:x.execId,orderId:x.orderId,symbol:x.symbol,side:x.side,execPrice:num(x.execPrice),execQty:num(x.execQty),execFee:num(x.execFee),execTime:num(x.execTime)}));
  }
  cancelOrder(accountId:AccountId,input:any){return this.getPrivateClient(accountId).cancelOrder({category:'linear',...input});}
  amendOrder(accountId:AccountId,input:any){return this.getPrivateClient(accountId).amendOrder({category:'linear',...input} as any);}
  cancelAllOrders(accountId:AccountId,input:any){return this.getPrivateClient(accountId).cancelAllOrders({category:'linear',...input});}
  setTradingStop(accountId:AccountId,input:any){return this.getPrivateClient(accountId).setTradingStop({category:'linear',...input} as any);}
  submitOrder(accountId:AccountId,input:any){return this.getPrivateClient(accountId).submitOrder({category:'linear',...input});}
}
