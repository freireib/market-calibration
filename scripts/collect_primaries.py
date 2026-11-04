#!/usr/bin/env python3
"""2026 primary nomination market collector.

Reads curated, source-linked contest dates in data/primary_events_2026.json.
Each event is one primary; each outcome market is one candidate binary contract.
One-week, one-month, two-month, and one-day forecasts are fixed at 3pm Eastern
BEFORE THAT EVENT'S election or runoff date.

The candidate contracts within a primary are correlated and do not represent
independent primary races. All candidate YES/NO contracts are retained rather
than picking a winner or retroactively choosing one contender.

No guessed result: require one and only one YES settlement and no unsettled
candidate contracts in each nomination event before considering it resolved.
An API failure never silently produces a fabricated quote or outcome.
"""
from __future__ import annotations
import argparse
import calendar
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_kalshi import DATA, API, api_get, get_candles, snapshot

EASTERN = ZoneInfo("America/New_York")
HORIZONS = ("two_months", "one_month", "one_week", "one_day")


def months_before(day: date, months: int) -> date:
    v = day.year * 12 + day.month - 1 - months
    year, month = divmod(v, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def snap_date(day: date, horizon: str) -> datetime:
    if horizon == "two_months":
        t = months_before(day, 2)
    elif horizon == "one_month":
        t = months_before(day, 1)
    elif horizon == "one_week":
        t = day - timedelta(days=7)
    elif horizon == "one_day":
        t = day - timedelta(days=1)
    else:
        raise ValueError("Invalid horizon " + horizon)
    return datetime(t.year, t.month, t.day, 15, 0, tzinfo=EASTERN)


def list_candidate_markets(event_ticker: str, series: str) -> list[dict]:
    """Fetch archive and live tiers, de-dupe by ticker, filter to exact event."""
    all_markets = {}
    for path, params in [
        ("/historical/markets", {"series_ticker":series, "limit":200}),
        ("/markets", {"event_ticker":event_ticker,"limit":200}),
    ]:
        response = api_get(path, params)
        for market in response.get("markets", []):
            if market.get("event_ticker") == event_ticker and market.get("ticker"):
                all_markets[market["ticker"]] = market
        cursor = response.get("cursor")
        pages = 1
        while cursor and pages < 10:
            other = api_get(path, {**params, "cursor":cursor})
            for market in other.get("markets", []):
                if market.get("event_ticker") == event_ticker and market.get("ticker"):
                    all_markets[market["ticker"]] = market
            cursor = other.get("cursor")
            pages += 1
        if cursor:
            raise RuntimeError("Market listing pagination exceeded 10 pages for "+event_ticker)
    return list(all_markets.values())


def settled(markets: list[dict]) -> bool:
    """An event is scored only when every listed candidate is finalized and exactly one wins."""
    if len(markets) < 2:
        return False
    return (sum(str(m.get("result","")).lower()=="yes" for m in markets)==1
            and all(str(m.get("status","")).lower() in ("finalized","settled")
                    and str(m.get("result","")).lower() in ("yes","no")
                    for m in markets))


def collect(limit: int | None = None) -> dict:
    catalog = json.loads((DATA/"primary_events_2026.json").read_text(encoding="utf-8"))
    events = catalog["events"]
    if limit is not None:
        events = events[:limit]
    all_records = []
    stats = {"events_cataloged":len(events),"events_found":0,"events_resolved":0,
             "events_unresolved":0,"markets":0,"quote_records":0,"scored_records":0,
             "skipped_events":[]}
    for i,event in enumerate(events, 1):
        series, name = event["series"],event["event_ticker"]
        assert name==series+"-26", name
        day = date.fromisoformat(event["primary_date"])
        print(f"PRIMARY [{i}/{len(events)}] {name} {event['label']} {day}",flush=True)
        try:
            markets=list_candidate_markets(name,series)
        except Exception as exc:
            # A failed discovery is an error; no partial output should replace old data.
            raise RuntimeError("Cannot retrieve "+name+": "+str(exc)) from exc
        if not markets:
            print("SKIP event not found:",name,flush=True)
            stats["skipped_events"].append(name+": not found")
            continue
        stats["events_found"]+=1
        resolved=settled(markets)
        stats["events_resolved" if resolved else "events_unresolved"]+=1
        if not resolved:
            print("UNRESOLVED",name,"markets",len(markets),
                  "yes",sum(m.get("result")=="yes" for m in markets),flush=True)
        for market in markets:
            ticker=market["ticker"]
            candidate=market.get("yes_sub_title") or market.get("subtitle") or market.get("title") or ticker
            outcome = (int(str(market.get("result","")).lower()=="yes") if resolved else None)
            for horizon in HORIZONS:
                dt=snap_date(day,horizon)
                ts=int(dt.timestamp())
                try:
                    candles=get_candles(series,ticker,ts-8*86400,ts)
                    measured=snapshot(candles,ts)
                except RuntimeError as exc:
                    print("  NO_CANDLE",ticker,horizon,str(exc)[:130],flush=True)
                    measured={"probability":None,"volume_7d":None,"spread":None,
                              "quote_age_hours":None,"quote_status":"no_candles"}
                if measured["probability"] is not None and outcome is not None:
                    stats["scored_records"]+=1
                if measured["probability"] is not None:
                    stats["quote_records"]+=1
                all_records.append({
                    "provider":"Kalshi",
                    "event_id":ticker,  # Unique candidate contract, not the contest!
                    "contest_id":name,
                    "label":event["label"]+" · "+str(candidate),
                    "candidate":str(candidate),
                    "category":event["category"],
                    "market_ticker":ticker,
                    "primary_date":day.isoformat(),
                    "horizon":horizon,
                    "snapshot_utc":dt.astimezone(timezone.utc).isoformat(),
                    **measured,
                    "outcome":outcome,
                    "outcome_status":"resolved" if resolved else "uncalled",
                    "outcome_source":API+"/historical/markets/"+ticker if resolved else "",
                })
            stats["markets"]+=1
        print("DONE",name,"markets",len(markets),"resolved",resolved,flush=True)
    stats["records"]=len(all_records)
    result={
        "schema_version":1,
        "study_id":"primaries_2026",
        "study_label":"2026 U.S. Primaries",
        "generated_at":datetime.now(timezone.utc).isoformat(),
        "source":"Kalshi official historic/live candlesticks and finalized candidate contract results",
        "sample":"Curated 2026 nomination event catalog; multiple correlated candidate contracts per primary",
        "statistics":stats,
        "records":all_records
    }
    out=DATA/"primaries_2026.json"
    temporary=out.with_suffix(".tmp")
    temporary.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    temporary.replace(out)
    print("PRIMARY_COLLECTION_COMPLETE",json.dumps(stats),flush=True)
    return result


def self_test():
    assert months_before(date(2026,3,31),1)==date(2026,2,28)
    assert snap_date(date(2026,8,4),"one_day").date()==date(2026,8,3)
    assert snap_date(date(2026,3,3),"two_months").date()==date(2026,1,3)
    a=[{"status":"finalized","result":"yes"},{"status":"finalized","result":"no"}]
    assert settled(a)
    assert not settled([a[0],a[0]])
    assert not settled([a[0],{"status":"active","result":""}])
    print("PRIMARY_SELF_TEST_PASSED",flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--self-test",action="store_true")
    parser.add_argument("--limit-events",type=int,default=None)
    args=parser.parse_args()
    if args.self_test:self_test()
    else:collect(args.limit_events)
