import { setTimeout as sleep } from 'node:timers/promises';

export interface QueueClock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}
export const realClock: QueueClock = { now: Date.now, sleep: async (ms, signal) => { await sleep(ms, undefined, { signal }); } };
type Log = (entry: Record<string, unknown>) => void;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Accept SDK parsed errors, raw Axios errors and Bybit JSON errors. Never log the raw object. */
export function rateLimitInfo(error: unknown, now: number) {
  const e = record(error), response = record(e.response), body = record(response.data ?? e.body);
  const code = Number(e.retCode ?? body.retCode);
  const status = Number(response.status ?? e.status ?? e.code);
  const message = [typeof error === 'string' ? error : '', e.retMsg, e.message, body.retMsg,
    typeof (response.data ?? e.body) === 'string' ? response.data ?? e.body : ''].join(' ');
  const ipBan = status === 403 && /access too frequent/i.test(message);
  if (!(code === 10006 || status === 429 || ipBan || /Too many visits|Exceeded the API Rate Limit/i.test(message))) return null;
  const headers = record(response.headers ?? e.headers);
  const reset = Number(headers['x-bapi-limit-reset-timestamp'] ?? record(e.rateLimitApi).resetAtTimestamp);
  const retryAfter = headers['retry-after'];
  const retryAt = retryAfter === undefined ? 0 : Number.isFinite(Number(retryAfter))
    ? now + Math.max(0, Number(retryAfter)) * 1000 : Date.parse(String(retryAfter));
  return {
    reason: ipBan ? 'ip-access-too-frequent' : code === 10006 ? 'bybit-10006' : status === 429 ? 'http-429' : 'rate-limit-message',
    code: Number.isFinite(code) ? code : Number.isFinite(status) ? status : null,
    // An explicit IP ban requires at least ten minutes, not an ordinary short retry.
    resetAt: Math.max(ipBan ? now + 600_000 : now, Number.isFinite(reset) && reset > now ? reset : now, Number.isFinite(retryAt) ? retryAt : now),
  };
}

export class ScanDeferredError extends Error {
  constructor(reason: string) { super(`Market scan deferred: ${reason}`); this.name = 'ScanDeferredError'; }
}

/** Exclusively for the Market Worker's public GET operations. No trading client uses this queue. */
export class RequestQueue {
  readonly clock: QueueClock;
  private log: Log;
  private random: () => number;
  private admission: Promise<void> = Promise.resolve();
  private live = new Set<Promise<unknown>>();
  private active = 0;
  private releaseSlot: (() => void) | undefined;
  private nextStart = -Infinity;
  private interval = 350;
  private pauseUntil = 0;
  private pauseStarted: number | null = null;
  private pauseTotal = 0;
  private backoffLevel = 0;
  private successes = 0;
  private recoverySince = 0;
  private deadline = Infinity;
  private controller = new AbortController();
  private deferred: ScanDeferredError | null = null;
  private plannedBackoff = 0;
  private cycleStarted = 0;
  private cyclePauseBaseline = 0;
  private counters = { requestsMade: 0, requestsSucceeded: 0, requestsFailed: 0, rateLimitHits: 0, retryCount: 0 };
  constructor(public concurrency = 2, options: { clock?: QueueClock; log?: Log; random?: () => number } = {}) {
    this.clock = options.clock ?? realClock;
    this.log = options.log ?? (entry => console.log(JSON.stringify(entry)));
    this.random = options.random ?? Math.random;
  }
  get requests() { return this.counters.requestsMade; }
  get effectiveRps() { return 1000 / this.interval; }
  private pausedMs() { return this.pauseTotal + (this.pauseStarted === null ? 0 : Math.max(0, Math.min(this.clock.now(), this.pauseUntil) - this.pauseStarted)); }
  get metrics() { return { ...this.counters, backoffMs: this.pausedMs() - this.cyclePauseBaseline, effectiveRps: this.effectiveRps }; }
  beginCycle(deadline: number) {
    if (this.live.size) throw new Error('Market request cycle still running');
    this.deadline = deadline; this.deferred = null; this.controller = new AbortController();
    this.cycleStarted = this.clock.now(); this.cyclePauseBaseline = this.pausedMs();
    this.plannedBackoff = Math.max(0, this.pauseUntil - this.clock.now());
    this.counters = { requestsMade: 0, requestsSucceeded: 0, requestsFailed: 0, rateLimitHits: 0, retryCount: 0 };
  }
  async drain() { await Promise.allSettled([...this.live]); }
  assertCurrent() {
    if (this.deferred) throw this.deferred;
    if (this.clock.now() >= this.deadline) throw this.defer('M5 cycle deadline exceeded');
  }
  defer(reason: string) {
    if (!this.deferred) {
      this.deferred = new ScanDeferredError(reason);
      this.controller.abort(); this.releaseSlot?.();
      this.log({ event: 'market-monitor.scan-deferred', reason, ...this.metrics, cycleDurationMs: this.clock.now() - this.cycleStarted });
    }
    return this.deferred;
  }
  run<T>(request: () => Promise<T>, category: string): Promise<T> {
    const work = this.perform(request, category);
    this.live.add(work);
    void work.then(() => this.live.delete(work), () => this.live.delete(work));
    return work;
  }
  private finishPause() {
    if (this.pauseStarted !== null && this.clock.now() >= this.pauseUntil) {
      const durationMs = this.pauseUntil - this.pauseStarted;
      this.pauseTotal += durationMs; this.pauseStarted = null;
      this.recoverySince = this.clock.now();
      this.log({ event: 'market-monitor.backoff-end', durationMs, effectiveRps: this.effectiveRps });
    }
  }
  private async acquire(start: () => void) {
    const preceding = this.admission;
    let unlock!: () => void;
    this.admission = new Promise<void>(resolve => { unlock = resolve; });
    try {
      await preceding;
      for (;;) {
        this.assertCurrent(); this.finishPause();
        if (this.plannedBackoff > 60_000 || this.pauseUntil >= this.deadline) throw this.defer('rate limit exceeds cycle wait budget');
        if (this.active >= this.concurrency) {
          await new Promise<void>(resolve => { this.releaseSlot = resolve; });
          continue;
        }
        const wait = Math.max(this.nextStart, this.pauseUntil) - this.clock.now();
        if (wait <= 0) break;
        try { await this.clock.sleep(Math.min(wait, this.deadline - this.clock.now()), this.controller.signal); }
        catch { this.assertCurrent(); throw new Error('Market request timer failed'); }
      }
      this.active++;
      // Reserve only the actual start: pauses and slow requests can never accumulate burst credit.
      this.nextStart = this.clock.now() + this.interval;
      // Start synchronously under admission: an error from another in-flight request
      // must not slip between the pause check and the actual request callback.
      start();
    } finally { unlock(); }
  }
  private async perform<T>(request: () => Promise<T>, category: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let response!: Promise<T>;
      await this.acquire(() => {
        this.counters.requestsMade++;
        if (attempt > 0) {
          this.counters.retryCount++;
          this.log({ event: 'market-monitor.request-retry', category, retry: attempt, effectiveRps: this.effectiveRps });
        }
        try { response = request(); } catch (error) { response = Promise.reject(error); }
      });
      let result: T;
      try {
        result = await response;
        this.counters.requestsSucceeded++;
        if (this.clock.now() >= this.pauseUntil && ++this.successes >= 20 && this.clock.now() - this.recoverySince >= 30_000) {
          this.interval = Math.max(350, Math.ceil(this.interval * .8));
          this.successes = 0; this.recoverySince = this.clock.now();
          if (this.interval === 350) this.backoffLevel = 0;
        }
      } catch (error) {
        this.counters.requestsFailed++;
        const limit = rateLimitInfo(error, this.clock.now());
        if (!limit) { this.assertCurrent(); throw error; }
        this.counters.rateLimitHits++;
        this.finishPause();
        const delay = [3000, 10000, 30000][Math.min(this.backoffLevel++, 2)]! + Math.floor(this.random() * 250);
        const until = Math.max(this.pauseUntil, this.clock.now() + delay, limit.resetAt);
        this.plannedBackoff += Math.max(0, until - Math.max(this.clock.now(), this.pauseUntil));
        this.pauseStarted ??= this.clock.now(); this.pauseUntil = until;
        this.interval = Math.min(1400, this.interval * 2); this.successes = 0;
        this.log({ event: 'market-monitor.rate-limit', category, ...limit, retry: attempt, effectiveRps: this.effectiveRps });
        this.log({ event: 'market-monitor.backoff-start', category, durationMs: until - this.clock.now(), retry: attempt, effectiveRps: this.effectiveRps });
        if (attempt >= 3 || this.counters.rateLimitHits >= 4 || this.plannedBackoff > 60_000 || until >= this.deadline) {
          throw this.defer(attempt >= 3 || this.counters.rateLimitHits >= 4 ? 'rate limit retry budget exhausted' : 'rate limit exceeds cycle wait budget');
        }
        this.assertCurrent();
        continue;
      } finally {
        this.active--; const release = this.releaseSlot; this.releaseSlot = undefined; release?.();
      }
      this.assertCurrent();
      return result;
    }
  }
}
