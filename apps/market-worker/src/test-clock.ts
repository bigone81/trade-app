import type { QueueClock } from './request-queue.js';

/** Deterministic timers for offline tests; no real sleeping or exchange requests. */
export class TestClock implements QueueClock {
  time = Date.UTC(2026, 0, 1, 12, 0, 5);
  private timers = new Set<{ at: number; finish: () => void }>();
  now = () => this.time;
  sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise(resolve => {
    const timer = { at: this.time + ms, finish: () => {
      this.timers.delete(timer); signal.removeEventListener('abort', timer.finish); resolve();
    } };
    this.timers.add(timer); signal.addEventListener('abort', timer.finish, { once: true });
    if (signal.aborted) timer.finish();
  });
  async flush() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
  async advance(ms: number) {
    const end = this.time + ms;
    await this.flush();
    while (true) {
      const next = [...this.timers].sort((a, b) => a.at - b.at)[0];
      if (!next || next.at > end) break;
      this.time = Math.max(this.time, next.at); next.finish(); await this.flush();
    }
    this.time = Math.max(this.time, end); await this.flush();
  }
  async run<T>(work: Promise<T>): Promise<T> {
    let done = false;
    void work.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 10000 && !done; i++) {
      await this.flush();
      if (done) break;
      const next = [...this.timers].sort((a, b) => a.at - b.at)[0];
      if (!next) throw new Error('Test clock stalled without a pending timer');
      await this.advance(Math.max(0, next.at - this.time));
    }
    if (!done) throw new Error('Test clock iteration budget exhausted');
    return work;
  }
}
