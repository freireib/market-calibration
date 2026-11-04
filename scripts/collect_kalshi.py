#!/usr/bin/env python3
"""Collect fixed-horizon Kalshi quote snapshots and verified settlements.

Standard-library only. First pass: a *curated* market catalog (data/markets.json),
not automatic discovery. No forecasts, outcomes, or race calls are fabricated.

Run:
    python3 scripts/collect_kalshi.py --self-test
    python3 scripts/collect_kalshi.py
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
API = "https://api.elections.kalshi.com/trade-api/v2"
EASTERN = ZoneInfo("America/New_York")
HORIZONS = {
    "two_months": datetime(2026, 9, 3, 15, tzinfo=EASTERN),
    "one_month": datetime(2026, 10, 3, 15, tzinfo=EASTERN),
    "one_day": datetime(2026, 11, 2, 15, tzinfo=EASTERN),
}
ALLOWED_OUTCOME_STATUSES = {"called", "certified", "settled", "resolved"}


def api_get(path: str, params: dict | None = None) -> dict:
    url = API + path + ("?" + urlencode(params) if params else "")
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={"User-Agent": "MarketCalibrationResearch/0.1",
                                               "Accept": "application/json"}), timeout=35) as response:
                return json.load(response)
        except HTTPError as err:
            if err.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise RuntimeError(f"API HTTP {err.code}: {url}") from err
        except (URLError, TimeoutError, ValueError) as err:
            if attempt == 3:
                raise RuntimeError(f"API error: {url}: {err}") from err
        time.sleep(min(8, 2**attempt))
    raise RuntimeError("Request failed: " + url)


def get_market(ticker: str) -> dict:
    escaped = quote(ticker, safe="")
    for path in (f"/markets/{escaped}", f"/historical/markets/{escaped}"):
        try:
            result = api_get(path).get("market")
            if result:
                return result
        except RuntimeError as err:
            if "HTTP 404" not in str(err):
                raise
    raise RuntimeError("Market not found in current or historical tier: " + ticker)


def get_candles(series: str, ticker: str, start: int, end: int) -> list[dict]:
    s, t = quote(series, safe=""), quote(ticker, safe="")
    params = {"start_ts": start, "end_ts": end, "period_interval": 60}
    errors = []
    # Archived markets are exposed through a different endpoint and field schema.
    for path in (f"/series/{s}/markets/{t}/candlesticks",
                 f"/historical/markets/{t}/candlesticks"):
        try:
            result = api_get(path, params)
            candles = result.get("candlesticks")
            if isinstance(candles, list) and candles:
                return candles
            errors.append("no candles from " + path)
        except RuntimeError as err:
            errors.append(str(err))
    raise RuntimeError("No usable candlesticks for " + ticker + ": " + "; ".join(errors))


def numeric(value) -> float | None:
    if value is None:
        return None
    try:
        x = float(value)
        return x if math.isfinite(x) else None
    except (ValueError, TypeError):
        return None


def close_price(candle: dict, field: str) -> float | None:
    obj = candle.get(field) or {}
    if not isinstance(obj, dict):
        return None
    # Live: USD-as-string close_dollars; historic: USD-as-string close.
    return numeric(obj.get("close_dollars", obj.get("close")))


def volume(candle: dict) -> float:
    # Live: fixed point contracts; historic: legacy number of contracts.
    x = numeric(candle.get("volume_fp", candle.get("volume")))
    return max(0.0, x or 0.0)


def snapshot(candles: list[dict], cutoff: int) -> dict:
    """No look-ahead: require candle end <= forecast cutoff."""
    prior = sorted((c for c in candles if isinstance(c.get("end_period_ts"), int)
                    and c["end_period_ts"] <= cutoff), key=lambda c: c["end_period_ts"])
    seven_day_volume = sum(volume(c) for c in prior if c["end_period_ts"] > cutoff - 7*86400)
    result = {"probability": None, "volume_7d": seven_day_volume, "spread": None,
              "quote_age_hours": None, "quote_status": "no_recent_two_sided_quote"}
    for candle in reversed(prior):
        age = (cutoff - candle["end_period_ts"]) / 3600.0
        if age > 24:
            break
        bid, ask = close_price(candle, "yes_bid"), close_price(candle, "yes_ask")
        if bid is None or ask is None or not (0 <= bid <= ask <= 1):
            continue
        spread = ask - bid
        result.update({"spread": spread, "quote_age_hours": age})
        if spread <= 0.20:
            result.update({"probability": (bid + ask) / 2, "quote_status": "ok"})
        else:
            result["quote_status"] = "wide_spread"
        return result
    return result


def manual_outcomes() -> dict[str, dict]:
    path = DATA / "verified_outcomes.csv"
    if not path.is_file():
        return {}
    items = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = row.get("event_id", "").strip()
            if not key:
                continue
            val, status = row.get("outcome", "").strip(), row.get("status", "").strip()
            source = row.get("source_url", "").strip()
            if val not in ("0", "1") or status not in ALLOWED_OUTCOME_STATUSES or not source:
                raise ValueError("Verified outcome needs event_id, outcome 0/1, status and source_url: " + key)
            items[key] = {"outcome": int(val), "outcome_status": status, "outcome_source": source}
    return items


def settled_outcome(market: dict, ticker: str) -> dict:
    # Settlement is a market determination; it is not necessarily an AP call.
    status = str(market.get("status", "")).lower()
    result = str(market.get("result", "")).lower()
    if status in ("settled", "finalized") and result in ("yes", "no"):
        return {"outcome": int(result == "yes"), "outcome_status": "resolved",
                "outcome_source": API + "/markets/" + quote(ticker, safe="")}
    return {"outcome": None, "outcome_status": "uncalled", "outcome_source": ""}


def collect() -> None:
    catalog = json.loads((DATA / "markets.json").read_text(encoding="utf-8"))
    if not isinstance(catalog, list):
        raise ValueError("data/markets.json must contain an array.")
    verified = manual_outcomes()
    records = []
    for i, entry in enumerate(catalog, 1):
        required = ("provider", "event_id", "label", "category", "series", "ticker")
        if any(not entry.get(field) for field in required):
            raise ValueError("Missing catalog fields in entry " + str(i))
        if entry["provider"] != "Kalshi":
            raise ValueError("The Kalshi collector cannot collect other providers.")
        ticker, series = entry["ticker"], entry["series"]
        print(f"[{i}/{len(catalog)}] {entry['label']}: {ticker}", flush=True)
        market = get_market(ticker)
        resolution = verified.get(entry["event_id"]) or settled_outcome(market, ticker)
        for horizon, dt in HORIZONS.items():
            cutoff = int(dt.timestamp())
            try:
                candles = get_candles(series, ticker, cutoff-8*86400, cutoff)
                measured = snapshot(candles, cutoff)
            except RuntimeError as err:
                print(f"  Missing {horizon}: {str(err)[:160]}", flush=True)
                measured = {"probability": None, "volume_7d": None,
                            "spread": None, "quote_age_hours": None,
                            "quote_status": "unavailable"}
            record = {
                "provider": entry["provider"], "event_id": entry["event_id"],
                "label": entry["label"], "category": entry["category"],
                "market_ticker": ticker, "horizon": horizon,
                "snapshot_utc": dt.astimezone(timezone.utc).isoformat(),
                **measured, **resolution,
            }
            records.append(record)
            time.sleep(0.15)
    # Atomic replace. An API failure earlier in the loop leaves old data intact.
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Kalshi historical and live market candlesticks; settlement or verified call",
        "records": records
    }
    out = DATA / "observations.json"
    temporary = out.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
    temporary.replace(out)
    print(f"Saved {len(records)} observations to {out}")


def self_test():
    now = 1800000000
    c = [
        {"end_period_ts":now-3600, "yes_bid":{"close_dollars":"0.68"},
         "yes_ask":{"close_dollars":"0.72"}, "volume_fp":"12"},
        {"end_period_ts":now+3600, "yes_bid":{"close_dollars":"0.98"},
         "yes_ask":{"close_dollars":"0.99"}, "volume_fp":"1000000"},
    ]
    m = snapshot(c, now)
    assert abs(m["probability"]-0.7)<1e-10
    assert m["volume_7d"] == 12
    assert settled_outcome({"status":"active", "result":"yes"},"A")["outcome"] is None
    assert settled_outcome({"status":"settled", "result":"no"},"A")["outcome"] == 0
    historic = [{"end_period_ts":now-3600, "yes_bid":{"close":"0.42"},
                "yes_ask":{"close":"0.48"}, "volume":3}]
    assert abs(snapshot(historic,now)["probability"]-0.45)<1e-10
    assert settled_outcome({"status":"finalized", "result":"yes"},"A")["outcome"] == 1
    print("Offline tests passed. Live API not tested.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            self_test()
        else:
            collect()
    except (RuntimeError, ValueError, OSError) as exc:
        print("ERROR:", exc, file=sys.stderr)
        sys.exit(1)
