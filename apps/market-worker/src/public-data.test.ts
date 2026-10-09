import test from 'node:test';
import assert from 'node:assert/strict';
import { BybitAdapter, createMarketReadClient } from '@trade/exchanges-bybit';
import { createMarketData } from './public-data.js';
import { RequestQueue, rateLimitInfo } from './request-queue.js';
import { TestClock } from './test-clock.js';

test('public reader preserves Bybit code and reset time for every endpoint, without internal retries', async () => {
  let calls = 0;
  const response = { retCode: 10006, retMsg: 'Too many visits', rateLimitApi: { resetAtTimestamp: 9000 } };
  const fail = async () => { calls++; return response; };
  const data = createMarketData({ getKline: fail, getTickers: fail, getInstrumentsInfo: fail } as unknown as ReturnType<typeof createMarketReadClient>);
  for (const work of [() => data.getCandles('BTCUSDT', '5', 30), () => data.getTickers(), () => data.getInstruments()]) {
    await assert.rejects(work, error => rateLimitInfo(error, 0)?.resetAt === 9000);
  }
  assert.equal(calls, 3);
});

test('public candle conversion stays identical to the chart adapter', async () => {
  const response = { retCode: 0, retMsg: 'OK', result: { list: [['600000', '2', '3', '1', '2.5', '20'], ['300000', '1', '2', '.5', '1.5', '10']] } };
  const client = { getKline: async () => response } as unknown as ReturnType<typeof createMarketReadClient>;
  const adapter = new BybitAdapter(() => { throw new Error('No accounts'); });
  adapter.getPublicClient().getKline = client.getKline;
  assert.deepEqual(await createMarketData(client).getCandles('BTCUSDT', '5', 30), await adapter.getCandles('BTCUSDT', '5', 30));
});

test('Market backoff does not pause or retry submit, amend, cancel, close or trading-stop operations', async () => {
  const clock = new TestClock();
  const queue = new RequestQueue(2, { clock, random: () => 0, log: () => {} });
  queue.beginCycle(clock.now() + 240000);
  let reads = 0;
  const reading = queue.run(async () => { if (++reads === 1) throw { retCode: 10006 }; return true; }, 'tickers');
  await clock.flush();
  assert.equal(reads, 1);
  const start = clock.now(); const called: string[] = [];
  const adapter = new BybitAdapter(() => { throw new Error('No real credentials'); });
  const methods = ['submitOrder', 'amendOrder', 'cancelOrder', 'cancelAllOrders', 'setTradingStop'] as const;
  const client = Object.fromEntries(methods.map(method => [method, async () => { called.push(method); throw { retCode: 10006 }; }])) as unknown as ReturnType<typeof adapter.getPrivateClient>;
  adapter.getPrivateClient = () => client;
  for (const method of methods) await assert.rejects(async () => adapter[method](1, { symbol: 'BTCUSDT' }));
  await assert.rejects(async () => adapter.submitOrder(1, { symbol: 'BTCUSDT', reduceOnly: true }));
  assert.deepEqual(called, [...methods, 'submitOrder']);
  assert.equal(clock.now(), start); assert.equal(reads, 1);
  assert.equal(await clock.run(reading), true);
});
