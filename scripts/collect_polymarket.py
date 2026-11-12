#!/usr/bin/env python3
"""Polymarket 2026 primary pilot, separate from Kalshi data and volume statistics."""
from __future__ import annotations
import json,sys,time
from datetime import date,datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"
sys.path.insert(0,str(Path(__file__).resolve().parent))
from collect_primaries import snap_date,HORIZONS

GAMMA="https://gamma-api.polymarket.com"
CLOB="https://clob.polymarket.com"
def api_json(base,path,params):
    url=base+path+"?"+urlencode(params)
    for attempt in range(4):
        try:
            with urlopen(Request(url,headers={"Accept":"application/json","User-Agent":"MarketCalibrationResearch/0.3"}),timeout=30) as response:
                return json.load(response)
        except (HTTPError,URLError,TimeoutError) as exc:
            if attempt==3:raise RuntimeError("Unable to read "+url+": "+str(exc)) from exc
            time.sleep(1+attempt*2)
    raise RuntimeError("Exhausted API retries")

def decode(v):
    return json.loads(v) if isinstance(v,str) else v

def history_snapshot(prices, cutoff):
    good=sorted((x for x in prices if isinstance(x.get("t"),int) and
        x["t"]<=cutoff and 0<=float(x.get("p",-1))<=1),key=lambda x:x["t"])
    if not good:
        return {"probability":None,"quote_status":"no_history","quote_age_hours":None}
    last=good[-1]
    age=(cutoff-last["t"])/3600
    if age>24:
        return {"probability":None,"quote_status":"stale","quote_age_hours":round(age,3)}
    return {"probability":float(last["p"]),"quote_status":"ok",
            "quote_age_hours":round(age,3)}

def final_yes(m):
    prices=decode(m.get("outcomePrices") or [])
    outcomes=decode(m.get("outcomes") or [])
    if not isinstance(prices,list) or not isinstance(outcomes,list) or len(prices)!=2 or len(outcomes)!=2:
        return None
    if [s.lower() for s in outcomes]!=["yes","no"]:
        return None
    yes,no=float(prices[0]),float(prices[1])
    if yes==1 and no==0:return 1
    if yes==0 and no==1:return 0
    return None

def collect():
    catalog=json.loads((DATA/"polymarket_primary_events.json").read_text())
    rows=[]
    stats={"contests":0,"contracts":0,"quote_records":0,"scored_records":0}
    for contest in catalog["events"]:
        slug=contest["slug"]
        events=api_json(GAMMA,"/events",{"slug":slug,"limit":2})
        if len(events)!=1 or events[0].get("slug")!=slug:
            raise RuntimeError("Unmatched event slug: "+slug)
        event=events[0]
        markets=event.get("markets") or []
        if len(markets)<2 or not bool(event.get("closed")):
            raise RuntimeError("Event missing, incomplete or not closed: "+slug)
        outcomes=[final_yes(m) for m in markets]
        if any(v is None for v in outcomes) or sum(outcomes)!=1 or any(
          str(m.get("umaResolutionStatus","")).lower()!="resolved" for m in markets
        ):
            raise RuntimeError("Event lacks a single, fully resolved nominee: "+slug)
        stats["contests"]+=1
        print("POLY_EVENT",slug,"contracts",len(markets),flush=True)
        day=date.fromisoformat(contest["primary_date"])
        for m,outcome in zip(markets,outcomes):
            ids=decode(m.get("clobTokenIds") or [])
            if not isinstance(ids,list) or len(ids)!=2:
                raise RuntimeError("Missing YES token id for "+str(m.get("id")))
            yes_token=str(ids[0])
            question=str(m.get("question") or m.get("id"))
            for horizon in HORIZONS:
                snap=snap_date(day,horizon)
                cutoff=int(snap.timestamp())
                hist=api_json(CLOB,"/prices-history",
                    {"market":yes_token,"startTs":cutoff-3*86400,"endTs":cutoff,"fidelity":60})
                measured=history_snapshot(hist.get("history") or [],cutoff)
                if measured["probability"] is not None:stats["quote_records"]+=1;stats["scored_records"]+=1
                rows.append({
                    "provider":"Polymarket",
                    "event_id":"Polymarket:"+str(m["id"]),
                    "contest_id":contest["contest_id"],
                    "label":contest["label"]+" · "+question,
                    "candidate":question,
                    "category":contest["category"],
                    "primary_date":day.isoformat(),
                    "horizon":horizon,
                    "snapshot_utc":snap.astimezone(timezone.utc).isoformat(),
                    "market_ticker":str(m.get("conditionId") or m["id"]),
                    "probability":measured["probability"],
                    "volume_7d":None,
                    "spread":None,
                    "outcome":outcome,
                    "outcome_status":"resolved",
                    "outcome_source":"https://polymarket.com/event/"+slug,
                    "price_basis":"Polymarket CLOB historical price (not historical bid/ask midpoint)",
                    "volume_basis":"historical trading volume unavailable",
                    **measured
                })
            stats["contracts"]+=1
            if stats["contracts"]%10==0:print("POLY_PROGRESS",stats["contracts"],flush=True)
            time.sleep(.05)
    output={"schema_version":1,"study_id":"polymarket_primaries_2026_pilot",
        "study_label":"2026 Primaries · Polymarket pilot",
        "generated_at":datetime.now(timezone.utc).isoformat(),
        "source":"Polymarket Gamma event outcomes and historical CLOB YES prices",
        "sample":str(len(catalog["events"]))+" curated, fully resolved 2026 primary nomination contests; separate from Kalshi",
        "statistics":stats,"records":rows}
    dest=DATA/"polymarket_primaries_2026_pilot.json"
    temporary=dest.with_suffix(".tmp")
    temporary.write_text(json.dumps(output,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    temporary.replace(dest)
    print("POLY_COLLECTION_COMPLETE",json.dumps(stats),flush=True)

def self_test():
    assert final_yes({"outcomePrices":'["1","0"]',"outcomes":'["Yes","No"]'})==1
    assert final_yes({"outcomePrices":'["0","1"]',"outcomes":'["Yes","No"]'})==0
    assert final_yes({"outcomePrices":'["0.5","0.5"]',"outcomes":'["Yes","No"]'}) is None
    c=1787000000
    assert history_snapshot([{"t":c-3600,"p":.73},{"t":c+3600,"p":.99}],c)["probability"]==.73
    assert history_snapshot([{"t":c-86400*2,"p":.73}],c)["probability"] is None
    print("POLY_SELF_TEST_PASSED",flush=True)

if __name__=="__main__":
    if "--self-test" in sys.argv:self_test()
    else:collect()
