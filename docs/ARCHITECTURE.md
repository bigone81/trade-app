# Architecture

## Containers

### app
Fastify provides the REST API and serves the Vite React build. It owns synchronous request/response operations, public market REST calls, persistent drawings, the journal and user-confirmed Bybit write operations.

### worker
Maintains Bybit WebSocket connections and evaluates price alerts independently of the browser. It also records private order/execution/position/wallet events and sends Telegram notifications.

Both containers share `/data/trade.sqlite` and `/data/charts` through one Docker volume. SQLite is configured for WAL mode and a busy timeout.

## Safety boundary

- Bybit keys and Telegram token exist only in environment variables.
- `LIVE_TRADING_ENABLED=false` is the default.
- Closing positions uses Market + `reduceOnly=true`.
- Partial close quantity is floored to the instrument `qtyStep`.
- Submitted prices are aligned to `tickSize`.
- Flatten requests Cancel All, then verifies active orders are gone before sending the reduce-only close.
- All dangerous requests are written to `system_events`.

## UI model

`/` is the main workspace. Lightweight Charts is the price surface; persistent manual levels and alerts are rendered as price lines. Risk/Reward objects are a synchronized SVG drawing layer with draggable price/time handles. Selecting or creating Risk/Reward opens the calculator drawer.

`/trade` is operational state from Bybit and deliberately separate from `/journal`, which is the human trade journal/history.
