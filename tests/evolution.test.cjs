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
test('reflected KDE integrates to 1 with mass at the probability boundaries',()=>{
  const x=context();
  const rows=[{probability:0,volume_7d:10},{probability:1,volume_7d:10}];
  for(const h of [.04,.07,.10,.15]){
    const curve=x.estimateProbabilityKDE(rows,'equal',h,400);
    assert.equal(curve.length,401);
    const area=curve.reduce((sum,p,i)=>sum+p.y*((i===0||i===400)?.5:1),0)/400;
    assert.ok(Math.abs(area-1)<1e-8,'area='+area+' bandwidth='+h);
    assert.ok(curve.every(p=>Number.isFinite(p.y)&&p.y>=0));
    assert.ok(curve[0].y>curve[200].y*20);
    assert.ok(Math.abs(curve[0].y-curve[400].y)<1e-8);
  }
});
test('KDE honors prior-seven-day weighting but does not change sample counts',()=>{
  const x=context();
  const rows=[{probability:.1,volume_7d:1},{probability:.9,volume_7d:100}];
  const equal=x.estimateProbabilityKDE(rows,'equal',.05,200);
  const volume=x.estimateProbabilityKDE(rows,'volume',.05,200);
  assert.ok(Math.abs(equal[20].y-equal[180].y)<1e-8);
  assert.ok(volume[180].y>volume[20].y*30);
  assert.equal(x.estimateProbabilityKDE([], 'equal', .07).length,0);
});
test('KDE bandwidth input and horizon-colored distribution are present',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.match(source,/id="kde-bandwidth"/);
  assert.match(source,/viewBox="0 0 700 360"/);
  const js=fs.readFileSync(path.join(__dirname,'..','evolution.js'),'utf8');
  assert.ok(js.includes("stroke:item.color"));
  assert.ok(js.includes('estimateProbabilityKDE(item.rows,sel.weight,bandwidth)'));
});
test('HTML declares the trend and distribution elements',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  for(const id of ['probability-distribution','distribution-legend','entropy-trend','brier-trend','evolution-table','evolution-note']){
    assert.ok(source.includes('id="'+id+'"'));
  }
  assert.ok(source.includes('evolution.js'));
});
