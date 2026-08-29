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
