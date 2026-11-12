#!/usr/bin/env python3
"""Discover *real* 2026 election contracts, without guessing valid tickers.

The pilot includes every state for Senate/governor market discovery and a
predeclared exploratory set of House districts. It is NOT a representative
sample of all U.S. House races.

Full scope enumerates all 435 U.S. House districts, plus Senate and governor.
All entries must be returned by Kalshi's GET /events/{ticker} endpoint.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_kalshi import api_get, DATA

# 2020 apportionment, applicable to the 2026 House election.
HOUSE_SEATS = {
 "AL":7,"AK":1,"AZ":9,"AR":4,"CA":52,"CO":8,"CT":5,"DE":1,
 "FL":28,"GA":14,"HI":2,"ID":2,"IL":17,"IN":9,"IA":4,"KS":4,
 "KY":6,"LA":6,"ME":2,"MD":8,"MA":9,"MI":13,"MN":8,"MS":4,
 "MO":8,"MT":2,"NE":3,"NV":4,"NH":2,"NJ":12,"NM":3,"NY":26,
 "NC":14,"ND":1,"OH":15,"OK":5,"OR":6,"PA":17,"RI":2,
 "SC":7,"SD":1,"TN":9,"TX":38,"UT":4,"VT":1,"VA":11,
 "WA":10,"WV":2,"WI":8,"WY":1
}
assert sum(HOUSE_SEATS.values()) == 435

# Exploratory selection only, NOT a random or representative sample.
PILOT_HOUSE = [
  ("AZ",1),("AZ",6),("CA",13),("CA",22),("CA",27),("CA",41),
  ("CO",8),("IA",1),("IA",3),("IL",17),("ME",2),("MI",7),
  ("MI",8),("NE",2),("NV",1),("NV",3),("NY",4),("NY",17),
  ("OH",9),("OR",5),("PA",7),("PA",8),("PA",10),("TX",15),
  ("VA",2),("WI",3)
]

def candidates(scope):
    for state in HOUSE_SEATS:
        yield f"SENATE{state}",f"{state} · U.S. Senate","Senate"
        yield f"GOVPARTY{state}",f"{state} · Governor","Governor"
    pairs = PILOT_HOUSE if scope == "pilot" else [
        (state,n) for state,seats in HOUSE_SEATS.items()
        for n in (range(1,seats+1) if seats>1 else (0,1))
    ]
    for state,n in pairs:
        suffix = "AL" if HOUSE_SEATS[state] == 1 else f"{n:02}"
        yield f"HOUSE{state}{n}",f"{state}-{suffix} · U.S. House","House"

def add_new_house_series(catalog):
    """Fill uncovered districts from exchange-confirmed KXHOUSERACE 2026 D contracts.

    The legacy HOUSE{state}{district} series takes precedence in any district
    where both exist, preventing a race from entering the study twice.
    """
    existing = {item["label"].split(" · ")[0]
                for item in catalog.values() if item["category"] == "House"}
    pattern = re.compile(r"^KXHOUSERACE-([A-Z]{2})(AL|[0-9]{2})-26-D$")
    added = 0
    for endpoint in ("/markets", "/historical/markets"):
        cursor = None
        pages = 0
        while True:
            params = {"series_ticker": "KXHOUSERACE", "limit": 200}
            if cursor:
                params["cursor"] = cursor
            response = api_get(endpoint, params)
            markets = response.get("markets") or []
            for market in markets:
                ticker = market.get("ticker", "")
                match = pattern.fullmatch(ticker)
                if not match:
                    continue
                state, district = match.groups()
                seats = HOUSE_SEATS.get(state)
                if seats is None:
                    continue
                if seats == 1 and district != "AL":
                    continue
                if seats > 1 and (not district.isdecimal() or
                                  int(district) < 1 or int(district) > seats):
                    continue
                district_key = f"{state}-{district}"
                if district_key in existing:
                    continue
                title = (market.get("title") or "").lower()
                if "democratic" not in title or "house" not in title:
                    raise RuntimeError("Unverified KXHOUSERACE party proposition: "+ticker)
                catalog["House:"+district_key] = {
                    "provider": "Kalshi",
                    "event_id": "2026-kxhousErace-"+state.lower()+district.lower(),
                    "label": district_key+" · U.S. House",
                    "category": "House",
                    "series": "KXHOUSERACE",
                    "ticker": ticker
                }
                existing.add(district_key)
                added += 1
            pages += 1
            cursor = response.get("cursor")
            if not cursor:
                break
            if pages >= 30:
                raise RuntimeError("KXHOUSERACE market pagination too large to audit")
        print("KXHOUSERACE_DISCOVERY",endpoint,"pages",pages,"total added",added,flush=True)
    return added


def discover(scope):
    market_catalog = {}
    missing,checked=0,0
    for series,label,category in candidates(scope):
        checked+=1
        event=series+"-26"
        try:
            response=api_get("/events/"+event)
        except RuntimeError as e:
            if "HTTP 404" in str(e):
                missing+=1
                continue
            print("Error discovering",event,str(e),flush=True)
            raise
        markets=response.get("markets") or (response.get("event") or {}).get("markets") or []
        market = next((x for x in markets if x.get("ticker","") == event+"-D"),None)
        if market:
            key=category+":"+label
            market_catalog[key]={
                "provider":"Kalshi",
                "event_id":"2026-"+series.lower(),
                "label":label,
                "category":category,
                "series":series,
                "ticker":market["ticker"]
            }
        if checked%30==0:
            print("Discovery progress:",checked,"checked,",len(market_catalog),"D contracts",flush=True)
        time.sleep(0.03)
    if scope == "all":
        increment = add_new_house_series(market_catalog)
        print("NEW_HOUSE_DISTRICTS",increment,flush=True)
    catalog=sorted(market_catalog.values(),key=lambda x:(x["category"],x["label"]))
    if not catalog:raise RuntimeError("Discovery returned zero confirmed contracts")
    output=DATA/"markets.json"
    output.write_text(json.dumps(catalog,indent=2)+"\n",encoding="utf-8")
    print("DISCOVERY_COMPLETE scope",scope,"checked",checked,"missing",missing,
          "markets",len(catalog),"by office",
          {c:sum(x["category"]==c for x in catalog) for c in ("House","Senate","Governor")},
          flush=True)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--scope",choices=["pilot","all"],default="pilot")
    args=parser.parse_args()
    discover(args.scope)
