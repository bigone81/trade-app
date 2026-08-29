# Exchange provider boundary

The runtime provider is still Bybit, but exchange-specific code is now isolated behind an adapter.

## Current packages

- `@trade/exchanges-core` — common adapter/account contracts.
- `@trade/exchanges-bybit` — Bybit REST/WebSocket implementation.
- `exchange_accounts` — SQLite registry of exchange accounts.

Canonical market identity remains `exchange + market + symbol`, for example `bybit:linear:BTCUSDT`.

## Account registry

`exchange_accounts` is now the source of account metadata used by API and worker. The old fixed TypeScript list of Account 1..5 is gone.

For the current personal/testing deployment, credentials still stay in `.env`. On database open, legacy variables matching `BYBIT_ACCOUNT<N>_{NAME,KEY,SECRET,DEMO}` are discovered dynamically and registered in `exchange_accounts`. `<N>` is not limited to 1..5.

The table stores only environment-variable references (`api_key_ref`, `api_secret_ref`), not the API secret itself. This keeps the current security model unchanged while removing the fixed five-account architecture.

A future SaaS credential layer can replace `credential_source=env` with encrypted database/KMS credentials without changing Chart, Trade Control, Journal, or the Bybit adapter contract.

## Adapter responsibilities

An exchange adapter owns:

- market data: tickers, candles, instrument rules, public WebSocket
- accounts: equity / balances
- trading: positions, active/history orders, executions, place/cancel, position management
- exchange-specific normalization such as Bybit tick size / qty step
- private WebSocket construction
- capability reporting

Bybit-only details such as `positionIdx`, `category=linear`, and Bybit API client construction stay inside `@trade/exchanges-bybit` as much as practical.

No second exchange is enabled yet. Binance/OKX adapters can be added later and selected by the account's `exchange` field.
