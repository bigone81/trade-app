import type { AccountId, AccountPublic, ExchangeCapabilities, ExchangeId, MarketKind, TradeExecution, TradeOrder, TradePosition } from '@trade/shared';

export interface ExchangeAccountRuntime extends AccountPublic {
  apiKey: string;
  apiSecret: string;
}

export interface ExchangeOrderResponse {
  retCode: number;
  retMsg?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface ExchangeAdapter {
  readonly exchange: ExchangeId;
  readonly capabilities: ExchangeCapabilities;
  supportsMarket(market: MarketKind): boolean;
  getAccount(accountId: AccountId): ExchangeAccountRuntime;
  getAccountBalance(accountId: AccountId): Promise<unknown>;
  getPositions(accountId: AccountId): Promise<TradePosition[]>;
  getOrders(accountId: AccountId, history?: boolean): Promise<TradeOrder[]>;
  getExecutions(accountId: AccountId): Promise<TradeExecution[]>;
}

export type ExchangeAccountResolver = (accountId: AccountId) => ExchangeAccountRuntime;
