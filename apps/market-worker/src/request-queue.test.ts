import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestQueue, rateLimitInfo, ScanDeferredError } from './request-queue.js';
import { TestClock } from './test-clock.js';

function setup(concurrency = 2) {
  const clock = new TestClock(), logs: Record<string, unknown>[] = [];
  const queue = new RequestQueue(concurrency, { clock, random: () => 0, log: entry => logs.push(entry) });
  queue.beginCycle(clock.now() + 240000);
  return { queue, clock, logs };
}

for (const concurrency of [1, 2, 5]) test(`starts spaced at least 350ms and concurrency ${concurrency} respected`, async () => {
  const { clock, queue } = setup(concurrency);
  const starts: number[] = []; let active = 0, max = 0;
  const tasks = Array.from({ length: 10 }, (_, i) => queue.run(async () => {
    starts.push(clock.now()); max = Math.max(max, ++active);
    await clock.sleep(2000, new AbortController().signal); active--;
    if (i === 3) throw new Error('ordinary error');
    return i;
  }, 'kline:5'));
  const result = await clock.run(Promise.allSettled(tasks));
  assert.equal(max, concurrency); assert.equal(active, 0);
  assert.equal(result.filter(x => x.status === 'rejected').length, 1);
  assert.ok(starts.slice(1).every((value, i) => value - starts[i]! >= 350));
  assert.equal(queue.metrics.requestsMade, 10); assert.equal(queue.metrics.requestsSucceeded, 9);
  assert.equal(queue.metrics.requestsFailed, 1); assert.equal(queue.metrics.retryCount, 0);
});

test('recognizes SDK and Axios limits, but not unrelated 403 or generic network failures', () => {
  for (const error of [{ retCode: 10006 }, { code: 429 }, { response: { status: 429 } }, new Error('Too many visits'), new Error('Exceeded the API Rate Limit')]) assert.ok(rateLimitInfo(error, 0));
  for (const error of [{ code: 403, body: 'Forbidden country' }, new Error('HTTP 500'), { retCode: 10001 }, new Error('timeout')]) assert.equal(rateLimitInfo(error, 0), null);
  assert.equal(rateLimitInfo({ code: 403, body: 'access too frequent' }, 1000)?.resetAt, 601000);
  assert.equal(rateLimitInfo({ retCode: 10006, rateLimitApi: { resetAtTimestamp: 9000 } }, 1000)?.resetAt, 9000);
  assert.equal(rateLimitInfo({ response: { status: 429, headers: { 'retry-after': '12' } } }, 1000)?.resetAt, 13000);
});

for (const error of [{ retCode: 10006 }, { code: 429 }]) test(`global pause, safe retry and slower recovery for ${JSON.stringify(error)}`, async () => {
  const { clock, queue, logs } = setup(); const origin = clock.now();
  const starts: number[] = []; let tries = 0;
  const one = queue.run(async () => { starts.push(clock.now()); if (++tries === 1) throw error; return 'recovered'; }, 'tickers');
  const others = Array.from({ length: 3 }, () => queue.run(async () => { starts.push(clock.now()); return 'ok'; }, 'instruments'));
  const result = await clock.run(Promise.all([one, ...others]));
  assert.equal(result[0], 'recovered'); assert.equal(tries, 2);
  assert.equal(starts[1]! - origin, 3000);
  assert.ok(starts.slice(2).every((value, i) => value - starts[i + 1]! >= 700));
  assert.equal(queue.metrics.retryCount, 1); assert.equal(queue.metrics.rateLimitHits, 1); assert.equal(queue.metrics.backoffMs, 3000);
  assert.equal(queue.metrics.requestsMade, 5);
  assert.ok(logs.some(x => x.event === 'market-monitor.backoff-end'));
  const slow = queue.effectiveRps;
  await clock.advance(30000);
  await clock.run(Promise.all(Array.from({ length: 25 }, () => queue.run(async () => 1, 'kline:5'))));
  assert.ok(queue.effectiveRps > slow); assert.ok(queue.effectiveRps <= 1000 / 350);
});

test('repeated limit increases backoff and exhausts bounded retries', async () => {
  const { clock, queue, logs } = setup(); const starts: number[] = [];
  await clock.run(assert.rejects(queue.run(async () => { starts.push(clock.now()); throw { retCode: 10006 }; }, 'kline:60'), ScanDeferredError));
  assert.equal(starts.length, 4);
  assert.deepEqual(starts.slice(1).map((time, i) => time - starts[i]!), [3000, 10000, 30000]);
  assert.equal(queue.metrics.retryCount, 3);
  assert.equal(logs.filter(x => x.event === 'market-monitor.scan-deferred').length, 1);
  await assert.rejects(queue.run(async () => assert.fail('must not launch'), 'tickers'), ScanDeferredError);
});

test('persistent limits cancel a large backlog without a per-symbol error storm', async () => {
  const { clock, queue, logs } = setup(5);
  const results = await clock.run(Promise.allSettled(Array.from({ length: 80 }, () => queue.run(async () => { throw { code: 429 }; }, 'kline:5'))));
  assert.ok(queue.metrics.requestsMade <= 4);
  assert.equal(results.filter(x => x.status === 'rejected').length, 80);
  assert.equal(logs.filter(x => x.event === 'market-monitor.scan-deferred').length, 1);
});

test('reset headers and explicit IP ban defer immediately, with pause preserved into next cycle', async () => {
  const { clock, queue } = setup(); const origin = clock.now();
  await clock.run(assert.rejects(queue.run(async () => { throw { code: 403, body: 'access too frequent' }; }, 'tickers'), ScanDeferredError));
  assert.equal(clock.now(), origin); assert.equal(queue.metrics.requestsMade, 1);
  clock.time += 300000; queue.beginCycle(clock.now() + 240000);
  await assert.rejects(queue.run(async () => assert.fail('IP ban still active'), 'tickers'), ScanDeferredError);
  clock.time = origin + 600000; queue.beginCycle(clock.now() + 240000);
  assert.equal(await clock.run(queue.run(async () => 42, 'tickers')), 42);
});

test('deadline rejects late responses and no queued request starts after deadline', async () => {
  const { clock, queue } = setup(); queue.beginCycle(clock.now() + 1000);
  let starts = 0;
  const work = Array.from({ length: 6 }, () => queue.run(async () => { starts++; await clock.sleep(1500, new AbortController().signal); return 1; }, 'kline:5'));
  const results = await clock.run(Promise.allSettled(work));
  assert.equal(starts, 2); assert.ok(results.every(x => x.status === 'rejected' && x.reason instanceof ScanDeferredError));
  assert.equal(queue.metrics.requestsSucceeded, 2);
});

test('an in-flight rate limit extends the common pause while another request is already waiting', async () => {
  const { clock, queue } = setup(); const origin = clock.now(); const starts: number[] = [];
  const jobs = [0, 1, 2].map(id => {
    let attempts = 0;
    return queue.run(async () => {
      starts.push(clock.now());
      if (id < 2 && attempts++ === 0) {
        await clock.sleep(500, new AbortController().signal); throw { retCode: 10006 };
      }
      return id;
    }, 'kline:5');
  });
  assert.deepEqual(await clock.run(Promise.all(jobs)), [0, 1, 2]);
  assert.deepEqual(starts.slice(0, 2), [origin, origin + 350]);
  assert.ok(starts[2]! >= origin + 10850);
  assert.ok(starts.slice(3).every((value, i) => value - starts[i + 2]! >= 1400));
  assert.equal(queue.metrics.backoffMs, 10350, 'overlapping pauses are counted only once');
});

test('server reset timestamp can extend backoff beyond the local minimum', async () => {
  const { clock, queue } = setup(); const origin = clock.now(); let attempts = 0;
  await clock.run(queue.run(async () => {
    if (++attempts === 1) throw { retCode: 10006, rateLimitApi: { resetAtTimestamp: origin + 8000 } };
    return 1;
  }, 'instruments'));
  assert.equal(clock.now() - origin, 8000); assert.equal(queue.metrics.backoffMs, 8000);
});

test('admission and request start stay atomic when an in-flight limit arrives at the same instant', async () => {
  const { clock, queue, logs } = setup();
  const sleep = clock.sleep;
  let failFirst!: (error: unknown) => void;
  let injected = false, first = true;
  clock.sleep = (ms, signal) => {
    if (injected) return sleep(ms, signal);
    injected = true;
    return new Promise(resolve => { void sleep(ms, signal).then(() => { resolve(); failFirst({ retCode: 10006 }); }); });
  };
  const pending = queue.run(() => {
    if (first) { first = false; return new Promise<void>((_resolve, reject) => { failFirst = reject; }); }
    return Promise.resolve();
  }, 'tickers');
  const second = queue.run(async () => {
    // A request may start immediately BEFORE the limit is recognized, never after it.
    assert.equal(logs.filter(x => x.event === 'market-monitor.rate-limit').length, 0);
  }, 'instruments');
  await clock.run(Promise.all([pending, second]));
  assert.equal(queue.metrics.rateLimitHits, 1); assert.equal(queue.metrics.retryCount, 1);
});
