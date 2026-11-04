'use strict';
// Additional diagnostics use the same cohort, horizons, and weighting as the calibration view.
function entropyBits(p) {
  return p===0||p===1 ? 0 : -p*Math.log2(p)-(1-p)*Math.log2(1-p);
}
const PROB_RANGES=[
  {name:'0–10%',color:'#315f77',contains:p=>p<.1},
  {name:'10–25%',color:'#87abbc',contains:p=>p>=.1&&p<.25},
  {name:'25–75%',color:'#e5b168',contains:p=>p>=.25&&p<=.75},
  {name:'75–90%',color:'#84aaa5',contains:p=>p>.75&&p<=.9},
  {name:'90–100%',color:'#18877f',contains:p=>p>.9}
];
function horizonDiagnostics(rows,sel) {
  return HORIZONS.filter(h=>sel.horizons.has(h.id)).map(h=>{
    const a=rows.filter(r=>r.horizon===h.id&&weightOf(r,sel.weight)>0);
    return {
      ...h, rows:a, n:a.length,
      entropy:weightedMean(a,r=>entropyBits(r.probability),sel.weight),
      brier:weightedMean(a,r=>(r.probability-r.outcome)**2,sel.weight),
      calibratedBrier:weightedMean(a,r=>r.probability*(1-r.probability),sel.weight),
      mid:weightedMean(a,r=>r.probability>=.25&&r.probability<=.75?1:0,sel.weight),
      extreme:weightedMean(a,r=>r.probability<.1||r.probability>.9?1:0,sel.weight)
    };
  });
}
function drawProbabilityDistribution(items,sel) {
  const root=byId('probability-distribution');
  root.replaceChildren();
  const l=64,t=24,b=260,w=600,h=b-t;
  for(let i=0;i<=4;i++){
    const y=b-h*i/4;
    root.append(svg('line',{x1:l,y1:y,x2:l+w,y2:y,stroke:'#dde8eb'}));
    root.append(svg('text',{x:l-8,y:y+4,'text-anchor':'end',fill:'#60737c','font-size':12},i*25+'%'));
  }
  items.forEach((item,i)=>{
    const x=l+w*(i+.5)/items.length,bar=Math.min(90,w/items.length-25);
    const sizes=PROB_RANGES.map(bin=>item.rows.reduce((v,r)=>v+(bin.contains(r.probability)?weightOf(r,sel.weight):0),0));
    const total=sizes.reduce((a,v)=>a+v,0);
    let previous=0;
    sizes.forEach((value,j)=>{
      if(!value||!total)return;
      const f=value/total,top=b-h*(previous+f);
      const rect=svg('rect',{x:x-bar/2,y:top,width:bar,height:h*f,fill:PROB_RANGES[j].color});
      const n=item.rows.filter(r=>PROB_RANGES[j].contains(r.probability)).length;
      rect.append(svg('title',{},item.label+' / '+PROB_RANGES[j].name+': '+n+' forecasts; weighted share '+pct(f)));
      root.append(rect);
      if(f>.12)root.append(svg('text',{x,y:top+h*f/2+4,'text-anchor':'middle',fill:j===0||j===4?'white':'#173140','font-size':11,'pointer-events':'none'},Math.round(f*100)+'%'));
      previous+=f;
    });
    root.append(svg('text',{x,y:b+23,'text-anchor':'middle',fill:'#173140','font-size':13},item.label));
    root.append(svg('text',{x,y:b+41,'text-anchor':'middle',fill:'#60737c','font-size':12},'n='+item.n));
  });
  const legend=byId('distribution-legend');
  legend.replaceChildren();
  PROB_RANGES.forEach(x=>{
    const item=document.createElement('span');item.className='legend-item';
    const patch=document.createElement('span');patch.className='legend-swatch';patch.style.background=x.color;
    item.append(patch,document.createTextNode(x.name));legend.append(item);
  });
}
function drawHorizonTrend(id,items,metric,title,yCap,color) {
  const root=byId(id);root.replaceChildren();
  const l=60,r=650,t=28,b=205;
  const max=yCap||Math.max(.1,Math.ceil(Math.max(0,...items.map(x=>Number.isFinite(x[metric])?x[metric]:0))*10)/10);
  const x=i=>l+40+(r-l-80)*(i+.5)/items.length,y=v=>b-(b-t)*v/max;
  for(let i=0;i<=4;i++){
    const val=i*max/4,py=y(val);
    root.append(svg('line',{x1:l,y1:py,x2:r,y2:py,stroke:'#e0e9eb'}));
    root.append(svg('text',{x:l-7,y:py+4,'text-anchor':'end',fill:'#60737c','font-size':12},val.toFixed(2)));
  }
  const measured=items.map((item,i)=>({...item,index:i})).filter(item=>item.n&&Number.isFinite(item[metric]));
  if(measured.length>1){
    root.append(svg('polyline',{
      points:measured.map(item=>x(item.index)+','+y(item[metric])).join(' '),
      stroke:color,'stroke-width':2.3,fill:'none'
    }));
  }
  items.forEach((item,i)=>{
    root.append(svg('text',{x:x(i),y:b+23,'text-anchor':'middle',fill:'#173140','font-size':12},item.label));
    if(!item.n||!Number.isFinite(item[metric]))return;
    const c=svg('circle',{cx:x(i),cy:y(item[metric]),r:5,fill:color,stroke:'white','stroke-width':1.5});
    c.append(svg('title',{},item.label+' '+title+': '+fmt(item[metric])+' (n='+item.n+')'));
    root.append(c);
    root.append(svg('text',{x:x(i),y:Math.max(14,y(item[metric])-12),'text-anchor':'middle',fill:color,'font-size':11,'font-weight':650},fmt(item[metric])));
  });
}
function overlayCalibrationBenchmark(items,max) {
  const root=byId('brier-trend');
  const l=60,r=650,t=28,b=205;
  const x=i=>l+40+(r-l-80)*(i+.5)/items.length,y=v=>b-(b-t)*v/max;
  const rows=items.map((item,i)=>({...item,index:i})).filter(item=>item.n&&Number.isFinite(item.calibratedBrier));
  if(rows.length>1)root.append(svg('polyline',{
    points:rows.map(item=>x(item.index)+','+y(item.calibratedBrier)).join(' '),
    stroke:'#4977ac','stroke-dasharray':'5,4','stroke-width':2.2,fill:'none'
  }));
  rows.forEach(item=>{
    const circle=svg('circle',{cx:x(item.index),cy:y(item.calibratedBrier),r:4,fill:'#4977ac',stroke:'white'});
    circle.append(svg('title',{},item.label+' calibrated forecast benchmark: '+fmt(item.calibratedBrier)));
    root.append(circle);
  });
}

function renderEvolution(rows,sel) {
  const items=horizonDiagnostics(rows,sel);
  drawProbabilityDistribution(items,sel);
  drawHorizonTrend('entropy-trend',items,'entropy','binary entropy',1,'#168a83');
  const maxBrier=Math.max(.1,Math.ceil(Math.max(0,...items.flatMap(x=>[x.brier,x.calibratedBrier]).filter(Number.isFinite))*10)/10);
  drawHorizonTrend('brier-trend',items,'brier','Brier score',maxBrier,'#b47737');
  overlayCalibrationBenchmark(items,maxBrier);
  const parent=byId('evolution-table');parent.replaceChildren();
  const table=document.createElement('table');
  const head=document.createElement('tr');
  ['Horizon','N','Mean entropy (bits)','Middle 25–75%','Extreme (<10%, >90%)','Brier','Calibrated benchmark'].forEach(t=>{
    const th=document.createElement('th');th.textContent=t;head.append(th);
  });
  const thead=document.createElement('thead');thead.append(head);table.append(thead);
  const body=document.createElement('tbody');
  items.forEach(item=>{
    const tr=document.createElement('tr');
    [item.label,String(item.n),fmt(item.entropy),pct(item.mid),pct(item.extreme),fmt(item.brier),fmt(item.calibratedBrier)].forEach((v,i)=>tr.append(td(v,i?'num':'')));
    body.append(tr);
  });
  table.append(body);parent.append(table);
  byId('evolution-note').textContent='All results use the current office, horizon, volume and cohort filters.'
    +(sel.matched?' Matched cohort selected.':' Forecast counts differ by horizon; trends may reflect changing sample composition.')
    +' The dashed benchmark is the expected Brier under calibrated forecasts, mean p(1−p); it is not a formal calibration-error decomposition. Minimum calibration-bin count is display-only.';
}

if(typeof document !== 'undefined' && typeof document.addEventListener==='function'){
  // A very fast cached JSON request might resolve before the deferred chart script.
  // Render again once all deferred scripts are loaded, without refreshing the page.
  document.addEventListener('DOMContentLoaded',()=>{
    if(records.length && typeof render==='function')render();
  });
}
