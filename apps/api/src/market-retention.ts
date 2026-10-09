import { Worker } from 'node:worker_threads';
import type { FastifyInstance } from 'fastify';
import { MARKET_SIGNAL_RETENTION_MS, marketRetentionError, type MarketRetentionResult } from '@trade/database';

export const MARKET_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export function runMarketRetention(path: string, signal: AbortSignal): Promise<MarketRetentionResult> {
  if (signal.aborted) {
    const now = Date.now();
    return Promise.resolve({ startedAt: new Date(now).toISOString(), cutoffAt: new Date(now - MARKET_SIGNAL_RETENTION_MS).toISOString(), deletedRows: 0, batches: 0, durationMs: 0, stopped: true, error: null });
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./market-retention-worker.js', import.meta.url), { workerData: { path }, resourceLimits: { maxOldGenerationSizeMb: 32 } });
    let result: MarketRetentionResult | undefined;
    let failure: unknown;
    const stop = () => worker.postMessage('stop');
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    worker.on('message', message => { result = message as MarketRetentionResult; });
    worker.on('error', error => { failure = error; });
    // Wait for the connection/thread to close before allowing the next cleanup.
    worker.on('exit', code => {
      signal.removeEventListener('abort', stop);
      if (failure || code !== 0 || !result) reject(failure ?? new Error('Retention thread exited without a result'));
      else resolve(result);
    });
  });
}

/** Register only in app/API. Neither worker service owns a retention scheduler. */
export function registerMarketRetention(app: FastifyInstance, path: string, run = runMarketRetention) {
  const controller = new AbortController();
  let started = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  const runNow = (): Promise<void> => {
    if (!started || controller.signal.aborted) return Promise.resolve();
    if (running) return running;
    const startedAt = new Date().toISOString(), clockStart = performance.now();
    running = Promise.resolve().then(() => run(path, controller.signal)).then(result => {
      const entry = { event: 'market-monitor.retention', ...result };
      if (result.error) app.log.error(entry, 'Market history cleanup failed; next attempt in one hour');
      else app.log.info(entry, 'Market history cleanup finished');
    }).catch(error => {
      // A thread startup/crash failure has no trustworthy deletion count.
      app.log.error({ event: 'market-monitor.retention', startedAt, deletedRows: null, durationMs: Math.round(performance.now() - clockStart), error: marketRetentionError(error) }, 'Market history cleanup thread failed; next attempt in one hour');
    }).finally(() => { running = undefined; });
    return running;
  };
  app.addHook('onListen', async () => {
    started = true;
    timer = setInterval(() => { void runNow(); }, MARKET_RETENTION_INTERVAL_MS);
    timer.unref();
    void runNow();
  });
  app.addHook('preClose', async () => {
    if (timer) clearInterval(timer);
    controller.abort();
    await running;
  });
  return { runNow };
}
