import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';
import type { RiskReward } from '@trade/shared';
import { calculateRiskReward } from '@trade/domain';

type DragKind = 'entry' | 'stop' | 'target' | 'startTime' | 'endTime';

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<'Bar'> | null;
  host: HTMLDivElement | null;
  items: RiskReward[];
  selectedId: number | null;
  onSelect: (r: RiskReward) => void;
  onUpdate: (id: number, p: Partial<RiskReward>) => void;
  onDelete: (id: number) => void;
}

export default function RiskRewardOverlay({
  chart,
  series,
  host,
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
  } | null>(null);

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

      if (
        drag.kind === 'entry' ||
        drag.kind === 'stop' ||
        drag.kind === 'target'
      ) {
        const price = series.coordinateToPrice(event.clientY - rect.top);
        if (price && price > 0) next = { ...next, [drag.kind]: price };
      } else {
        const time = chart
          .timeScale()
          .coordinateToTime(event.clientX - rect.left);
        if (typeof time === 'number') next = { ...next, [drag.kind]: time };
      }

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
  }, [drag, series, chart, host, onUpdate]);

  const display = useMemo(
    () => items.map((item) => (draft?.id === item.id ? draft : item)),
    [items, draft, version],
  );

  if (!chart || !series || !host) return null;

  return (
    <svg
      className="chart-overlay"
      width={host.clientWidth}
      height={host.clientHeight}
    >
      {display.map((r) => {
        const x1 = chart.timeScale().timeToCoordinate(r.startTime as UTCTimestamp);
        const x2 = chart.timeScale().timeToCoordinate(r.endTime as UTCTimestamp);
        const entryY = series.priceToCoordinate(r.entry);
        const stopY = series.priceToCoordinate(r.stop);
        const targetY = series.priceToCoordinate(r.target);

        if (
          x1 === null ||
          x2 === null ||
          entryY === null ||
          stopY === null ||
          targetY === null
        ) {
          return null;
        }

        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const width = Math.max(34, right - left);
        const rewardTop = Math.min(entryY, targetY);
        const riskTop = Math.min(entryY, stopY);
        const objectTop = Math.min(entryY, stopY, targetY);
        const rr = calculateRiskReward(r.entry, r.stop, r.target);
        const selected = selectedId === r.id;

        return (
          <g
            className="rr-object"
            key={r.id}
            onPointerDown={() => onSelect(r)}
          >
            <rect
              className="rr-reward"
              x={left}
              y={rewardTop}
              width={width}
              height={Math.max(1, Math.abs(targetY - entryY))}
              rx="2"
            />
            <rect
              className="rr-risk"
              x={left}
              y={riskTop}
              width={width}
              height={Math.max(1, Math.abs(stopY - entryY))}
              rx="2"
            />
            <line
              className="rr-entry"
              x1={left}
              x2={left + width}
              y1={entryY}
              y2={entryY}
            />
            <text x={left + 8} y={rewardTop + 15}>
              R:R {rr.ratio.toFixed(2)} · {r.direction.toUpperCase()}
            </text>

            <g
              className="rr-delete"
              onPointerDown={(event) => {
                event.stopPropagation();
                onDelete(r.id);
              }}
            >
              <circle cx={left + width - 9} cy={objectTop + 10} r="8" />
              <text x={left + width - 9} y={objectTop + 13.5} textAnchor="middle">×</text>
            </g>

            {selected && (
              <>
                <circle
                  className="rr-handle"
                  cx={left + width}
                  cy={targetY}
                  r="6"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setDrag({ kind: 'target', item: r });
                  }}
                />
                <circle
                  className="rr-handle"
                  cx={left + width}
                  cy={entryY}
                  r="6"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setDrag({ kind: 'entry', item: r });
                  }}
                />
                <circle
                  className="rr-handle"
                  cx={left + width}
                  cy={stopY}
                  r="6"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setDrag({ kind: 'stop', item: r });
                  }}
                />
                <circle
                  className="rr-handle time"
                  cx={left}
                  cy={entryY}
                  r="5"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setDrag({ kind: 'startTime', item: r });
                  }}
                />
                <circle
                  className="rr-handle time"
                  cx={left + width}
                  cy={entryY}
                  r="5"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setDrag({ kind: 'endTime', item: r });
                  }}
                />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
