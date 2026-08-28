import type { AccountId, AccountPublic } from '@trade/shared';

export interface AccountConfig extends AccountPublic { key: string; secret: string; }

const bool = (v: string | undefined, fallback=false) => v === undefined ? fallback : ['1','true','yes','on'].includes(v.toLowerCase());

export const appConfig = {
  port: Number(process.env.PORT || process.env.APP_PORT || 8080),
  databasePath: process.env.DATABASE_PATH || './data/trade.sqlite',
  chartsDir: process.env.CHARTS_DIR || './data/charts',
  username: process.env.APP_USERNAME || '',
  password: process.env.APP_PASSWORD || '',
  liveTradingEnabled: bool(process.env.LIVE_TRADING_ENABLED, false),
  defaultSymbol: (process.env.DEFAULT_SYMBOL || 'BTCUSDT').toUpperCase(),
  defaultTimeframe: process.env.DEFAULT_TIMEFRAME || '15',
};

export const accounts: AccountConfig[] = ([1,2,3,4,5] as AccountId[]).map((id) => {
  const prefix = `BYBIT_ACCOUNT${id}_`;
  const key = process.env[`${prefix}KEY`] || '';
  const secret = process.env[`${prefix}SECRET`] || '';
  return {
    id,
    name: process.env[`${prefix}NAME`] || `Account ${id}`,
    demo: bool(process.env[`${prefix}DEMO`], false),
    configured: Boolean(key && secret),
    key,
    secret,
  };
});

export function publicAccounts(): AccountPublic[] {
  return accounts.map(({id,name,demo,configured}) => ({id,name,demo,configured}));
}
