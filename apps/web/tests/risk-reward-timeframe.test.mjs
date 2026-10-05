import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { calculateRiskReward } from '@trade/domain';
import * as chartTime from '../src/chartTime.ts';
import { openDatabase, createRiskReward, listRiskRewards, updateRiskReward } from '../../../packages/database/src/index.ts';

const source = readFileSync(new URL('../src/components/RiskRewardOverlay.tsx', import.meta.url), 'utf8');
const chartSource = readFileSync(new URL('../src/components/TradingChart.tsx', import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiled = compile(source);
const start = Date.UTC(2026, 9, 5, 10) / 1000;
const bars = tf => {
  const step = chartTime.timeframeSeconds(tf);
  const first = Math.floor((start - 86400) / step) * step;
  return Array.from({ length: Math.ceil(172800 / step) + 1 }, (_, i) => ({ time: first + i * step }));
};
const record = (tf = '60', width = 5) => {
  // Execute the creation calculation from TradingChart, so tests cover the
  // production default-width path as well as the overlay's saved records.
  const calculation = chartSource.match(/const widthBars = [^;]+;\s*const endTime = [^;]+;/)[0];
  const endTime = vm.runInNewContext(`${calculation}\nendTime`, {
    startTime: start, timeframeSeconds: chartTime.timeframeSeconds,
    timeframeRef: { current: tf }, rrPreferencesRef: { current: { defaultWidthBars: width } },
  });
  return { id: 1, symbol: 'BTCUSDT', timeframe: tf, direction: 'long', entry: 100, stop: 90, target: 130, startTime: start, endTime };
};

// Run the entire production overlay: JSX, event handlers and hook effects.
// Only React scheduling and chart/canvas APIs are replaced by deterministic mocks.
function overlay(initial, initialTf = '60', onUpdate = () => {}) {
  let slots = [], effects = [], registered = [], cursor = 0, dirty = false, tree;
  let items = [initial], timeframe = initialTf, candles = bars(timeframe), offset = 0;
  let selected = initial;
  const listeners = new Map(), updates = [], options = [], directCalls = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const react = {
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], next => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: fn => fn(),
    useEffect: (fn, deps) => registered.push({ fn, deps }),
  };
  const scale = {
    timeToCoordinate(time) {
      directCalls.push(time);
      const index = candles.findIndex(c => c.time === time);
      return index < 0 ? null : index * 10 + offset;
    },
    logicalToCoordinate: logical => logical * 10 + offset,
    coordinateToLogical: x => (x - offset) / 10,
    subscribeVisibleTimeRangeChange() {}, unsubscribeVisibleTimeRangeChange() {},
    subscribeVisibleLogicalRangeChange() {}, unsubscribeVisibleLogicalRangeChange() {},
  };
  const chart = {
    timeScale: () => scale, applyOptions: option => options.push(option),
    subscribeCrosshairMove() {}, unsubscribeCrosshairMove() {},
  };
  const props = {
    chart, series: { priceToCoordinate: p => p, coordinateToPrice: y => y },
    host: { clientWidth: 1000, clientHeight: 600, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    onSelect: item => { selected = item; }, onDelete() {},
    onUpdate: (id, patch) => { updates.push({ id, patch }); onUpdate(id, patch); items = items.map(r => r.id === id ? { ...r, ...patch } : r); },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === '../chartTime') return chartTime;
      if (name === '../i18n') return { useI18n: () => ({ language: 'en' }) };
      if (name === '@trade/domain') return { calculateRiskReward };
      throw new Error(`Unexpected import: ${name}`);
    },
    // Keep the record at the live edge: the old BarGeometry path must be exercised.
    Date: class extends Date { static now() { return (start + 1800) * 1000; } },
    localStorage: { getItem: () => null, setItem() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    window: {
      addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    },
  });
  function render() {
    do {
      dirty = false; cursor = 0; registered = [];
      tree = module.exports.default({ ...props, items, candles, timeframe, selectedId: selected?.id ?? null });
      const changed = registered.map((effect, i) => !effects[i] || effect.deps.some((dep, j) => !Object.is(dep, effects[i].deps[j])));
      effects.forEach((effect, i) => { if (changed[i]) effect.cleanup?.(); });
      effects = registered.map((effect, i) => changed[i] ? { ...effect, cleanup: effect.fn() } : effects[i]);
    } while (dirty);
  }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(n => nodes(n));
    return [node, ...nodes(node.props?.children ?? null)];
  }
  const find = (tag, className) => nodes().find(n => n.type === tag && n.props.className?.split(' ').includes(className));
  const unmount = () => { effects.forEach(effect => effect.cleanup?.()); effects = []; slots = []; };
  const emit = (name, x, y = 100) => {
    for (const fn of [...listeners.get(name) ?? []]) fn({ clientX: x, clientY: y });
    render();
  };
  render();
  return {
    updates, directCalls, options, unmount,
    get selected() { return selected; },
    get item() { return items[0]; },
    geometry: () => {
      const line = find('line', 'rr-price-entry').props;
      return { start: line.x1, end: line.x2, entry: line.y1, stop: find('line', 'rr-price-stop').props.y1, target: find('line', 'rr-price-target').props.y1 };
    },
    switchTf(tf) {
      // React's production key is symbol + timeframe; changing it unmounts the old drag.
      if (tf !== timeframe) unmount();
      timeframe = tf; candles = bars(tf); render();
    },
    pan: x => { offset = x; render(); },
    x: time => chartTime.logicalAtTime(candles, time, chartTime.timeframeSeconds(timeframe)) * 10 + offset,
    begin(kind, x, y = 100) {
      const handle = kind === 'move' ? find('circle', 'rr-move-handle')
        : nodes().filter(n => n.type === 'circle' && n.props.className === 'rr-handle time')[kind === 'startTime' ? 0 : 1];
      handle.props.onPointerDown({ clientX: x, clientY: y, stopPropagation() {}, preventDefault() {} });
      render();
    },
    move: (x, y) => emit('pointermove', x, y),
    finish: () => emit('pointerup', 0),
  };
}

test('A: five hourly bars render as 60 five-minute bars, then five hourly bars', () => {
  const r = Object.freeze(record());
  const h = overlay(r);
  assert.equal(r.endTime - r.startTime, 5 * 3600);
  for (const [tf, width] of [['60', 50], ['5', 600], ['60', 50]]) {
    h.switchTf(tf);
    const g = h.geometry();
    assert.equal(g.start, h.x(r.startTime));
    assert.equal(g.end, h.x(r.endTime));
    assert.equal(g.end - g.start, width);
  }
  assert.equal(h.updates.length, 0);
  h.unmount();
});

test('B: 150 minutes survives 5m -> 15m -> 1h -> 5m with fractional endpoints', () => {
  const r = Object.freeze({ ...record('5', 30), startTime: start + 120, endTime: start + 9120 });
  const h = overlay(r, '5');
  for (const tf of ['5', '15', '60', '5']) {
    h.switchTf(tf);
    assert.equal(h.geometry().start, h.x(r.startTime));
    assert.equal(h.geometry().end, h.x(r.endTime));
    assert.equal(h.item, r);
  }
  assert.equal(h.updates.length, 0);
  h.unmount();
});

test('C: ten switch cycles preserve the SQLite record and selected R/R without writes', async t => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const r = createRiskReward(db, record());
  const before = db.prepare('SELECT * FROM risk_rewards').get();
  const h = overlay(Object.freeze(r), '60', (id, patch) => updateRiskReward(db, id, patch));
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } });
  t.after(() => {
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else delete globalThis.localStorage;
    if (location) Object.defineProperty(globalThis, 'location', location); else delete globalThis.location;
    h.unmount();
  });
  const { useUi } = await import('../src/store.ts?rr-timeframe');
  useUi.getState().selectRiskReward(r);
  for (let i = 0; i < 10; i++) {
    for (const tf of ['60', '5', '15', '240', '60']) {
      useUi.getState().setTimeframe(tf);
      h.switchTf(tf);
      assert.equal(useUi.getState().selectedRiskReward, r);
      assert.equal(h.geometry().start, h.x(r.startTime));
      assert.equal(h.geometry().end, h.x(r.endTime));
    }
  }
  assert.equal(h.updates.length, 0);
  assert.deepEqual(db.prepare('SELECT * FROM risk_rewards').get(), before);
  assert.deepEqual(listRiskRewards(db, 'BTCUSDT'), [r]);
});

test('D: moving on 5m adds exactly 35 minutes and preserves duration on 1h', () => {
  const r = record();
  const h = overlay(r, '5');
  h.begin('move', h.x(r.startTime));
  h.move(h.x(r.startTime + 2100));
  h.finish();
  assert.equal(h.item.startTime, r.startTime + 2100);
  assert.equal(h.item.endTime, r.endTime + 2100);
  assert.equal(h.item.endTime - h.item.startTime, r.endTime - r.startTime);
  assert.equal(h.item.entry, r.entry);
  h.switchTf('60');
  assert.equal(h.geometry().start, h.x(r.startTime + 2100));
  assert.equal(h.geometry().end, h.x(r.endTime + 2100));
  assert.equal(h.updates.length, 1);
  h.unmount();
});

test('E: right handle retains its exact second on 5m -> 1h -> 5m', () => {
  const r = record();
  const h = overlay(r, '5');
  const end = r.endTime + 457;
  h.begin('endTime', h.x(r.endTime));
  h.move(h.x(end));
  h.finish();
  for (const tf of ['60', '5']) {
    h.switchTf(tf);
    assert.equal(h.item.startTime, r.startTime);
    assert.equal(h.item.endTime, end);
    assert.equal(h.geometry().end, h.x(end));
  }
  assert.equal(h.item.entry, r.entry);
  assert.equal(h.item.stop, r.stop);
  assert.equal(h.item.target, r.target);
  h.unmount();
});

test('coarse TFs retain sub-bar geometry and left/right handles allow intervals below one bar', () => {
  const r = record('5', 30);
  const h = overlay(r, '240');
  assert.ok(h.geometry().end - h.geometry().start < 34);
  assert.equal(h.geometry().end, h.x(r.endTime));
  h.begin('startTime', h.x(r.startTime));
  h.move(h.x(r.endTime - 120));
  h.finish();
  assert.equal(h.item.startTime, r.endTime - 120);
  assert.equal(h.item.endTime, r.endTime);
  h.begin('endTime', h.x(r.endTime));
  h.move(h.x(h.item.startTime - 60));
  h.finish();
  assert.equal(h.item.endTime - h.item.startTime, 1);
  h.unmount();
});

test('TF key cancels an unfinished drag; viewport changes do not reposition the record', () => {
  assert.match(chartSource, /<RiskRewardOverlay\s+key=\{`\$\{p\.symbol\}\|\$\{p\.timeframe\}`\}/);
  const r = record();
  const h = overlay(r, '5');
  h.begin('move', h.x(r.startTime));
  h.move(h.x(r.startTime + 2100));
  h.switchTf('60');
  h.finish();
  assert.equal(h.item, r);
  assert.equal(h.updates.length, 0);
  assert.equal(h.options.at(-1).handleScroll, true);
  h.pan(-10000);
  assert.ok(h.geometry().end < 0, 'an off-screen record stays off screen');
  assert.equal(h.geometry().start, h.x(r.startTime));
  assert.equal(h.item, r);
  h.unmount();
});
