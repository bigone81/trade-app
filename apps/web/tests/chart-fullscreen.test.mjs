import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/useChartFullscreen.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText;

// Run the actual hook with browser/React lifecycle stubs, including native
// fullscreen events and rejected requests. No rendering implementation copied.
function harness(native = 'unsupported') {
  const slots = [];
  let cursor = 0;
  let pendingEffects = [];
  const listeners = new Map();
  const emit = (name, event) => [...(listeners.get(name) || [])].forEach((fn) => fn(event));
  const events = {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
  };
  class Element {
    isConnected = true;
    editing = false;
    closest() { return this.editing ? this : null; }
    contains(target) { return target === this; }
    focus() { document.activeElement = this; }
  }
  const trigger = new Element();
  const host = new Element();
  let modal = false;
  let resolveRequest;
  const document = {
    ...events, activeElement: trigger, fullscreenElement: null, body: { style: { overflow: 'auto' } },
    querySelector: () => modal ? {} : null,
    exitFullscreen: async () => { document.fullscreenElement = null; emit('fullscreenchange'); },
  };
  const enterNative = () => { document.fullscreenElement = host; emit('fullscreenchange'); };
  if (native === 'supported') host.requestFullscreen = async () => enterNative();
  if (native === 'denied') host.requestFullscreen = async () => { throw new Error('Denied'); };
  if (native === 'pending') host.requestFullscreen = () => new Promise((resolve) => { resolveRequest = () => { enterNative(); resolve(); }; });
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) {
      const index = cursor++;
      slots[index] ??= { value };
      return [slots[index].value, (next) => { slots[index].value = next; }];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        pendingEffects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require: () => react, document, window: events, Element, HTMLElement: Element, Node: Element });
  const selected = [];
  let options = { symbols: ['BTC', 'ETH', 'SOL'], symbol: 'BTC', blocked: false, onSymbolChange: (symbol) => { selected.push(symbol); options = { ...options, symbol }; } };
  let result;
  const render = (patch = {}) => {
    options = { ...options, ...patch };
    cursor = 0;
    result = exports.useChartFullscreen(options);
    result.hostRef.current = host;
    pendingEffects.splice(0).forEach((fn) => fn());
    return result;
  };
  render();
  return {
    render, document, host, trigger, selected, emit,
    get result() { return result; },
    modal(value) { modal = value; },
    async resolve() { resolveRequest(); await new Promise(setImmediate); },
    key(key, extras = {}) {
      const event = { key, code: key === 'f' ? 'KeyF' : key, target: host, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extras };
      emit('keydown', event);
      render();
      return event;
    },
    editingTarget() { const target = new Element(); target.editing = true; return target; },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test('F opens fallback; arrows use a frozen filtered order and stop at either end', () => {
  const h = harness();
  assert.equal(h.key('ArrowDown').prevented, undefined);
  h.key('f');
  assert.equal(h.result.active, true);
  assert.equal(h.document.body.style.overflow, 'hidden');
  h.render({ symbols: ['SOL', 'BTC', 'NEW', 'ETH'] });
  h.key('ArrowUp');
  assert.equal(h.selected.length, 0);
  h.key('ArrowDown');
  assert.equal(h.selected.at(-1), 'ETH');
  h.key('ArrowDown');
  h.key('ArrowDown');
  assert.deepEqual(h.selected, ['ETH', 'SOL']);
  assert.equal(h.result.index, 2);
  assert.equal(h.result.count, 3);
  h.key('Escape');
  assert.equal(h.result.active, false);
  assert.equal(h.document.body.style.overflow, 'auto');
  assert.equal(h.document.activeElement, h.trigger);
  h.key('f');
  assert.equal(h.result.count, 4, 'next session takes a fresh list');
  h.unmount();
  assert.equal(h.document.body.style.overflow, 'auto');
});

test('editable fields, dialogs, modifiers, held keys and dragging do not navigate', () => {
  const h = harness();
  h.key('f', { target: h.editingTarget() });
  h.key('f', { ctrlKey: true });
  assert.equal(h.result.active, false);
  h.key('а', { code: 'KeyF' });
  assert.equal(h.result.active, true, 'physical F also works in Cyrillic layouts');
  for (const extras of [{ target: h.editingTarget() }, { isComposing: true }, { repeat: true }, { altKey: true }, { defaultPrevented: true }]) h.key('ArrowDown', extras);
  h.modal(true); h.key('ArrowDown'); h.modal(false);
  h.render({ blocked: true }); h.key('ArrowDown'); h.render({ blocked: false });
  h.emit('pointerdown'); h.key('ArrowDown'); h.emit('pointerup');
  assert.equal(h.selected.length, 0);
  h.key('ArrowDown');
  assert.deepEqual(h.selected, ['ETH']);
  h.key('f', { repeat: true });
  assert.equal(h.result.active, true);
  h.key('f');
  assert.equal(h.result.active, false);
  h.unmount();
});

test('native exit updates the layout; denied fullscreen retains a usable fallback', async () => {
  for (const mode of ['supported', 'denied']) {
    const h = harness(mode);
    h.key('f');
    await new Promise(setImmediate);
    assert.equal(h.result.active, true);
    if (mode === 'supported') {
      assert.equal(h.document.fullscreenElement, h.host);
      await h.document.exitFullscreen(); // Browser Esc, outside React.
      h.render();
    } else h.key('Escape');
    assert.equal(h.result.active, false);
    assert.equal(h.document.body.style.overflow, 'auto');
    h.unmount();
  }
});

test('late native entry after leaving or unmounting is exited; empty lists remain usable', async () => {
  for (const unmount of [false, true]) {
    const h = harness('pending');
    h.render({ symbols: [] });
    h.key('f');
    assert.equal(h.result.count, 1);
    h.key('ArrowDown');
    assert.equal(h.selected.length, 0);
    if (unmount) h.unmount(); else h.key('Escape');
    await h.resolve();
    assert.equal(h.document.fullscreenElement, null);
    assert.equal(h.document.body.style.overflow, 'auto');
    if (!unmount) h.unmount();
  }
});
