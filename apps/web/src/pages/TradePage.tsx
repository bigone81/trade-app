import { useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  AlertTriangle,
  RefreshCw,
  X,
} from 'lucide-react';

import type {
  AccountPublic,
  TradeExecution,
  TradeOrder,
  TradePosition,
} from '@trade/shared';

import {
  api,
  json,
  money,
  num,
} from '../api';

import ConfirmDialog from '../components/ConfirmDialog';

type Tab =
  | 'positions'
  | 'orders'
  | 'executions'
  | 'history';

type Action =
  | {
      kind: 'cancel';
      order: TradeOrder;
    }
  | {
      kind: 'cancelAll';
      accountId: number;
      accountName: string;
      symbol: string;
    }
  | {
      kind: 'close';
      position: TradePosition;
      percent: number;
    }
  | {
      kind: 'flatten';
      position: TradePosition;
    }
  | null;

export default function TradePage() {
  const qc = useQueryClient();

  const [account, setAccount] = useState(0);
  const [symbol, setSymbol] = useState('');
  const [tab, setTab] = useState<Tab>('positions');

  const [action, setAction] = useState<Action>(null);

  const [selected, setSelected] =
    useState<TradePosition | null>(null);

  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [trailing, setTrailing] = useState('');

  const config = useQuery<{
    accounts: AccountPublic[];
    liveTradingEnabled: boolean;
  }>({
    queryKey: ['config'],
    queryFn: () => api('/api/config'),
  });

  const suffix = account
    ? `?accountId=${account}`
    : '';

  const summary = useQuery<any[]>({
    queryKey: ['trade-summary', account],
    queryFn: () =>
      api(`/api/trade/summary${suffix}`),
    refetchInterval: 10000,
  });

  const positions = useQuery<TradePosition[]>({
    queryKey: ['positions', account],
    queryFn: () =>
      api(`/api/trade/positions${suffix}`),
    refetchInterval: 7000,
  });

  const orders = useQuery<TradeOrder[]>({
    queryKey: ['orders', account],
    queryFn: () =>
      api(`/api/trade/orders${suffix}`),
    refetchInterval: 7000,
  });

  const executions = useQuery<TradeExecution[]>({
    queryKey: ['executions', account],
    queryFn: () =>
      api(`/api/trade/executions${suffix}`),
    refetchInterval: 12000,
  });

  const history = useQuery<TradeOrder[]>({
    queryKey: ['trade-history', account],
    queryFn: () =>
      api(`/api/trade/history${suffix}`),
    refetchInterval: 30000,
  });

  const refresh = () => {
    void qc
      .invalidateQueries({
        queryKey: ['trade-summary'],
      })
      .then(() =>
        qc.invalidateQueries({
          queryKey: ['positions'],
        }),
      )
      .then(() =>
        qc.invalidateQueries({
          queryKey: ['orders'],
        }),
      );
  };

  const run = useMutation({
    mutationFn: async (
      a: NonNullable<Action>,
    ) => {
      if (a.kind === 'cancel') {
        return api(
          '/api/trade/orders/cancel',
          json('POST', {
            accountId: a.order.accountId,
            symbol: a.order.symbol,
            orderId: a.order.orderId,
          }),
        );
      }

      if (a.kind === 'cancelAll') {
        return api(
          '/api/trade/orders/cancel-all',
          json('POST', {
            accountId: a.accountId,
            symbol: a.symbol,
          }),
        );
      }

      if (a.kind === 'close') {
        return api(
          '/api/trade/position/close',
          json('POST', {
            accountId:
              a.position.accountId,
            symbol: a.position.symbol,
            percent: a.percent,
            positionIdx:
              a.position.positionIdx,
          }),
        );
      }

      return api(
        '/api/trade/position/flatten',
        json('POST', {
          accountId:
            a.position.accountId,
          symbol: a.position.symbol,
          positionIdx:
            a.position.positionIdx,
        }),
      );
    },

    onSettled: () => {
      setAction(null);

      setTimeout(
        refresh,
        700,
      );
    },
  });

  const updateStops = useMutation({
    mutationFn: (
      override: {
        stopLoss?: number;
        takeProfit?: number;
        trailingStop?: number;
      } = {},
    ) => {
      if (!selected) {
        return Promise.resolve();
      }

      return api(
        '/api/trade/position/stops',
        json('POST', {
          accountId: selected.accountId,
          symbol: selected.symbol,
          positionIdx:
            selected.positionIdx,

          stopLoss:
            override.stopLoss ??
            (Number(sl) || 0),

          takeProfit:
            override.takeProfit ??
            (Number(tp) || 0),

          trailingStop:
            override.trailingStop ??
            (Number(trailing) || 0),
        }),
      );
    },

    onSuccess: () => {
      setTimeout(
        refresh,
        700,
      );
    },
  });

  const filter = <
    T extends {
      symbol: string;
    },
  >(
    rows: T[] | undefined,
  ) => {
    return (
      rows?.filter(
        (row) =>
          !symbol ||
          row.symbol.includes(
            symbol.toUpperCase(),
          ),
      ) ?? []
    );
  };

  const live =
    config.data
      ?.liveTradingEnabled ?? false;

  const tabs: [
    Tab,
    string,
    number,
  ][] = [
    [
      'positions',
      'Positions',
      positions.data?.length ?? 0,
    ],
    [
      'orders',
      'Orders',
      orders.data?.length ?? 0,
    ],
    [
      'executions',
      'Executions',
      executions.data?.length ?? 0,
    ],
    [
      'history',
      'History',
      history.data?.length ?? 0,
    ],
  ];

  const actionBody =
    useMemo(() => {
      if (!action) {
        return null;
      }

      if (action.kind === 'cancel') {
        return (
          <>
            Cancel{' '}
            <b>
              {action.order.symbol}
            </b>{' '}
            order{' '}
            <b>
              {action.order.orderId}
            </b>
            ?
          </>
        );
      }

      if (
        action.kind === 'cancelAll'
      ) {
        return (
          <>
            Cancel{' '}
            <b>
              all {action.symbol}
            </b>{' '}
            orders on{' '}
            <b>
              {action.accountName}
            </b>
            ?
          </>
        );
      }

      if (action.kind === 'close') {
        return (
          <>
            Close{' '}
            <b>
              {action.percent}%
            </b>{' '}
            of{' '}
            <b>
              {
                action.position
                  .symbol
              }{' '}
              {
                action.position
                  .side
              }
            </b>{' '}
            at Market with
            reduce-only?
          </>
        );
      }

      return (
        <>
          Cancel all{' '}
          <b>
            {
              action.position
                .symbol
            }
          </b>{' '}
          orders and close the
          entire{' '}
          <b>
            {
              action.position
                .side
            }
          </b>{' '}
          position at Market?
        </>
      );
    }, [action]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Trade Control
          </h1>

          <p>
            Real-time positions,
            orders and fills
            across Bybit
            accounts
          </p>
        </div>

        <div className="top-controls">
          <select
            className="select"
            value={account}
            onChange={(event) =>
              setAccount(
                Number(
                  event.target
                    .value,
                ),
              )
            }
          >
            <option value={0}>
              All accounts
            </option>

            {config.data?.accounts.map(
              (item) => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.name}
                  {item.demo
                    ? ' · demo'
                    : ''}
                </option>
              ),
            )}
          </select>

          <input
            className="input"
            placeholder="Symbol filter"
            value={symbol}
            onChange={(event) =>
              setSymbol(
                event.target.value.toUpperCase(),
              )
            }
          />

          <button
            className="btn secondary"
            onClick={refresh}
          >
            <RefreshCw
              size={14}
            />
            Refresh
          </button>

          {!live && (
            <span className="badge demo">
              actions locked
            </span>
          )}
        </div>
      </div>

      <div className="account-cards">
        {summary.data?.map(
          (item) => (
            <div
              className={
                account ===
                item.accountId
                  ? 'account-card card active'
                  : 'account-card card'
              }
              key={
                item.accountId
              }
              onClick={() =>
                setAccount(
                  account ===
                    item.accountId
                    ? 0
                    : item.accountId,
                )
              }
            >
              <h3>
                {item.accountName ||
                  `Account ${item.accountId}`}{' '}

                {item.online ? (
                  <span className="badge live">
                    online
                  </span>
                ) : (
                  <span className="badge">
                    offline
                  </span>
                )}
              </h3>

              <div className="account-stat">
                <span>
                  Equity
                </span>

                <b>
                  {item.online
                    ? money(
                        item.equity,
                      )
                    : '—'}
                </b>
              </div>

              <div className="account-stat">
                <span>
                  Unrealized
                </span>

                <b
                  className={
                    item.unrealisedPnl >=
                    0
                      ? 'positive'
                      : 'negative'
                  }
                >
                  {item.online
                    ? money(
                        item.unrealisedPnl,
                      )
                    : '—'}
                </b>
              </div>

              <div className="account-stat">
                <span>
                  Positions /
                  Orders
                </span>

                <b>
                  {item.online
                    ? `${item.positions} / ${item.orders}`
                    : '—'}
                </b>
              </div>
            </div>
          ),
        )}
      </div>

      <div className="tabs">
        {tabs.map(
          ([
            id,
            label,
            count,
          ]) => (
            <button
              key={id}
              className={
                tab === id
                  ? 'tab active'
                  : 'tab'
              }
              onClick={() =>
                setTab(id)
              }
            >
              {label} {count}
            </button>
          ),
        )}
      </div>

      <div className="card table-card">
        {tab === 'positions' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  Account
                </th>
                <th>
                  Symbol
                </th>
                <th>
                  Side
                </th>
                <th>
                  Size
                </th>
                <th>
                  Entry
                </th>
                <th>
                  Mark
                </th>
                <th>
                  uPnL
                </th>
                <th>
                  SL
                </th>
                <th>
                  TP
                </th>
                <th>
                  Liq
                </th>
                <th>
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {filter(
                positions.data,
              ).map((position) => (
                <tr
                  key={`${position.accountId}-${position.symbol}-${position.positionIdx}`}
                  onClick={() => {
                    setSelected(
                      position,
                    );

                    setSl(
                      String(
                        position.stopLoss ||
                          '',
                      ),
                    );

                    setTp(
                      String(
                        position.takeProfit ||
                          '',
                      ),
                    );

                    setTrailing(
                      String(
                        position.trailingStop ||
                          '',
                      ),
                    );
                  }}
                >
                  <td>
                    {
                      position.accountName
                    }
                  </td>

                  <td>
                    <b>
                      {
                        position.symbol
                      }
                    </b>
                  </td>

                  <td
                    className={
                      position.side ===
                      'Buy'
                        ? 'positive'
                        : 'negative'
                    }
                  >
                    {
                      position.side
                    }
                  </td>

                  <td>
                    {num(
                      position.size,
                      6,
                    )}
                  </td>

                  <td>
                    {num(
                      position.avgPrice,
                      6,
                    )}
                  </td>

                  <td>
                    {num(
                      position.markPrice,
                      6,
                    )}
                  </td>

                  <td
                    className={
                      position.unrealisedPnl >=
                      0
                        ? 'positive'
                        : 'negative'
                    }
                  >
                    {money(
                      position.unrealisedPnl,
                    )}
                  </td>

                  <td>
                    {position.stopLoss
                      ? num(
                          position.stopLoss,
                          6,
                        )
                      : '—'}
                  </td>

                  <td>
                    {position.takeProfit
                      ? num(
                          position.takeProfit,
                          6,
                        )
                      : '—'}
                  </td>

                  <td>
                    {position.liqPrice
                      ? num(
                          position.liqPrice,
                          6,
                        )
                      : '—'}
                  </td>

                  <td>
                    <div
                      className="row-actions"
                      onClick={(
                        event,
                      ) =>
                        event.stopPropagation()
                      }
                    >
                      <button
                        className="mini-btn"
                        disabled={
                          !live
                        }
                        onClick={() =>
                          setAction(
                            {
                              kind: 'close',
                              position,
                              percent: 25,
                            },
                          )
                        }
                      >
                        25%
                      </button>

                      <button
                        className="mini-btn"
                        disabled={
                          !live
                        }
                        onClick={() =>
                          setAction(
                            {
                              kind: 'close',
                              position,
                              percent: 50,
                            },
                          )
                        }
                      >
                        50%
                      </button>

                      <button
                        className="mini-btn danger"
                        disabled={
                          !live
                        }
                        onClick={() =>
                          setAction(
                            {
                              kind: 'close',
                              position,
                              percent: 100,
                            },
                          )
                        }
                      >
                        Close
                      </button>

                      <button
                        className="mini-btn danger"
                        disabled={
                          !live
                        }
                        onClick={() =>
                          setAction(
                            {
                              kind: 'flatten',
                              position,
                            },
                          )
                        }
                      >
                        Flatten
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'orders' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  Account
                </th>
                <th>
                  Symbol
                </th>
                <th>
                  Side
                </th>
                <th>
                  Type
                </th>
                <th>
                  Status
                </th>
                <th>
                  Price
                </th>
                <th>
                  Qty
                </th>
                <th>
                  Filled
                </th>
                <th>
                  Trigger
                </th>
                <th>
                  SL
                </th>
                <th>
                  TP
                </th>
                <th />
              </tr>
            </thead>

            <tbody>
              {filter(
                orders.data,
              ).map((order) => (
                <tr
                  key={`${order.accountId}-${order.orderId}`}
                >
                  <td>
                    {
                      order.accountName
                    }
                  </td>

                  <td>
                    <b>
                      {
                        order.symbol
                      }
                    </b>
                  </td>

                  <td
                    className={
                      order.side ===
                      'Buy'
                        ? 'positive'
                        : 'negative'
                    }
                  >
                    {order.side}
                  </td>

                  <td>
                    {
                      order.orderType
                    }
                  </td>

                  <td>
                    {
                      order.orderStatus
                    }
                  </td>

                  <td>
                    {num(
                      order.price,
                      6,
                    )}
                  </td>

                  <td>
                    {num(
                      order.qty,
                      6,
                    )}
                  </td>

                  <td>
                    {num(
                      order.cumExecQty,
                      6,
                    )}
                  </td>

                  <td>
                    {order.triggerPrice
                      ? num(
                          order.triggerPrice,
                          6,
                        )
                      : '—'}
                  </td>

                  <td>
                    {order.stopLoss
                      ? num(
                          order.stopLoss,
                          6,
                        )
                      : '—'}
                  </td>

                  <td>
                    {order.takeProfit
                      ? num(
                          order.takeProfit,
                          6,
                        )
                      : '—'}
                  </td>

                  <td>
                    <div className="row-actions">
                      <button
                        className="mini-btn danger"
                        disabled={
                          !live
                        }
                        onClick={() =>
                          setAction(
                            {
                              kind: 'cancel',
                              order,
                            },
                          )
                        }
                      >
                        Cancel
                      </button>

                      <button
                        className="mini-btn"
                        disabled={
                          !live
                        }
                        onClick={() =>
                          setAction(
                            {
                              kind: 'cancelAll',
                              accountId:
                                order.accountId,
                              accountName:
                                order.accountName,
                              symbol:
                                order.symbol,
                            },
                          )
                        }
                      >
                        Cancel all
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'executions' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  Account
                </th>
                <th>
                  Time
                </th>
                <th>
                  Symbol
                </th>
                <th>
                  Side
                </th>
                <th>
                  Price
                </th>
                <th>
                  Qty
                </th>
                <th>
                  Fee
                </th>
                <th>
                  Order ID
                </th>
              </tr>
            </thead>

            <tbody>
              {filter(
                executions.data,
              ).map((execution) => (
                <tr
                  key={`${execution.accountId}-${execution.execId}`}
                >
                  <td>
                    {
                      execution.accountName
                    }
                  </td>

                  <td>
                    {new Date(
                      execution.execTime,
                    ).toLocaleString()}
                  </td>

                  <td>
                    <b>
                      {
                        execution.symbol
                      }
                    </b>
                  </td>

                  <td>
                    {
                      execution.side
                    }
                  </td>

                  <td>
                    {num(
                      execution.execPrice,
                      6,
                    )}
                  </td>

                  <td>
                    {num(
                      execution.execQty,
                      6,
                    )}
                  </td>

                  <td>
                    {num(
                      execution.execFee,
                      6,
                    )}
                  </td>

                  <td>
                    {
                      execution.orderId
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'history' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  Account
                </th>
                <th>
                  Time
                </th>
                <th>
                  Symbol
                </th>
                <th>
                  Side
                </th>
                <th>
                  Type
                </th>
                <th>
                  Status
                </th>
                <th>
                  Avg / Price
                </th>
                <th>
                  Qty
                </th>
                <th>
                  Filled
                </th>
              </tr>
            </thead>

            <tbody>
              {filter(
                history.data,
              ).map((order) => (
                <tr
                  key={`${order.accountId}-${order.orderId}`}
                >
                  <td>
                    {
                      order.accountName
                    }
                  </td>

                  <td>
                    {new Date(
                      order.updatedTime,
                    ).toLocaleString()}
                  </td>

                  <td>
                    <b>
                      {
                        order.symbol
                      }
                    </b>
                  </td>

                  <td>
                    {
                      order.side
                    }
                  </td>

                  <td>
                    {
                      order.orderType
                    }
                  </td>

                  <td>
                    {
                      order.orderStatus
                    }
                  </td>

                  <td>
                    {num(
                      order.price,
                      6,
                    )}
                  </td>

                  <td>
                    {num(
                      order.qty,
                      6,
                    )}
                  </td>

                  <td>
                    {num(
                      order.cumExecQty,
                      6,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {((tab ===
          'positions' &&
          !filter(
            positions.data,
          ).length) ||
          (tab ===
            'orders' &&
            !filter(
              orders.data,
            ).length) ||
          (tab ===
            'executions' &&
            !filter(
              executions.data,
            ).length) ||
          (tab ===
            'history' &&
            !filter(
              history.data,
            ).length)) && (
          <div className="empty">
            No data for the
            selected filters.
          </div>
        )}
      </div>

      {selected && (
        <aside
          className="drawer"
          style={{
            position: 'fixed',
            right: 14,
            top: 14,
            bottom: 14,
            zIndex: 60,
            maxHeight: 'none',
          }}
        >
          <div className="drawer-head">
            <div>
              <h2>
                {selected.symbol}{' '}
                {selected.side}
              </h2>

              <div className="muted">
                {
                  selected.accountName
                }{' '}
                · size{' '}
                {num(
                  selected.size,
                  6,
                )}
              </div>
            </div>

            <button
              className="icon-btn"
              onClick={() =>
                setSelected(null)
              }
            >
              <X size={16} />
            </button>
          </div>

          <div className="metric-grid">
            <div className="metric">
              <small>
                Entry
              </small>

              <strong>
                {num(
                  selected.avgPrice,
                  6,
                )}
              </strong>
            </div>

            <div className="metric">
              <small>
                Mark
              </small>

              <strong>
                {num(
                  selected.markPrice,
                  6,
                )}
              </strong>
            </div>

            <div className="metric">
              <small>
                uPnL
              </small>

              <strong
                className={
                  selected.unrealisedPnl >=
                  0
                    ? 'positive'
                    : 'negative'
                }
              >
                {money(
                  selected.unrealisedPnl,
                )}
              </strong>
            </div>

            <div className="metric">
              <small>
                Liquidation
              </small>

              <strong>
                {selected.liqPrice
                  ? num(
                      selected.liqPrice,
                      6,
                    )
                  : '—'}
              </strong>
            </div>
          </div>

          <div className="drawer-section">
            <div className="field">
              <label>
                Stop Loss
              </label>

              <input
                className="input"
                type="number"
                step="any"
                value={sl}
                onChange={(
                  event,
                ) =>
                  setSl(
                    event.target
                      .value,
                  )
                }
              />
            </div>

            <div className="field">
              <label>
                Take Profit
              </label>

              <input
                className="input"
                type="number"
                step="any"
                value={tp}
                onChange={(
                  event,
                ) =>
                  setTp(
                    event.target
                      .value,
                  )
                }
              />
            </div>

            <div className="field">
              <label>
                Trailing Stop
                distance
              </label>

              <input
                className="input"
                type="number"
                step="any"
                value={trailing}
                onChange={(
                  event,
                ) =>
                  setTrailing(
                    event.target
                      .value,
                  )
                }
              />
            </div>

            <div className="drawer-actions">
              <button
                className="btn secondary"
                disabled={
                  !live ||
                  updateStops.isPending
                }
                onClick={() =>
                  updateStops.mutate(
                    {},
                  )
                }
              >
                Update SL / TP /
                Trail
              </button>

              <button
                className="btn secondary"
                disabled={
                  !live ||
                  updateStops.isPending
                }
                onClick={() =>
                  updateStops.mutate(
                    {
                      stopLoss:
                        selected.avgPrice,
                    },
                  )
                }
              >
                Move SL to
                breakeven
              </button>

              <button
                className="btn ghost"
                onClick={() => {
                  location.href =
                    `/?symbol=${encodeURIComponent(
                      selected.symbol,
                    )}`;
                }}
              >
                Open on chart
              </button>
            </div>
          </div>

          <div className="drawer-section">
            <h3
              style={{
                fontSize: 12,
              }}
            >
              <AlertTriangle
                size={14}
              />
              Emergency
            </h3>

            <div className="drawer-actions">
              <button
                className="btn warning"
                disabled={!live}
                onClick={() =>
                  setAction({
                    kind: 'close',
                    position:
                      selected,
                    percent: 50,
                  })
                }
              >
                Close 50%
              </button>

              <button
                className="btn danger"
                disabled={!live}
                onClick={() =>
                  setAction({
                    kind: 'close',
                    position:
                      selected,
                    percent: 100,
                  })
                }
              >
                Force close 100%
              </button>

              <button
                className="btn danger"
                disabled={!live}
                onClick={() =>
                  setAction({
                    kind: 'flatten',
                    position:
                      selected,
                  })
                }
              >
                Flatten symbol
              </button>
            </div>
          </div>
        </aside>
      )}

      <ConfirmDialog
        open={Boolean(action)}
        title={
          action?.kind ===
          'flatten'
            ? 'Emergency flatten'
            : action?.kind ===
                'close'
              ? 'Close position'
              : action?.kind ===
                  'cancelAll'
                ? 'Cancel all orders'
                : 'Cancel order'
        }
        body={actionBody}
        danger
        onClose={() =>
          setAction(null)
        }
        onConfirm={() => {
          if (action) {
            run.mutate(action);
          }
        }}
        confirmLabel={
          action?.kind ===
          'flatten'
            ? 'FLATTEN NOW'
            : action?.kind ===
                'close'
              ? 'Close position'
              : action?.kind ===
                  'cancelAll'
                ? 'Cancel all'
                : 'Cancel order'
        }
      />
    </div>
  );
}