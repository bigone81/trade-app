import { createMarketReadClient } from '@trade/exchanges-bybit';
import type { PublicMarketData } from './scanner.js';

function checked<T extends { retCode: number; retMsg: string; rateLimitApi?: unknown }>(response: T): T {
  // Keep the SDK's retCode and parsed reset timestamp for the scanner's limiter.
  if (response.retCode !== 0) throw Object.assign(new Error(response.retMsg || 'Bybit public data error'), { retCode: response.retCode, rateLimitApi: response.rateLimitApi });
  return response;
}
const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

/** Only public read endpoints are exposed to the scanner. No SDK retry or private credentials. */
export function createMarketData(client: ReturnType<typeof createMarketReadClient> = createMarketReadClient()): PublicMarketData {
  return {
    getCandles: async (symbol, interval, limit) => {
      const response = checked(await client.getKline({ category: 'linear', symbol: symbol.toUpperCase(), interval: interval as Parameters<typeof client.getKline>[0]['interval'], limit }));
      return response.result.list.map(k => ({ time: Math.floor(Number(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), volume: num(k[5]) })).reverse();
    },
    getTickers: async () => {
      const response = checked(await client.getTickers({ category: 'linear' }));
      return response.result.list.map(x => ({ symbol: x.symbol, turnover24h: num(x.turnover24h) }));
    },
    getInstruments: async cursor => {
      const response = checked(await client.getInstrumentsInfo({ category: 'linear', status: 'Trading', limit: 1000, ...(cursor ? { cursor } : {}) }));
      return response.result as Awaited<ReturnType<PublicMarketData['getInstruments']>>;
    },
  };
}
