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
        yield f"HOUSE{state}{n:02}",f"{state}-{n:02} · U.S. House","House"

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
