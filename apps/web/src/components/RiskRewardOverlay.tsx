import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { Candle, RiskReward } from '@trade/shared';
import { calculateRiskReward } from '@trade/domain';

type DragKind = 'entry' | 'stop' | 'target' | 'startTime' | 'endTime' | 'move';

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<'Bar'> | null;
  host: HTMLDivElement | null;
  candles: Candle[];
  items: RiskReward[];
  selectedId: number | null;
  onSelect: (r: RiskReward) => void;
  onUpdate: (id: number, p: Partial<RiskReward>) => void;
  onDelete: (id: number) => void;
}

function candleStep(candles: Candle[]) {
  if (candles.length < 2) return 60;
  const diffs: number[] = [];
  for (let i = 1; i < candles.length && diffs.length < 40; i += 1) {
    const d = candles[i]!.time - candles[i - 1]!.time;
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 60;
}

export default function RiskRewardOverlay({
  chart,
  series,
  host,
  candles,
  items,
  selectedId,
  onSelect,
  onUpdate,
  onDelete,
}: Props) {
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<RiskReward | null>(null);
  const draftRef = useRef<RiskReward | null>(null);
  const [drag, setDrag] = useState<{
    kind: DragKind;
    item: RiskReward;
    startClientX: number;
    startClientY: number;
    startPrice: number | null;
    startTime: number | null;
  } | null>(null);

  const step = useMemo(() => candleStep(candles), [candles]);

  const timeToX = (time: number) => {
    if (!chart) return null;
    const direct = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (direct !== null) return direct;
    if (candles.length < 2) return null;

    let logical: number;
    if (time <= candles[0]!.time) {
      logical = (time - candles[0]!.time) / step;
    } else if (time >= candles[candles.length - 1]!.time) {
      logical = candles.length - 1 + (time - candles[candles.length - 1]!.time) / step;
    } else {
      let lo = 0;
      let hi = candles.length - 1;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (candles[mid]!.time <= time) lo = mid;
        else hi = mid;
      }
      const a = candles[lo]!;
      const b = candles[hi]!;
      logical = lo + (time - a.time) / Math.max(1, b.time - a.time);
    }
    return (chart.timeScale() as any).logicalToCoordinate(logical) as number | null;
  };

  const xToTime = (x: number) => {
    if (!chart || candles.length < 2) return null;
    const logical = (chart.timeScale() as any).coordinateToLogical(x) as number | null;
    if (logical === null || !Number.isFinite(logical)) return null;
    const base = Math.floor(logical);
    const fraction = logical - base;

    if (base < 0) return Math.round(candles[0]!.time + logical * step);
    if (base >= candles.length - 1) {
      return Math.round(candles[candles.length - 1]!.time + (logical - (candles.length - 1)) * step);
    }

    const a = candles[base]!;
    const b = candles[base + 1]!;
    return Math.round(a.time + (b.time - a.time) * fraction);
  };

  useEffect(() => {
    if (!chart) return;
    const cb = () => setVersion((v) => v + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(cb);
    chart.timeScale().subscribeVisibleLogicalRangeChange(cb);
    chart.subscribeCrosshairMove(cb);
    const ro = host ? new ResizeObserver(cb) : null;
    if (host) ro?.observe(host);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(cb);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
      chart.unsubscribeCrosshairMove(cb);
      ro?.disconnect();
    };
  }, [chart, host]);

  useEffect(() => {
    if (!drag || !series || !chart || !host) return;
    draftRef.current = { ...(draft || drag.item) };

    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      let next = { ...(draftRef.current || drag.item) };
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      if (drag.kind === 'entry' || drag.kind === 'stop' || drag.kind === 'target') {
        const price = series.coordinateToPrice(y);
        if (price && price > 0) next = { ...next, [drag.kind]: price };
      } else if (drag.kind === 'startTime' || drag.kind === 'endTime') {
        const t = xToTime(x);
        if (typeof t === 'number') {
          if (drag.kind === 'startTime') {
            next.startTime = Math.min(t, next.endTime - Math.max(1, step));
          } else {
            next.endTime = Math.max(t, next.startTime + Math.max(1, step));
          }
        }
      } else {
        const currentPrice = series.coordinateToPrice(y);
        const currentTime = xToTime(x);
        if (currentPrice && drag.startPrice && currentTime && drag.startTime) {
          const priceDelta = currentPrice - drag.startPrice;
          const timeDelta = currentTime - drag.startTime;
          next = {
            ...next,
            entry: drag.item.entry + priceDelta,
            stop: drag.item.stop + priceDelta,
            target: drag.item.target + priceDelta,
            startTime: drag.item.startTime + timeDelta,
            endTime: drag.item.endTime + timeDelta,
          };
        }
      }

      next.direction = next.target >= next.entry ? 'long' : 'short';
      draftRef.current = next;
      setDraft(next);
    };

    const up = () => {
      const current = draftRef.current;
      if (current) {
        onUpdate(current.id, {
          entry: current.entry,
          stop: current.stop,
          target: current.target,
          startTime: current.startTime,
          endTime: current.endTime,
          direction: current.target >= current.entry ? 'long' : 'short',
        });
      }
      setDrag(null);
      setDraft(null);
      draftRef.current = null;
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, series, chart, host, onUpdate, step]);

  const display = useMemo(
    () => items.map((item) => (draft?.id === item.id ? draft : item)),
    [items, draft, version],
  );

  if (!chart || !series || !host) return null;

  const beginDrag = (kind: DragKind, item: RiskReward, event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    onSelect(item);
    const rect = host.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const x = event.clientX - rect.left;
    setDrag({
      kind,
      item,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPrice: series.coordinateToPrice(y),
      startTime: xToTime(x),
    });
  };

  return (
    <svg className="chart-overlay rr-overlay" width={host.clientWidth} height={host.clientHeight}>
      {display.map((r) => {
        const x1 = timeToX(r.startTime);
        const x2 = timeToX(r.endTime);
        const entryY = series.priceToCoordinate(r.entry);
        const stopY = series.priceToCoordinate(r.stop);
        const targetY = series.priceToCoordinate(r.target);
        if (x1 === null || x2 === null || entryY === null || stopY === null || targetY === null) return null;

        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const width = Math.max(34, right - left);
        const rewardTop = Math.min(entryY, targetY);
        const riskTop = Math.min(entryY, stopY);
        const objectTop = Math.min(entryY, stopY, targetY);
        const objectBottom = Math.max(entryY, stopY, targetY);
        const rr = calculateRiskReward(r.entry, r.stop, r.target);
        const selected = selectedId === r.id;

        return (
          <g className={selected ? 'rr-object selected' : 'rr-object'} key={r.id}>
            <rect
              className="rr-reward"
              x={left}
              y={rewardTop}
              width={width}
              height={Math.max(1, Math.abs(targetY - entryY))}
              rx="2"
              onPointerDown={(event) => beginDrag('move', r, event)}
            />
            <rect
              className="rr-risk"
              x={left}
              y={riskTop}
              width={width}
              height={Math.max(1, Math.abs(stopY - entryY))}
              rx="2"
              onPointerDown={(event) => beginDrag('move', r, event)}
            />
            <line className="rr-entry" x1={left} x2={left + width} y1={entryY} y2={entryY} />
            <text x={left + 8} y={objectTop + 15}>
              R:R {rr.ratio.toFixed(2)} · {r.direction.toUpperCase()}
            </text>

            <g className="rr-delete" onPointerDown={(event) => { event.stopPropagation(); onDelete(r.id); }}>
              <circle cx={left + width - 9} cy={objectTop + 10} r="8" />
              <text x={left + width - 9} y={objectTop + 13.5} textAnchor="middle">×</text>
            </g>

            <line className="rr-drag-line" x1={left} x2={left + width} y1={targetY} y2={targetY} onPointerDown={(event) => beginDrag('target', r, event)} />
            <line className="rr-drag-line" x1={left} x2={left + width} y1={entryY} y2={entryY} onPointerDown={(event) => beginDrag('entry', r, event)} />
            <line className="rr-drag-line" x1={left} x2={left + width} y1={stopY} y2={stopY} onPointerDown={(event) => beginDrag('stop', r, event)} />

            {(selected || drag?.item.id === r.id) && (
              <>
                <circle className="rr-handle" cx={left + width} cy={targetY} r="6" onPointerDown={(event) => beginDrag('target', r, event)} />
                <circle className="rr-handle" cx={left + width} cy={entryY} r="6" onPointerDown={(event) => beginDrag('entry', r, event)} />
                <circle className="rr-handle" cx={left + width} cy={stopY} r="6" onPointerDown={(event) => beginDrag('stop', r, event)} />
                <circle className="rr-handle time" cx={left} cy={(objectTop + objectBottom) / 2} r="5" onPointerDown={(event) => beginDrag('startTime', r, event)} />
                <circle className="rr-handle time" cx={left + width} cy={(objectTop + objectBottom) / 2} r="5" onPointerDown={(event) => beginDrag('endTime', r, event)} />
                <circle className="rr-move-handle" cx={left + width / 2} cy={(objectTop + objectBottom) / 2} r="6" onPointerDown={(event) => beginDrag('move', r, event)} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
