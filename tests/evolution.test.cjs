'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function context(){
  const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const evolution=fs.readFileSync(path.join(__dirname,'..','evolution.js'),'utf8');
  const context=vm.createContext({console});
  vm.runInContext(app.slice(0,app.indexOf("document.querySelectorAll('.tab').forEach(")),context);
  vm.runInContext(evolution,context);
  return context;
}
test('binary entropy has the expected range and symmetry',()=>{
  const x=context();
  assert.equal(x.entropyBits(0),0);
  assert.equal(x.entropyBits(1),0);
  assert.equal(x.entropyBits(.5),1);
  assert.ok(Math.abs(x.entropyBits(.1)-x.entropyBits(.9))<1e-12);
});
test('horizon diagnostics compute uncertainty, expected loss and actual Brier from the same cohort',()=>{
  const x=context();
  const rows=[
    {horizon:'one_day',probability:.5,outcome:1,volume_7d:5},
    {horizon:'one_day',probability:0,outcome:0,volume_7d:10},
    {horizon:'two_months',probability:.5,outcome:0,volume_7d:15},
  ];
  const sel={weight:'equal',horizons:new Set(['one_day','two_months'])};
  const stats=x.horizonDiagnostics(rows,sel);
  const one=stats.find(z=>z.id==='one_day');
  assert.equal(one.n,2);
  assert.equal(one.entropy,.5);
  assert.equal(one.brier,.125);
  assert.equal(one.calibratedBrier,.125);
  assert.equal(one.mid,.5);
  assert.equal(one.extreme,.5);
});
test('probability distribution buckets partition [0,1] without double counting',()=>{
  const x=context();
  const boundaries=[0,.0999,.1,.2499,.25,.5,.75,.7501,.9,.9001,1];
  boundaries.forEach(p=>{
    const count=vm.runInContext('PROB_RANGES',x).filter(b=>b.contains(p)).length;
    assert.equal(count,1,'p='+p);
  });
});
test('HTML declares the trend and distribution elements',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  for(const id of ['probability-distribution','distribution-legend','entropy-trend','brier-trend','evolution-table','evolution-note']){
    assert.ok(source.includes('id="'+id+'"'));
  }
  assert.ok(source.includes('evolution.js'));
});
