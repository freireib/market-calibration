'use strict';
// Additional diagnostics use the same cohort, horizons, and weighting as the calibration view.
function entropyBits(p) {
  return p===0||p===1 ? 0 : -p*Math.log2(p)-(1-p)*Math.log2(1-p);
}
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
// Gaussian KDE with reflections at 0 and 1. The density is per unit
// probability, normalized over [0,1], not a probability at a single point.
function estimateProbabilityKDE(rows,method,bandwidth,steps=240) {
  if(!(bandwidth>0&&bandwidth<=.5)||!Number.isInteger(steps)||steps<2)
    throw new Error('Invalid KDE bandwidth or resolution');
  const samples=rows.filter(r=>validP(r.probability)&&weightOf(r,method)>0);
  const totalWeight=samples.reduce((s,r)=>s+weightOf(r,method),0);
  if(!totalWeight)return [];
  const invH=1/bandwidth;
  const coefficient=1/(Math.sqrt(2*Math.PI)*bandwidth*totalWeight);
  const density=[];
  for(let i=0;i<=steps;i++){
    const x=i/steps;
    let total=0;
    for(const r of samples){
      const p=r.probability,w=weightOf(r,method);
      const a=(x-p)*invH,b=(x+p)*invH,c=(x-(2-p))*invH;
      total+=w*(Math.exp(-a*a/2)+Math.exp(-b*b/2)+Math.exp(-c*c/2));
    }
    density.push({x,y:total*coefficient});
  }
  // Correct the small finite-grid truncation/numerical-integration error.
  const area=density.reduce((sum,point,i)=>{
    return sum+point.y*((i===0||i===steps)?0.5:1);
  },0)/steps;
  if(area>0) density.forEach(point=>{point.y/=area;});
  return density;
}
function densityAxisCeiling(raw) {
  if(!(raw>0))return 1;
  const magnitude=Math.pow(10,Math.floor(Math.log10(raw)));
  const multiplier=[1,2,2.5,5,10].find(k=>k*magnitude>=raw);
  return (multiplier||10)*magnitude;
}
function drawProbabilityDistribution(items,sel) {
  const root=byId('probability-distribution');root.replaceChildren();
  const left=76,right=660,top=20,bottom=280;
  const bandwidth=Number(byId('kde-bandwidth').value)/100;
  const curves=items.map(item=>({...item,density:estimateProbabilityKDE(item.rows,sel.weight,bandwidth)}));
  const peak=Math.max(0,...curves.flatMap(c=>c.density.map(p=>p.y)));
  const upper=densityAxisCeiling(peak*1.05);
  const xx=p=>left+p*(right-left);
  const yy=d=>bottom-d/upper*(bottom-top);
  // Density, unlike observed fraction, can exceed one.
  for(let i=0;i<=4;i++){
    const d=upper*i/4,py=yy(d);
    root.append(svg('line',{x1:left,y1:py,x2:right,y2:py,stroke:'#dde8eb'}));
    root.append(svg('text',{x:left-10,y:py+4,'text-anchor':'end',fill:'#60737c','font-size':12},d.toFixed(upper<2?2:1)));
  }
  for(let i=0;i<=5;i++){
    const p=i/5,px=xx(p);
    root.append(svg('line',{x1:px,y1:top,x2:px,y2:bottom,stroke:'#eaf0f1'}));
    root.append(svg('text',{x:px,y:bottom+22,'text-anchor':'middle',fill:'#60737c','font-size':12},Math.round(p*100)+'%'));
  }
  root.append(svg('line',{x1:left,y1:bottom,x2:right,y2:bottom,stroke:'#96aab1'}));
  root.append(svg('text',{x:(left+right)/2,y:bottom+56,'text-anchor':'middle',fill:'#173140','font-size':14},'Forecast YES probability'));
  root.append(svg('text',{
    x:17,y:(top+bottom)/2,transform:'rotate(-90 17 '+((top+bottom)/2)+')',
    'text-anchor':'middle',fill:'#173140','font-size':13
  },'Density (per unit probability)'));
  const legend=byId('distribution-legend');legend.replaceChildren();
  let visible=0;
  for(const item of curves){
    if(!item.density.length)continue;
    visible++;
    const d=item.density.map((point,i)=>(i?'L':'M')+xx(point.x).toFixed(2)+','+yy(point.y).toFixed(2)).join(' ');
    const line=svg('path',{
      d,fill:'none',stroke:item.color,'stroke-width':3,'stroke-linecap':'round',
      'stroke-linejoin':'round',tabindex:0
    });
    line.append(svg('title',{},item.label+' | '+item.n+' forecasts | Gaussian KDE with '+Math.round(bandwidth*100)+' percentage-point bandwidth'));
    root.append(line);
    const entry=document.createElement('span');entry.className='legend-item';
    const swatch=document.createElement('span');swatch.className='legend-line';
    swatch.style.background=item.color;
    entry.append(swatch,document.createTextNode(item.label+' (n='+item.n+')'));
    legend.append(entry);
  }
  if(!visible)root.append(svg('text',{
    x:(left+right)/2,y:(top+bottom)/2,'text-anchor':'middle',fill:'#60737c','font-size':16
  },'No resolved forecasts for this selection'));
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
    const bandwidth=byId('kde-bandwidth');
    if(bandwidth)bandwidth.addEventListener('change',()=>{
      if(typeof renderCalibration==='function')renderCalibration();
    });
    if(records.length && typeof render==='function')render();
  });
}
