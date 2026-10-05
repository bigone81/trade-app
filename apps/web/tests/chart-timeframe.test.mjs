import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { candleTimeAtLogical, logicalAtTime, timeframeSeconds } from '../src/chartTime.ts';
import { DEFAULT_BAR_SPACING } from '../src/preferences.ts';

const parse = (path) => {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
};
const chartSource = parse('../src/components/TradingChart.tsx');
const component = chartSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'TradingChart');

// Execute the production lifecycle effects and their real dependency arrays in
// declaration order. Canvas/rendering is mocked; no DOM/test-renderer dependency
// is needed for these data, subscription and viewport regressions.
const effectSources = component.body.statements.filter((node) =>
  ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(chartSource) === 'useEffect'
  && /pendingSymbolLiveRef|const next = p\.candles|subscribeVisibleTimeRangeChange|series\.setData|new WebSocket|viewRestoreTimerRef/.test(node.getText(chartSource)),
).map((node) => node.getText(chartSource));
const helperSources = chartSource.statements.filter((node) =>
  /^(const timeframeSeconds|const intervalBucket|function candleTimeAtLogical|function logicalAtTime)\b/.test(node.getText(chartSource)),
).map((node) => node.getText(chartSource));
const compile = (code) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
}).outputText;

const bars = (step = 300, end = 1_800_000_000) => Array.from({ length: 1000 }, (_, index) => ({
  time: end - (999 - index) * step, open: 100, high: 102, low: 99, close: 101, volume: 1,
}));

function chartHarness(initialTf = '5', initialBars = bars(), storedView = null, storedSpacing = 3) {
  const ref = (current) => ({ current });
  const events = [];
  const sockets = [];
  const timers = new Map();
  const listeners = new Set();
  const saved = [];
  const savedSpacings = [];
  let timerId = 0;
  let effects = [];
  let registered = [];
  let range = { from: 800, to: 1023 };
  let data = [];
  let spacing = storedSpacing;
  const notify = () => listeners.forEach((listener) => listener());
  const timeScale = {
    options: () => ({ barSpacing: spacing }),
    getVisibleLogicalRange: () => range,
    subscribeVisibleTimeRangeChange: (fn) => listeners.add(fn),
    subscribeVisibleLogicalRangeChange: (fn) => listeners.add(fn),
    unsubscribeVisibleTimeRangeChange: (fn) => listeners.delete(fn),
    unsubscribeVisibleLogicalRangeChange: (fn) => listeners.delete(fn),
    applyOptions: (options) => { if (options.barSpacing) spacing = options.barSpacing; },
    scrollToPosition: (offset, animated) => {
      assert.equal(animated, false);
      events.push('live');
      range = { from: data.length - 200, to: data.length - 1 + offset };
      notify();
    },
    scrollToRealTime: () => { events.push('animatedLive'); },
    fitContent: () => { events.push('fit'); },
    setVisibleLogicalRange: (next) => { range = next; spacing = 1200 / (next.to - next.from); events.push('restore'); notify(); },
  };
  const chart = { timeScale: () => timeScale };
  const series = {
    priceScale: () => ({ applyOptions() {} }),
    setData: (next) => { data = next; events.push(`data:${next.length}`); notify(); },
    update: (bar) => {
      events.push('update');
      if (bar.time === data.at(-1)?.time) data[data.length - 1] = bar;
      else data.push(bar);
    },
  };
  const scope = {
    chart, series, futureBars: 24, barSpacingRef: ref(storedSpacing),
    candleTimeAtLogical, logicalAtTime, timeframeSeconds,
    hostRef: ref({}), viewSymbolRef: ref('BTCUSDT'), viewTimeframeRef: ref(initialTf),
    pendingSymbolLiveRef: ref(false), pendingTimeframeLiveRef: ref(false),
    restoringViewRef: ref(false), saveViewTimerRef: ref(null), viewRestoreTimerRef: ref(null),
    appliedViewChartRef: ref(null), appliedViewKeyRef: ref(null),
    timelineCandlesRef: ref(initialBars), lastLiveCandleRef: ref(initialBars.at(-1)),
    latestLogicalRef: ref(initialBars.length - 1), followLiveRef: ref(true),
    lastPriceReportAtRef: ref(0), onLivePriceRef: ref(null),
    preferences: { chart: { autoFollowLive: true } },
    setTimelineCandles() {}, setOverlayVersion() {}, setIsAtLiveEdge() {}, setWsState() {},
    readChartView: () => storedView,
    writeChartBarSpacing: (value) => savedSpacings.push(value),
    writeChartView: (symbol, tf, view) => saved.push({ symbol, tf, ...view }),
    useEffect: (fn, deps) => registered.push({ fn, deps }),
    ResizeObserver: class { observe() {} disconnect() {} },
    WebSocket: class {
      constructor() { sockets.push(this); }
      close() { this.closed = true; }
    },
    window: {
      setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
      clearTimeout: (id) => timers.delete(id),
      requestAnimationFrame: (fn) => { timers.set(++timerId, fn); return timerId; },
      cancelAnimationFrame: (id) => timers.delete(id),
      clearInterval() {},
    },
  };
  vm.createContext(scope);
  vm.runInContext(compile(`${helperSources.join('\n')}\nfunction render(p) { ${effectSources.join('\n')} }`), scope);
  const render = (timeframe, candles, symbol = 'BTCUSDT') => {
    registered = [];
    scope.render({ timeframe, candles, symbol });
    const changed = registered.map((effect, i) => !effects[i]
      || effect.deps.some((dep, j) => !Object.is(dep, effects[i].deps[j])));
    effects.forEach((effect, i) => { if (changed[i]) effect.cleanup?.(); });
    effects = registered.map((effect, i) => changed[i]
      ? { ...effect, cleanup: effect.fn() } : effects[i]);
  };
  return {
    render, events, sockets, saved, savedSpacings, scope,
    get data() { return data; }, get range() { return range; }, get spacing() { return spacing; },
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); },
    pan: () => { range = { from: 100, to: 200 }; notify(); },
    zoom: (value) => { spacing = value; notify(); },
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
  };
}

test('TF installation waits for history, goes live after setData and retains zoom', () => {
  const h = chartHarness('60', bars(3600), { fromTime: 1_790_000_000, toTime: 1_790_100_000 }, 9);
  h.render('60', bars(3600));
  h.flush();
  assert.ok(h.events.includes('restore'), 'initial mount still restores the saved view');
  h.events.length = 0;
  h.pan(); // Leave an old debounced save pending across the switch.
  h.render('5', []);
  h.flush();
  assert.equal(h.sockets.length, 1, 'no new socket until history is installed');
  assert.equal(h.saved.length, 0, 'old TF save is cancelled');
  assert.ok(!h.events.includes('live'));
  h.render('5', bars());
  assert.deepEqual(h.events.slice(-2), ['data:1000', 'live']);
  assert.equal(h.range.to, 1023);
  assert.equal(h.spacing, 9);
  assert.equal(h.scope.followLiveRef.current, true);
  assert.ok(!h.events.includes('restore'));
  assert.ok(!h.events.includes('fit'));
  h.unmount();
});

test('rapid 5m -> 1h -> cached 5m still goes live, even if 1h never loaded', () => {
  const cached = bars();
  const h = chartHarness('5', cached);
  h.render('5', cached);
  h.flush();
  h.pan();
  h.events.length = 0;
  h.render('60', []);
  h.render('5', cached);
  assert.deepEqual(h.events, ['data:0', 'data:1000', 'live']);
  assert.equal(h.range.to, 1023);
  h.unmount();
});

test('cached TFs with equal candle counts apply data before moving live', () => {
  const h = chartHarness();
  h.render('5', bars());
  h.flush();
  h.events.length = 0;
  h.render('60', bars(3600));
  h.render('5', bars());
  assert.deepEqual(h.events, ['data:1000', 'live', 'data:1000', 'live']);
  h.unmount();
});

test('live bars and same-TF history refresh preserve a manual pan; stale sockets cannot write', () => {
  const h = chartHarness();
  h.render('5', bars());
  const oldMessage = h.sockets[0].onmessage;
  h.render('60', bars(3600));
  h.flush();
  h.pan();
  h.events.length = 0;
  const message = (tf, time) => ({ data: JSON.stringify({ topic: `kline.${tf}.BTCUSDT`, data: [{
    start: time * 1000, open: 100, high: 103, low: 99, close: 102, volume: 1,
  }] }) });
  oldMessage(message('5', 1_800_000_300));
  assert.deepEqual(h.events, [], 'queued packet from a stopped socket is ignored');
  h.sockets.at(-1).onmessage(message('60', 1_800_003_600));
  assert.deepEqual(h.events, ['update']);
  h.render('60', bars(3600, 1_800_003_600));
  assert.deepEqual(h.events, ['update', 'data:1000']);
  assert.equal(h.range.to, 200);
  assert.equal(h.scope.followLiveRef.current, false);
  h.unmount();
});

test('symbol selection retains user zoom and the default right margin', () => {
  const h = chartHarness();
  h.render('5', bars());
  h.flush();
  h.zoom(4);
  h.render('5', bars(), 'SOLUSDT');
  assert.equal(h.spacing, 4);
  assert.equal(h.range.to, 1023);
  h.unmount();
});

test('fresh view starts at 3px with 24 future bars instead of fitting all history', () => {
  const h = chartHarness();
  h.render('5', bars());
  assert.equal(h.spacing, 3);
  assert.equal(h.range.to, 1023);
  assert.ok(!h.events.includes('fit'));
  h.unmount();
});

test('zoom survives immediate navigation and reload, overriding an older saved range', () => {
  const h = chartHarness();
  h.render('5', bars());
  h.flush();
  h.zoom(2.5);
  assert.deepEqual(h.savedSpacings, [2.5], 'zoom is saved without waiting for the position debounce');
  h.render('60', []);
  h.render('60', bars(3600), 'SOLUSDT');
  assert.equal(h.spacing, 2.5);
  h.unmount();
  const reloaded = chartHarness('60', bars(3600), { fromTime: 1_790_000_000, toTime: 1_790_100_000 }, h.savedSpacings.at(-1));
  reloaded.render('60', bars(3600));
  assert.ok(reloaded.events.includes('restore'));
  assert.equal(reloaded.spacing, 2.5);
  assert.deepEqual(reloaded.savedSpacings, [], 'view restoration must not overwrite the saved zoom');
  reloaded.unmount();
});

test('debounced view saving captures the candles at the time of the pan', () => {
  const history = bars();
  const h = chartHarness('5', history);
  h.render('5', history);
  h.flush();
  h.pan();
  h.scope.timelineCandlesRef.current = bars(300, 1_900_000_000);
  h.flush();
  assert.equal(h.saved.at(-1).fromTime, history[100].time);
  assert.equal(h.saved.at(-1).toTime, history[200].time);
  h.unmount();
});

test('price-axis double click resets and saves default zoom at live edge; LIVE preserves zoom', () => {
  const effect = component.body.statements.find((node) =>
    ts.isExpressionStatement(node) && node.getText(chartSource).includes("host.addEventListener('dblclick'"));
  const live = component.body.statements.find((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(chartSource) === 'returnToLive');
  const handlers = new Map();
  const frames = [];
  const h = chartHarness();
  h.render('5', bars());
  h.flush();
  h.zoom(2.5);
  h.pan();
  h.events.length = 0;
  const priceOptions = [];
  const timeOptions = [];
  const liveStates = [];
  const context = {
    ...h.scope,
    DEFAULT_BAR_SPACING,
    futureBars: 32,
    setIsAtLiveEdge: (value) => liveStates.push(value),
    hostRef: { current: {
      clientWidth: 1200,
      getBoundingClientRect: () => ({ left: 0 }),
      addEventListener: (name, handler) => handlers.set(name, handler),
      removeEventListener() {},
    } },
    chart: {
      timeScale: () => ({
        ...h.scope.chart.timeScale(),
        applyOptions: (options) => {
          timeOptions.push(options);
          h.scope.chart.timeScale().applyOptions(options);
        },
      }),
      priceScale: () => ({ width: () => 64 }),
    },
    series: { priceScale: () => ({ applyOptions: (options) => priceOptions.push(options) }) },
    useEffect: (fn) => fn(),
    window: { requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; } },
  };
  vm.runInNewContext(compile(`${effect.getText(chartSource)}\n${live.getText(chartSource)}\nglobalThis.live = returnToLive;`), context);
  handlers.get('dblclick')({ clientX: 600 });
  frames.splice(0).forEach((fn) => fn());
  assert.equal(priceOptions.length, 0, 'double click within the plot must not reset the view');
  assert.equal(h.spacing, 2.5);
  assert.deepEqual(h.events, []);
  handlers.get('dblclick')({ clientX: 1180 });
  frames.splice(0).forEach((fn) => fn());
  assert.equal(priceOptions.length, 1);
  assert.equal(priceOptions[0].autoScale, true);
  assert.equal(h.spacing, 3);
  assert.equal(h.scope.barSpacingRef.current, 3);
  assert.equal(h.savedSpacings.at(-1), 3, 'reset zoom must survive a reload');
  assert.equal(timeOptions.at(-1).rightOffset, 32, 'preserve the configured future-bar margin');
  assert.equal(h.scope.followLiveRef.current, true);
  assert.deepEqual(liveStates, [true]);
  assert.deepEqual(h.events, ['animatedLive']);
  h.zoom(2.5);
  h.events.length = 0;
  context.live();
  assert.deepEqual(h.events, ['animatedLive']);
  assert.equal(h.spacing, 2.5);
  h.unmount();
});

test('real QueryObserver cancels 5m -> 1h -> 5m requests and rejects late results', async () => {
  const source = parse('../src/pages/ChartPage.tsx');
  let optionsSource;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'candles') {
      optionsSource = node.initializer.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const requests = [];
  const options = vm.runInNewContext(compile(`(ui) => (${optionsSource})`), {
    api: (path, init) => new Promise((resolve) => requests.push({ path, signal: init?.signal, resolve })),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const forTf = (timeframe) => options({ symbol: 'BTCUSDT', timeframe });
  const observer = new QueryObserver(client, forTf('5'));
  const unsubscribe = observer.subscribe(() => {});
  try {
    observer.setOptions(forTf('60'));
    observer.setOptions(forTf('5'));
    assert.equal(requests.length, 3);
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(requests[1].signal.aborted, true);
    assert.equal(requests[2].signal.aborted, false);
    const fresh = bars();
    requests[2].resolve(fresh);
    await new Promise(setImmediate);
    requests[1].resolve(bars(3600));
    requests[0].resolve(bars(300, 1_700_000_000));
    await new Promise(setImmediate);
    assert.deepEqual(observer.getCurrentResult().data, fresh);
    assert.deepEqual(client.getQueryData(['candles', 'BTCUSDT', '5']), fresh);
  } finally {
    unsubscribe();
    client.clear();
  }
});
