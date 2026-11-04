'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('provider switching fetches distinct unpooled JSON assets with no full reload',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const cut=source.indexOf("document.querySelectorAll('.tab').forEach(");
  const ctx=vm.createContext({console});
  vm.runInContext(source.slice(0,cut),ctx);
  const els=new Map([
    ['study',{value:'primaries_2026'}],
    ['provider',{value:'Polymarket'}],
    ['refresh-data',{disabled:false,textContent:''}],
    ['refresh-status',{textContent:''}],
    ['dataset-status',{dataset:{},textContent:''}]
  ]);
  let urls=[];
  ctx.document={getElementById:id=>els.get(id)};
  ctx.render=()=>{};
  ctx.fetch=async (url)=>{
    urls.push(url);
    return {ok:true,json:async()=>({schema_version:1,records:[],source:'test',generated_at:'2026-11-04T14:00:00Z'})};
  };
  await ctx.loadRepository();
  els.get('provider').value='Kalshi';
  await ctx.loadRepository();
  els.get('study').value='general_2026';
  await ctx.loadRepository();
  assert.match(urls[0],/polymarket_primaries_2026_pilot\.json/);
  assert.match(urls[1],/primaries_2026\.json/);
  assert.doesNotMatch(urls[1],/polymarket_/);
  assert.match(urls[2],/observations\.json/);
});
test('Polymarket pilot is small, separated, resolved, and has explicitly missing 7-day volume',()=>{
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','polymarket_primaries_2026_pilot.json'),'utf8'));
  assert.equal(data.schema_version,1);
  assert.equal(data.statistics.contests,2);
  assert.equal(data.statistics.contracts,43);
  assert.ok(data.records.every(r=>r.provider==='Polymarket'&&r.volume_7d===null));
  assert.ok(data.records.every(r=>r.outcome===0||r.outcome===1));
  assert.equal(data.records.filter(r=>r.probability!==null).length,64);
});
