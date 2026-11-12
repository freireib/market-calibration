'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const data=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'..','data',name),'utf8'));

test('expanded Kalshi House catalog represents each 2026 district only once',()=>{
  const catalog=data('markets.json');
  const ids=catalog.map(r=>r.event_id);
  assert.equal(new Set(ids).size,catalog.length);
  const house=catalog.filter(r=>r.category==='House');
  const district=house.map(r=>r.label.split(' · ')[0]);
  assert.equal(new Set(district).size,house.length);
  assert.ok(house.length>64 && house.length<=435);
  assert.ok(house.some(r=>r.series==='KXHOUSERACE'));
  assert.ok(catalog.every(r=>r.provider==='Kalshi'&&r.ticker.endsWith('-26-D')));
});

test('market history contains exactly one pre-election snapshot per selected horizon and contract',()=>{
  const catalog=data('markets.json'),d=data('observations.json');
  const expected=new Map(catalog.map(r=>[r.event_id,r.ticker]));
  assert.equal(d.records.length,catalog.length*3);
  const keys=new Set();
  for(const r of d.records){
    assert.equal(r.market_ticker,expected.get(r.event_id));
    assert.ok(['two_months','one_month','one_day'].includes(r.horizon));
    const key=r.event_id+'|'+r.horizon;
    assert.ok(!keys.has(key),'duplicate '+key);
    keys.add(key);
    assert.ok(Date.parse(r.snapshot_utc)<Date.parse('2026-11-03T00:00:00-05:00'));
    if(r.probability!==null){
      assert.ok(r.probability>=0&&r.probability<=1);
      assert.equal(r.quote_status,'ok');
      assert.ok(r.quote_age_hours>=0&&r.quote_age_hours<=24);
      assert.ok(r.spread>=0&&r.spread<=.200001);
    }
    if(r.outcome!==null)assert.ok(r.outcome===0||r.outcome===1);
  }
});
