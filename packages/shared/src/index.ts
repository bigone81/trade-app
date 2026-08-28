export type AccountId = 1 | 2 | 3 | 4 | 5;
export type Side = 'Buy' | 'Sell';
export type Direction = 'long' | 'short';
export type OrderKind = 'Market' | 'Limit';
export type CalculatorMode = 'stop' | 'limit' | 'market';
export type StopMode = 'atr' | 'technical';
export type DrawingTool = 'select' | 'level' | 'risk-reward' | 'alert';

export interface AccountPublic {
  id: AccountId;
  name: string;
  demo: boolean;
  configured: boolean;
}

export interface ManualLevel {
  id: number;
  symbol: string;
  price: number;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RiskReward {
  id: number;
  symbol: string;
  timeframe: string;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  startTime: number;
  endTime: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRecord {
  id: number;
  symbol: string;
  price: number;
  condition: 'cross_up' | 'cross_down' | 'touch';
  preAlertPercent: number | null;
  sourceType: 'manual' | 'manual_level' | 'risk_reward' | 'automatic_level';
  sourceId: number | null;
  telegramEnabled: boolean;
  active: boolean;
  triggerOnce: boolean;
  lastPrice: number | null;
  preAlertedAt: string | null;
  triggeredAt: string | null;
  createdAt: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AutoLevel {
  type: 'support' | 'resistance' | 'mirror';
  price: number;
  priceMean: number;
  priceStddev: number;
  dates: string[];
  touches: number;
  strength: number;
}

export interface CalculatorInput {
  mode: CalculatorMode;
  stopMode: StopMode;
  side: Side;
  balance: number;
  riskPercent: number;
  atr: number;
  priceLevel: number;
  currentPrice: number;
  triggerAtrPercent: number;
  slipAtrPercent: number;
  stopAtrPercent: number;
  technicalStop: number;
  rr: number;
}

export interface CalculatorResult {
  pointType: 10 | 11 | 20 | 21 | 30 | 31;
  orderType: OrderKind;
  triggerPoint: number;
  entry: number;
  stop: number;
  target: number;
  riskAmount: number;
  positionSize: number;
  notional: number;
  stopPercent: number;
  targetPercent: number;
  rr: number;
}

export interface TradePosition {
  accountId: AccountId;
  accountName: string;
  symbol: string;
  side: Side;
  size: number;
  avgPrice: number;
  markPrice: number;
  unrealisedPnl: number;
  cumRealisedPnl: number;
  takeProfit: number | null;
  stopLoss: number | null;
  trailingStop: number | null;
  liqPrice: number | null;
  positionIdx: number;
  updatedAt: number;
}

export interface TradeOrder {
  accountId: AccountId;
  accountName: string;
  orderId: string;
  orderLinkId: string;
  symbol: string;
  side: Side;
  orderType: string;
  orderStatus: string;
  price: number;
  qty: number;
  leavesQty: number;
  cumExecQty: number;
  triggerPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  reduceOnly: boolean;
  createdTime: number;
  updatedTime: number;
}

export interface TradeExecution {
  accountId: AccountId;
  accountName: string;
  execId: string;
  orderId: string;
  symbol: string;
  side: Side;
  execPrice: number;
  execQty: number;
  execFee: number;
  execTime: number;
}
