# Exchange provider boundary

The current runtime provider is Bybit, but UI/domain code should not grow direct exchange-specific dependencies.

Canonical market identity is `exchange + market + symbol` (for example `bybit:linear:BTCUSDT`).

Future adapters should implement the same conceptual operations:

- market data: tickers, candles, instruments, public websocket
- accounts: equity / balances
- trading: positions, open/history orders, executions, place/cancel, position management
- capabilities: market/limit/stop, reduce-only, hedge mode, TP/SL, trailing stop, private websocket

Bybit-only fields such as `positionIdx` belong inside the provider boundary. Chart, Calculator, Alerts and Journal should consume normalized domain types.

No second exchange is enabled yet; this document and shared exchange types are groundwork only.
