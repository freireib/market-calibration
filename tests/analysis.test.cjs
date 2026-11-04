'use strict';
// Lightweight regression tests for app.js without adding a browser or build dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function engine() {
  const source = fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  // Do not execute DOM event wiring when evaluating the pure analysis helpers.
  const cut = source.indexOf("document.querySelectorAll('.tab').forEach(");
  assert.ok(cut > 0);
  const ctx=vm.createContext({console});
  vm.runInContext(source.slice(0,cut),ctx,{filename:'app.js'});
  return ctx;
}
function fixture() {
  return [
    {provider:'Kalshi',event_id:'A',category:'House',horizon:'two_months',probability:.12,outcome:0,volume_7d:100},
    {provider:'Kalshi',event_id:'A',category:'House',horizon:'one_month',probability:.14,outcome:0,volume_7d:150},
    {provider:'Kalshi',event_id:'B',category:'House',horizon:'two_months',probability:.44,outcome:1,volume_7d:1200},
    {provider:'Kalshi',event_id:'B',category:'House',horizon:'one_month',probability:.52,outcome:1,volume_7d:1600},
    {provider:'Kalshi',event_id:'C',category:'House',horizon:'two_months',probability:.91,outcome:0,volume_7d:100000},
    {provider:'Kalshi',event_id:'C',category:'House',horizon:'one_month',probability:.93,outcome:0,volume_7d:200000},
    {provider:'Kalshi',event_id:'D',category:'House',horizon:'two_months',probability:.48,outcome:1,volume_7d:800},
    {provider:'Kalshi',event_id:'E',category:'House',horizon:'two_months',probability:.48,outcome:1,volume_7d:null},
  ];
}
function select(overrides={}) {
  return {
    horizons:new Set(['two_months','one_month']),category:'all',weight:'equal',
    minVolume:0,maxVolume:0,binWidth:0.1,minBinCount:1,matched:false,
    ...overrides
  };
}
const ids = rows => rows.map(r=>r.event_id+'-'+r.horizon).sort();
test('maximum seven-day volume removes heavily traded contracts and absent-volume records',()=>{
  const ctx=engine();vm.runInContext('records = '+JSON.stringify(fixture()),ctx);
  const filtered=ctx.eligibleRows(select({maxVolume:2000}));
  assert.equal(filtered.length,5);
  assert.ok(filtered.every(r=>r.event_id!=='C' && r.event_id!=='E'));
  assert.equal(ctx.eligibleRows(select({minVolume:800,maxVolume:2000})).length,3);
  assert.equal(ctx.eligibleRows(select({maxVolume:99})).length,0);
});
test('matched-cohort selection uses all selected horizons after volume filtering',()=>{
  const ctx=engine();vm.runInContext('records = '+JSON.stringify(fixture()),ctx);
  const matched=ctx.eligibleRows(select({maxVolume:2000,matched:true}));
  assert.deepEqual(ids(matched),['A-one_month','A-two_months','B-one_month','B-two_months']);
  const oneH=ctx.eligibleRows(select({horizons:new Set(['two_months']),maxVolume:2000,matched:true}));
  assert.deepEqual(ids(oneH),['A-two_months','B-two_months','D-two_months']);
});
test('five, ten, twenty, twenty-five percent bins cover zero through one and obey min sample size',()=>{
  const ctx=engine();const sample=[
    {probability:0.00,outcome:0,volume_7d:10},
    {probability:0.0499,outcome:0,volume_7d:10},
    {probability:0.05,outcome:0,volume_7d:10},
    {probability:0.1999,outcome:1,volume_7d:10},
    {probability:0.20,outcome:1,volume_7d:10},
    {probability:1,outcome:1,volume_7d:10}
  ];
  for(const width of [.05,.1,.2,.25]) {
    const groups=ctx.getBinGroups(sample,'equal',width);
    assert.equal(groups.length,Math.round(1/width));
    assert.equal(groups.reduce((n,g)=>n+g.length,0),sample.length);
    assert.equal(groups.at(-1).at(-1)?.probability,1);
    const shown=ctx.binRows(sample,'equal',width,2);
    assert.ok(shown.every(b=>b.n>=2));
  }
  assert.equal(ctx.binRows(sample,'equal',.05,2).length,1);
});
test('minimum bin size does not alter the Brier score population',()=>{
  const ctx=engine();vm.runInContext('records = '+JSON.stringify(fixture()),ctx);
  const rows=ctx.eligibleRows(select({maxVolume:2000}),true);
  const score=ctx.scoreRows(rows,'equal');
  const one=ctx.binRows(rows,'equal',.1,1);
  const large=ctx.binRows(rows,'equal',.1,5);
  assert.equal(score.n,5);
  assert.ok(Number.isFinite(score.brier));
  assert.ok(one.length>large.length);
  assert.equal(large.length,0);
  assert.equal(ctx.scoreRows(rows,'equal').brier,score.brier);
});
test('data refresh fetches JSON without clearing filters or changing the page',async()=>{
  const ctx=engine();
  const els=new Map([
    ['study',{value:'primaries_2026'}],
    ['refresh-data',{disabled:false,textContent:'Refresh data'}],
    ['refresh-status',{textContent:''}],
    ['dataset-status',{dataset:{},textContent:''}]
  ]);
  let requestedUrl='';
  ctx.document={getElementById:id=>els.get(id)};
  ctx.fetch=async (url,opts)=>{
    requestedUrl=url;
    assert.equal(opts.cache,'no-store');
    return {ok:true,json:async()=>({schema_version:1,source:'test',generated_at:'2026-11-04T13:00:00Z',records:[]})};
  };
  ctx.render=()=>{};
  await ctx.loadRepository();
  assert.match(requestedUrl,/primaries_2026\.json\?cache=/);
  assert.equal(els.get('refresh-data').disabled,false);
  assert.match(els.get('refresh-status').textContent,/Dataset loaded/);
  assert.equal(els.get('study').value,'primaries_2026');
});
test('all expected in-browser controls exist in HTML',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  for(const id of ['refresh-data','refresh-status','min-volume','max-volume','bin-width','min-bin-count','bin-coverage']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
});
