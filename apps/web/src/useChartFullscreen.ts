import { useEffect, useRef, useState } from 'react';

interface Options {
  symbols: string[];
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  blocked: boolean;
}

export function useChartFullscreen(options: Options) {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(options);
  latest.current = options;
  const [symbols, setSymbols] = useState<string[] | null>(null);
  const session = useRef<string[] | null>(null);
  const nativeActive = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pointerDown = useRef(false);

  const finish = () => {
    session.current = null;
    nativeActive.current = false;
    setSymbols(null);
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
  };

  const exit = () => {
    if (document.fullscreenElement === hostRef.current) {
      // Keep our state in sync with the browser's exit event, including Esc.
      void document.exitFullscreen().catch(() => {});
    } else {
      finish();
    }
  };

  const toggle = () => {
    if (session.current) { exit(); return; }
    if (latest.current.blocked || document.querySelector('.modal-backdrop')) return;
    const host = hostRef.current;
    if (!host) return;
    const current = latest.current;
    const snapshot = [...new Set(current.symbols)];
    if (!snapshot.includes(current.symbol)) snapshot.unshift(current.symbol);
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    session.current = snapshot;
    setSymbols(snapshot);
    host.focus({ preventScroll: true });
    // The fixed layout also works when the browser denies/does not support fullscreen.
    try {
      void host.requestFullscreen?.().then(() => {
        if (!session.current && document.fullscreenElement === host) {
          void document.exitFullscreen().catch(() => {});
        }
      }).catch(() => {});
    } catch { /* Stay in the window-filling layout. */ }
  };

  const step = (direction: -1 | 1) => {
    if (!session.current || latest.current.blocked || pointerDown.current
      || document.querySelector('.modal-backdrop')) return;
    const index = session.current.indexOf(latest.current.symbol);
    const next = session.current[index + direction];
    if (index < 0 || !next) return;
    latest.current = { ...latest.current, symbol: next };
    latest.current.onSymbolChange(next);
  };

  const handlers = useRef({ toggle, exit, step, finish });
  handlers.current = { toggle, exit, step, finish };

  useEffect(() => {
    const fullscreenChange = () => {
      if (document.fullscreenElement === hostRef.current) nativeActive.current = true;
      else if (nativeActive.current) handlers.current.finish();
    };
    const focusIn = (event: FocusEvent) => {
      const host = hostRef.current;
      if (session.current && host && event.target instanceof Node && !host.contains(event.target)) {
        host.focus({ preventScroll: true });
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      const editing = target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
      if (editing || latest.current.blocked || document.querySelector('.modal-backdrop')) return;
      const toggleKey = event.code === 'KeyF'; // Same physical key with RU/UK layouts.
      const exitKey = event.key === 'Escape' && session.current;
      const arrowKey = session.current && (event.key === 'ArrowUp' || event.key === 'ArrowDown');
      if ((!toggleKey && !exitKey && !arrowKey) || pointerDown.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (toggleKey) { if (!event.repeat) handlers.current.toggle(); }
      else if (exitKey) handlers.current.exit();
      else if (!event.repeat) handlers.current.step(event.key === 'ArrowUp' ? -1 : 1);
    };
    const pressed = () => { pointerDown.current = true; };
    const released = () => { pointerDown.current = false; };
    document.addEventListener('fullscreenchange', fullscreenChange);
    document.addEventListener('focusin', focusIn);
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('pointerdown', pressed, true);
    window.addEventListener('pointerup', released, true);
    window.addEventListener('pointercancel', released, true);
    window.addEventListener('blur', released);
    const host = hostRef.current;
    return () => {
      document.removeEventListener('fullscreenchange', fullscreenChange);
      document.removeEventListener('focusin', focusIn);
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('pointerdown', pressed, true);
      window.removeEventListener('pointerup', released, true);
      window.removeEventListener('pointercancel', released, true);
      window.removeEventListener('blur', released);
      session.current = null;
      if (document.fullscreenElement === host) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  const active = symbols !== null;
  useEffect(() => {
    if (!active) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [active]);

  return { hostRef, active, toggle, exit, step, index: symbols?.indexOf(options.symbol) ?? -1, count: symbols?.length ?? 0 };
}
