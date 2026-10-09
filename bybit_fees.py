#!/usr/bin/env python3
"""Print Bybit V5 maker/taker fees for accounts configured in the root .env."""

import argparse
import hashlib
import hmac
import json
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
from decimal import Decimal
from pathlib import Path


def load_env(path):
    if not path.is_file():
        raise ValueError(f"Не найден .env рядом со скриптом: {path}")
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        values[name.strip()] = value
    return values


def signed_get(key, secret, query, path, demo):
    host = "https://api-demo.bybit.com" if demo else "https://api.bybit.com"
    timestamp = str(int(time.time() * 1000))
    window = "5000"
    message = f"{timestamp}{key}{window}{query}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        f"{host}{path}?{query}",
        headers={
            "X-BAPI-API-KEY": key,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": window,
            "X-BAPI-SIGN": signature,
        },
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        data = json.load(response)
    if data.get("retCode") != 0:
        raise ValueError(f"Bybit {data.get('retCode')}: {data.get('retMsg')}")
    return data.get("result", {}).get("list", [])


def get_fees(key, secret, symbol):
    items = signed_get(key, secret, f"category=linear&symbol={symbol}", "/v5/account/fee-rate", False)
    if not items:
        raise ValueError("Bybit не вернул комиссии для выбранной пары")
    item = items[0]
    return Decimal(item["makerFeeRate"]) * 100, Decimal(item["takerFeeRate"]) * 100


def print_demo_fees(key, secret, symbol):
    # Demo Trading does not support /v5/account/fee-rate.
    # Execution history does contain fees for past fills.
    items = signed_get(key, secret, f"category=linear&symbol={symbol}&limit=100",
                       "/v5/execution/list", True)
    trades = [item for item in items if item.get("execType") == "Trade"]
    if not trades:
        items = signed_get(key, secret, "category=linear&limit=100",
                           "/v5/execution/list", True)
        trades = [item for item in items if item.get("execType") == "Trade"]
        if trades:
            print(f"  Нет исполнений {symbol}; показаны другие пары.")
    if not trades:
        print("  В истории Demo нет исполненных фьючерсных сделок.")
        print("  Комиссия неизвестна. Новые ордера не создавались.")
        return
    print("  Ставки по последним исполненным сделкам DEMO (не тариф LIVE):")
    recent = {}
    for item in trades:
        is_maker = item.get("isMaker")
        if type(is_maker) is not bool:
            continue
        label = "Maker" if is_maker else "Taker"
        if label in recent:
            continue
        try:
            rate = Decimal(item["feeRate"]) * 100
        except (KeyError, ArithmeticError, TypeError):
            continue
        recent[label] = rate
        print(f"  {label}: {rate}% (пара {item.get('symbol', '?')})")
    for label in ("Maker", "Taker"):
        if label not in recent:
            print(f"  {label}: нет примера среди последних {len(trades)} исполнений")
    if "Taker" in recent:
        print(f"  Taker вход + выход: ≈ {recent['Taker'] * 2}% (оценка по истории)")
    print("  Внимание: комиссия Demo может отличаться от реального аккаунта.")


def main():
    parser = argparse.ArgumentParser(description="Комиссии Bybit Futures из .env")
    parser.add_argument("--account", type=int, help="Номер BYBIT_ACCOUNT, например 3")
    parser.add_argument("--symbol", default="BTCUSDT", help="Торговая пара (по умолчанию BTCUSDT)")
    args = parser.parse_args()
    symbol = args.symbol.upper()
    if not re.fullmatch(r"[A-Z0-9]{2,35}", symbol):
        parser.error("Неверный символ")
    try:
        env = load_env(Path(__file__).resolve().parent / ".env")
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Ошибка: {exc}\n")

    slots = sorted({int(m.group(1)) for name in env
                    if (m := re.fullmatch(r"BYBIT_ACCOUNT(\d+)_KEY", name))})
    if args.account is not None:
        slots = [args.account]
    if not slots:
        parser.exit(1, "В .env не найдены BYBIT_ACCOUNT<N>_KEY\n")

    had_error = False
    for slot in slots:
        prefix = f"BYBIT_ACCOUNT{slot}_"
        name = env.get(prefix + "NAME", f"Account {slot}")
        key, secret = env.get(prefix + "KEY"), env.get(prefix + "SECRET")
        demo = env.get(prefix + "DEMO", "false").lower() in ("1", "true", "yes", "on")
        print(f"\n{name} [#{slot}, {'DEMO' if demo else 'LIVE'}] — {symbol}")
        if not key or not secret:
            print("  Нет KEY/SECRET в .env")
            had_error = True
            continue
        try:
            if demo:
                print_demo_fees(key, secret, symbol)
            else:
                maker, taker = get_fees(key, secret, symbol)
                print(f"  Maker: {maker}%")
                print(f"  Taker: {taker}%")
                print(f"  Taker вход + выход: ≈ {taker * 2}%")
        except (ValueError, KeyError, urllib.error.URLError, TimeoutError) as exc:
            print(f"  Ошибка запроса: {exc}")
            had_error = True
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
