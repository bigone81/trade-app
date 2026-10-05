import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IChartApi, ISeriesApi, Logical, UTCTimestamp } from 'lightweight-charts';
import type { Candle, RiskReward } from '@trade/shared';
import { calculateRiskReward } from '@trade/domain';
import { useI18n } from '../i18n';
import { candleTimeAtLogical, logicalAtTime, timeframeSeconds } from '../chartTime';

type DragKind = 'entry' | 'stop' | 'target' | 'startTime' | 'endTime' | 'move';

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<'Bar'> | null;
  host: HTMLDivElement | null;
  candles: Candle[];
  timeframe: string;
  items: RiskReward[];
  selectedId: number | null;
  onSelect: (r: RiskReward) => void;
  onUpdate: (id: number, p: Partial<RiskReward>) => void;
  onDelete: (id: number) => void;
}

const directionFromGeometry = (entry: number, stop: number) => stop < entry ? 'long' as const : 'short' as const;
const targetAtRatio = (entry: number, stop: number, ratio: number) => {
  const risk = Math.abs(entry - stop);
  return stop < entry ? entry + risk * ratio : entry - risk * ratio;
};

export default function RiskRewardOverlay({
  chart,
  series,
  host,
  candles,
  timeframe,
  items,
  selectedId,
  onSelect,
  onUpdate,
  onDelete,
}: Props) {
  const { language } = useI18n();
  const [version, setVersion] = useState(0);
  // Presentation mode is local to this browser. Price and time geometry remain
  // in the original RR record and are never changed when switching modes.
  const [displayModes, setDisplayModes] = useState<Record<number, 'box' | 'lines'>>({});
  const readDisplayMode = (id: number): 'box' | 'lines' => {
    if (displayModes[id]) return displayModes[id];
    try { return localStorage.getItem(`edgedesk.rr.display.${id}`) === 'lines' ? 'lines' : 'box'; }
    catch { return 'box'; }
  };
  const updateDisplayMode = (id: number, mode: 'box' | 'lines') => {
    setDisplayModes((current) => ({ ...current, [id]: mode }));
    try { localStorage.setItem(`edgedesk.rr.display.${id}`, mode); } catch { /* Private mode: keep in memory. */ }
  };
  const copy = language === 'uk'
    ? { box: 'Прямокутник', lines: 'Лінії', delete: 'Видалити RR', entry: 'Вхід', stop: 'Стоп', target: 'Тейк', risk: 'Ризик', profit: 'Прибуток' }
    : language === 'ru'
      ? { box: 'Прямоугольник', lines: 'Линии', delete: 'Удалить RR', entry: 'Вход', stop: 'Стоп', target: 'Тейк', risk: 'Риск', profit: 'Прибыль' }
      : { box: 'Rectangle', lines: 'Lines', delete: 'Delete RR', entry: 'Entry', stop: 'Stop', target: 'Target', risk: 'Risk', profit: 'Reward' };
  const [draft, setDraft] = useState<RiskReward | null>(null);
  const draftRef = useRef<RiskReward | null>(null);
  const [drag, setDrag] = useState<{
    kind: DragKind;
    item: RiskReward;
    startPrice: number | null;
    startTime: number | null;
  } | null>(null);

  const step = timeframeSeconds(timeframe);

  const timeToX = (time: number) => {
    if (!chart) return null;
    const direct = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (direct !== null) return direct;
    const logical = logicalAtTime(candles, time, step);
    return logical === null ? null : chart.timeScale().logicalToCoordinate(logical as Logical);
  };

  const xToTime = (x: number) => {
    if (!chart) return null;
    const logical = chart.timeScale().coordinateToLogical(x);
    return logical === null ? null : candleTimeAtLogical(candles, logical, step);
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
    chart.applyOptions({ handleScroll: false, handleScale: false });

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
          if (drag.kind === 'startTime') next.startTime = Math.min(t, next.endTime - 1);
          else next.endTime = Math.max(t, next.startTime + 1);
        }
      } else {
        const currentPrice = series.coordinateToPrice(y);
        const currentTime = xToTime(x);
        if (currentPrice !== null && drag.startPrice !== null && currentTime !== null && drag.startTime !== null) {
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

      next.direction = directionFromGeometry(next.entry, next.stop);
      draftRef.current = next;
      setDraft(next);
    };

    const finish = () => {
      const current = draftRef.current;
      if (current && (current.entry !== drag.item.entry || current.stop !== drag.item.stop || current.target !== drag.item.target || current.startTime !== drag.item.startTime || current.endTime !== drag.item.endTime)) {
        onUpdate(current.id, {
          entry: current.entry,
          stop: current.stop,
          target: current.target,
          startTime: current.startTime,
          endTime: current.endTime,
          direction: directionFromGeometry(current.entry, current.stop),
        });
      }
      chart.applyOptions({ handleScroll: true, handleScale: true });
      setDrag(null);
      setDraft(null);
      draftRef.current = null;
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      chart.applyOptions({ handleScroll: true, handleScale: true });
    };
  }, [drag, series, chart, host, onUpdate, step, candles]);

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
      startPrice: series.coordinateToPrice(y),
      startTime: xToTime(x),
    });
  };

  const setRatio = (item: RiskReward, ratio: number) => {
    onSelect(item);
    onUpdate(item.id, {
      target: targetAtRatio(item.entry, item.stop, ratio),
      direction: directionFromGeometry(item.entry, item.stop),
    });
  };

  const selectedItem = selectedId === null ? null : display.find((item) => item.id === selectedId) ?? null;
  const selectedRR = selectedItem ? calculateRiskReward(selectedItem.entry, selectedItem.stop, selectedItem.target) : null;
  const selectedDirection = selectedItem ? (directionFromGeometry(selectedItem.entry, selectedItem.stop) === 'long' ? 1 : -1) : 1;
  const selectedProfitPercent = selectedItem && selectedItem.entry > 0
    ? (selectedItem.target - selectedItem.entry) * selectedDirection / selectedItem.entry * 100 : 0;
  const selectedRiskPercent = selectedItem && selectedItem.entry > 0
    ? (selectedItem.stop - selectedItem.entry) * selectedDirection / selectedItem.entry * 100 : 0;
  const percentage = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

  return (
    <>
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
          const width = right - left;
          const rewardTop = Math.min(entryY, targetY);
          const riskTop = Math.min(entryY, stopY);
          const rewardHeight = Math.abs(targetY - entryY);
          const riskHeight = Math.abs(stopY - entryY);
          const objectTop = Math.min(entryY, stopY, targetY);
          const objectBottom = Math.max(entryY, stopY, targetY);
          const rr = calculateRiskReward(r.entry, r.stop, r.target);
          const selected = selectedId === r.id;
          const compact = readDisplayMode(r.id) === 'lines';
          const direction = directionFromGeometry(r.entry, r.stop) === 'long' ? 1 : -1;
          const targetPct = r.entry > 0 ? ((r.target - r.entry) * direction / r.entry) * 100 : 0;
          const stopPct = r.entry > 0 ? ((r.stop - r.entry) * direction / r.entry) * 100 : 0;
          const metricX = Math.min(left + Math.max(4, width - 117), host.clientWidth - 115);
          const metricWidth = 112;
          const showMetrics = width >= 125;
          const rewardBadgeY = rewardTop + (rewardHeight - 35) / 2;
          const riskBadgeY = riskTop + (riskHeight - 35) / 2;
          const compactBadgeX = Math.max(4, Math.min(host.clientWidth - 89, left + width - 90));

          return (
            <g className={selected ? 'rr-object selected' : 'rr-object'} key={r.id} onPointerDown={() => onSelect(r)}>
              {!compact && (
                <>
                  <rect className="rr-reward rr-reward-modern" x={left} y={rewardTop} width={width} height={Math.max(1, rewardHeight)} rx="2" onPointerDown={(event) => beginDrag('move', r, event)} />
                  <rect className="rr-risk rr-risk-modern" x={left} y={riskTop} width={width} height={Math.max(1, riskHeight)} rx="2" onPointerDown={(event) => beginDrag('move', r, event)} />
                  {showMetrics && rewardHeight >= 40 && (
                    <g className="rr-metric rr-metric-profit" transform={`translate(${metricX}, ${rewardBadgeY})`}>
                      <rect width={metricWidth} height="35" rx="5" />
                      <text x={metricWidth / 2} y="14" textAnchor="middle">TP {percentage(targetPct)}</text>
                      <text x={metricWidth / 2} y="28" textAnchor="middle">{rr.ratio.toFixed(2)}R</text>
                    </g>
                  )}
                  {showMetrics && riskHeight >= 40 && (
                    <g className="rr-metric rr-metric-loss" transform={`translate(${metricX}, ${riskBadgeY})`}>
                      <rect width={metricWidth} height="35" rx="5" />
                      <text x={metricWidth / 2} y="14" textAnchor="middle">SL {percentage(stopPct)}</text>
                      <text x={metricWidth / 2} y="28" textAnchor="middle">1.00R</text>
                    </g>
                  )}
                </>
              )}

              <line className={compact ? 'rr-price-line rr-price-target' : 'rr-price-line rr-price-target subtle'} x1={left} x2={left + width} y1={targetY} y2={targetY} />
              <line className={compact ? 'rr-price-line rr-price-entry' : 'rr-price-line rr-price-entry subtle'} x1={left} x2={left + width} y1={entryY} y2={entryY} />
              <line className={compact ? 'rr-price-line rr-price-stop' : 'rr-price-line rr-price-stop subtle'} x1={left} x2={left + width} y1={stopY} y2={stopY} />
              {compact && (
                <g className="rr-compact-badge" transform={`translate(${compactBadgeX}, ${Math.max(4, objectTop - 24)})`}>
                  <rect width="86" height="20" rx="5" />
                  <text x="43" y="14" textAnchor="middle">{rr.ratio.toFixed(2)}R · {direction > 0 ? 'LONG' : 'SHORT'}</text>
                </g>
              )}

              {/* Wide transparent hit targets retain the existing independent Entry/SL/TP drag. */}
              <line className="rr-drag-line" x1={left} x2={left + width} y1={targetY} y2={targetY} onPointerDown={(event) => beginDrag('target', r, event)} />
              <line className="rr-drag-line" x1={left} x2={left + width} y1={entryY} y2={entryY} onPointerDown={(event) => beginDrag('entry', r, event)} />
              <line className="rr-drag-line" x1={left} x2={left + width} y1={stopY} y2={stopY} onPointerDown={(event) => beginDrag('stop', r, event)} />

              <g className="rr-interaction-handles">
                <circle className="rr-handle rr-handle-target" cx={left + width} cy={targetY} r="7" onPointerDown={(event) => beginDrag('target', r, event)} />
                <circle className="rr-handle rr-handle-entry" cx={left + width} cy={entryY} r="7" onPointerDown={(event) => beginDrag('entry', r, event)} />
                <circle className="rr-handle rr-handle-stop" cx={left + width} cy={stopY} r="7" onPointerDown={(event) => beginDrag('stop', r, event)} />
                <circle className="rr-handle time" cx={left} cy={(objectTop + objectBottom) / 2} r="6" onPointerDown={(event) => beginDrag('startTime', r, event)} />
                <circle className="rr-handle time" cx={left + width} cy={(objectTop + objectBottom) / 2} r="6" onPointerDown={(event) => beginDrag('endTime', r, event)} />
                <circle className="rr-move-handle" cx={left + width / 2} cy={(objectTop + objectBottom) / 2} r="7" onPointerDown={(event) => beginDrag('move', r, event)} />
              </g>
            </g>
          );
        })}
      </svg>
      {selectedItem && selectedRR && (
        <div className="rr-control-panel" onPointerDown={(event) => event.stopPropagation()}>
          <div className="rr-panel-summary">
            <strong>{selectedDirection > 0 ? 'LONG' : 'SHORT'} · {selectedRR.ratio.toFixed(2)}R</strong>
            <span className="rr-panel-profit">TP {percentage(selectedProfitPercent)}</span>
            <span className="rr-panel-loss">SL {percentage(selectedRiskPercent)}</span>
          </div>
          <div className="rr-panel-actions">
            {[1, 2, 3, 4].map((ratio) => (
              <button type="button" key={ratio} className={`rr-panel-btn ${Math.abs(selectedRR.ratio - ratio) < 0.005 ? 'active' : ''}`} onClick={() => setRatio(selectedItem, ratio)}>{ratio}R</button>
            ))}
            <span className="rr-panel-separator" />
            <button type="button" className={`rr-panel-btn ${readDisplayMode(selectedItem.id) === 'box' ? 'active' : ''}`} onClick={() => updateDisplayMode(selectedItem.id, 'box')}>{copy.box}</button>
            <button type="button" className={`rr-panel-btn ${readDisplayMode(selectedItem.id) === 'lines' ? 'active' : ''}`} onClick={() => updateDisplayMode(selectedItem.id, 'lines')}>{copy.lines}</button>
            <button type="button" className="rr-panel-btn danger" onClick={() => onDelete(selectedItem.id)} title={copy.delete} aria-label={copy.delete}>×</button>
          </div>
        </div>
      )}
    </>
  );
}
