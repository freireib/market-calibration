'use strict';
// Market Calibration v0.1. Vanilla JS, no dependencies, no fabricated forecasts.
const HORIZONS = [
  {id:'two_months', label:'2 months', color:'#477ab4'},
  {id:'one_month', label:'1 month', color:'#bc8033'},
  {id:'one_day', label:'1 day', color:'#168a83'}
];
const NS = 'http://www.w3.org/2000/svg';
let dataset = {schema_version:1,records:[]}, records = [];
const $ = sel => document.querySelector(sel);
const byId = id => document.getElementById(id);
const getValue = id => byId(id).value;
const validP = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const validOutcome = v => v === 0 || v === 1;
const fmt = (v,d=3) => Number.isFinite(v) ? v.toFixed(d) : '—';
const pct = v => Number.isFinite(v) ? (100*v).toFixed(1)+'%' : '—';
const keyOf = r => String(r.provider)+'|'+String(r.event_id);
const horizonLabel = id => HORIZONS.find(h=>h.id===id)?.label || id;
const escapeCSV = value => '"'+String(value == null ? '' : value).replace(/"/g,'""')+'"';

function ingest(raw) {
  if (!raw || raw.schema_version !== 1 || !Array.isArray(raw.records)) {
    throw new Error('Expected schema_version: 1 and a records array.');
  }
  const ids = new Set();
  const cleaned = raw.records.map((row,i) => {
    if (!row || !row.provider || !row.event_id || !HORIZONS.some(h=>h.id===row.horizon)) {
      throw new Error('Invalid provider, event_id or horizon at row '+(i+1));
    }
    const prob = row.probability == null ? null : Number(row.probability);
    const out = row.outcome == null ? null : Number(row.outcome);
    const vol = row.volume_7d == null ? null : Number(row.volume_7d);
    if (prob !== null && !validP(prob)) throw new Error('Invalid probability at row '+(i+1));
    if (out !== null && !validOutcome(out)) throw new Error('Invalid outcome at row '+(i+1));
    if (vol !== null && (!Number.isFinite(vol) || vol < 0)) throw new Error('Invalid volume at row '+(i+1));
    const clean = {
      provider:String(row.provider), event_id:String(row.event_id),
      label:String(row.label || row.event_id), category:String(row.category || 'Other'),
      horizon:row.horizon, snapshot_utc:String(row.snapshot_utc || ''),
      probability:prob, outcome:out, volume_7d:vol,
      spread:row.spread == null ? null : Number(row.spread),
      outcome_status:String(row.outcome_status || (out === null ? 'uncalled' : 'resolved')),
      outcome_source:String(row.outcome_source || ''),
      market_ticker:String(row.market_ticker || '')
    };
    // A numeric outcome must have an explicit resolution status. Do not score leading races.
    if (clean.outcome !== null && !['called','certified','settled','resolved'].includes(clean.outcome_status)) {
      throw new Error('Outcome requires called/certified/settled/resolved status at row '+(i+1));
    }
    const id = keyOf(clean)+'|'+clean.horizon;
    if (ids.has(id)) throw new Error('Duplicate provider/event/horizon: '+id);
    ids.add(id);
    return clean;
  });
  dataset = raw;
  records = cleaned;
}

function selection() {
  return {
    horizons:new Set([...document.querySelectorAll('input[name="horizon"]:checked')].map(e=>e.value)),
    category:getValue('category'), weight:getValue('weight'),
    minVolume:Number(getValue('min-volume')),
    matched:byId('matched').checked,
    search:getValue('search-markets').trim().toLowerCase()
  };
}

function weightOf(r, method) {
  if (method === 'equal') return 1;
  const volume = r.volume_7d == null ? 0 : r.volume_7d;
  return method === 'sqrt' ? Math.sqrt(volume) : volume;
}
function eligibleRows(sel, scoredOnly=true) {
  let rows = records.filter(r =>
    sel.horizons.has(r.horizon) &&
    (sel.category === 'all' || r.category === sel.category) &&
    (sel.minVolume === 0 || (r.volume_7d !== null && r.volume_7d >= sel.minVolume)) &&
    (!scoredOnly || (validP(r.probability) && validOutcome(r.outcome)))
  );
  if (sel.matched) {
    // Compare the same event at all three horizons, with usable resolved forecasts.
    const mask = new Map();
    records.forEach(r => {
      if (validP(r.probability) && validOutcome(r.outcome) &&
          (sel.category === 'all' || r.category === sel.category) &&
          (sel.minVolume === 0 || (r.volume_7d !== null && r.volume_7d >= sel.minVolume))) {
        const k=keyOf(r); if (!mask.has(k)) mask.set(k,new Set()); mask.get(k).add(r.horizon);
      }
    });
    rows = rows.filter(r => (mask.get(keyOf(r))?.size || 0) === HORIZONS.length);
  }
  return rows;
}
function weightedMean(rows, valueFn, method) {
  let sum=0, wsum=0;
  rows.forEach(r=>{ const w=weightOf(r,method), value=valueFn(r);
    if (w>0 && Number.isFinite(value)) {sum+=w*value;wsum+=w;}
  });
  return wsum>0 ? sum/wsum : NaN;
}
function scoreRows(rows, method) {
  const positive = rows.filter(r=>weightOf(r,method)>0);
  return {n:positive.length, brier:weightedMean(positive,r=>(r.probability-r.outcome)**2,method),
    nEvents:new Set(positive.map(keyOf)).size};
}
function binRows(rows, method) {
  const bins = Array.from({length:10},()=>[]);
  rows.forEach(r=>{if (weightOf(r,method)>0) bins[Math.min(9,Math.floor(r.probability*10))].push(r);});
  return bins.map((group,i)=>{
    if (!group.length) return null;
    const ws=group.map(r=>weightOf(r,method));
    const total=ws.reduce((a,b)=>a+b,0), sumsq=ws.reduce((a,b)=>a+b*b,0);
    return {bin:i,n:group.length,x:weightedMean(group,r=>r.probability,method),
      y:weightedMean(group,r=>r.outcome,method),effectiveN:total*total/sumsq};
  }).filter(Boolean);
}
function wilson(p,n) {
  if (!(n>0)) return [0,1];
  const z=1.96, z2=z*z, den=1+z2/n;
  const c=(p+z2/(2*n))/den, d=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/den;
  return [Math.max(0,c-d),Math.min(1,c+d)];
}
function metric(label,value,detail) {
  const card=document.createElement('div');card.className='metric';
  const a=document.createElement('span');a.textContent=label;
  const b=document.createElement('strong');b.textContent=value;
  const c=document.createElement('small');c.textContent=detail;
  card.append(a,b,c);return card;
}
function svg(tag,attrs,content) {
  const node=document.createElementNS(NS,tag);
  Object.entries(attrs||{}).forEach(([k,v])=>node.setAttribute(k,String(v)));
  if (content !== undefined) node.textContent=content;
  return node;
}
function plot(grouped, sel) {
  const root=byId('calibration-plot');root.replaceChildren();
  const L=70,R=654,T=23,B=420;
  const x=v=>L+(R-L)*v, y=v=>B-(B-T)*v;
  for (let i=0;i<=10;i+=2) {
    const v=i/10;
    root.append(svg('line',{x1:L,y1:y(v),x2:R,y2:y(v),stroke:'#e1e9eb'}));
    root.append(svg('line',{x1:x(v),y1:T,x2:x(v),y2:B,stroke:'#e1e9eb'}));
    root.append(svg('text',{x:L-12,y:y(v)+4,'text-anchor':'end',fill:'#60737c','font-size':12},String(i*10)));
    root.append(svg('text',{x:x(v),y:B+20,'text-anchor':'middle',fill:'#60737c','font-size':12},String(i*10)));
  }
  root.append(svg('line',{x1:L,y1:B,x2:R,y2:T,stroke:'#617b82','stroke-dasharray':'7,6','stroke-width':1.8}));
  root.append(svg('rect',{x:L,y:T,width:R-L,height:B-T,fill:'none',stroke:'#aabfc5'}));
  root.append(svg('text',{x:(L+R)/2,y:467,'text-anchor':'middle',fill:'#173140','font-size':14},'Implied probability (%)'));
  root.append(svg('text',{x:18,y:(B+T)/2,transform:'rotate(-90 18 '+((B+T)/2)+')','text-anchor':'middle',fill:'#173140','font-size':14},'Observed event frequency (%)'));
  let count=0;
  for (const horizon of HORIZONS) {
    if (!sel.horizons.has(horizon.id)) continue;
    const points=grouped.get(horizon.id)||[];
    count += points.length;
    if (points.length>1) {
      root.append(svg('polyline',{points:points.map(p=>x(p.x)+','+y(p.y)).join(' '),
        fill:'none',stroke:horizon.color,'stroke-width':2.3,'stroke-linecap':'round','stroke-linejoin':'round'}));
    }
    for (const p of points) {
      const [lower,upper]=wilson(p.y,p.effectiveN);
      root.append(svg('line',{x1:x(p.x),x2:x(p.x),y1:y(lower),y2:y(upper),stroke:horizon.color,'stroke-width':1.7}));
      for (const limit of [lower,upper]) root.append(svg('line',{x1:x(p.x)-5,x2:x(p.x)+5,y1:y(limit),y2:y(limit),stroke:horizon.color,'stroke-width':1.6}));
      const circle=svg('circle',{cx:x(p.x),cy:y(p.y),r:Math.min(9,4+Math.sqrt(p.n)),fill:horizon.color,stroke:'white','stroke-width':1.5,tabindex:0});
      circle.append(svg('title',{},horizon.label+' | forecasts '+pct(p.x)+' | observed '+pct(p.y)+' | races '+p.n+' | effective N '+fmt(p.effectiveN,1)));
      root.append(circle);
    }
  }
  if (!count) root.append(svg('text',{x:(L+R)/2,y:227,class:'chart-empty'},'No resolved forecasts for this selection'));
  const legend=byId('legend');legend.replaceChildren();
  HORIZONS.filter(h=>sel.horizons.has(h.id)).forEach(h=>{
    const item=document.createElement('span');item.className='legend-item';
    const line=document.createElement('span');line.className='legend-line';line.style.background=h.color;
    item.append(line,document.createTextNode(h.label));legend.append(item);
  });
  byId('chart-note').textContent=sel.weight==='equal'
    ? 'Each race receives equal weight. Bars show approximate 95% Wilson intervals; circles scale with the number of races.'
    : 'Weighted frequencies use prior 7-day contract volume; Wilson intervals use effective sample size and are descriptive, not robust to correlated races.';
}
function renderScores(rows,sel) {
  const parent=byId('scores');parent.replaceChildren();
  const table=document.createElement('table');
  const head=document.createElement('thead');const hr=document.createElement('tr');
  ['Horizon','Scored races','Mean Brier','Mean probability','Mean outcome'].forEach(t=>{const th=document.createElement('th');th.textContent=t;hr.append(th);});
  head.append(hr);table.append(head);
  const body=document.createElement('tbody');
  for(const h of HORIZONS) {
    if(!sel.horizons.has(h.id))continue;
    const subset=rows.filter(r=>r.horizon===h.id && weightOf(r,sel.weight)>0);
    const score=scoreRows(subset,sel.weight), tr=document.createElement('tr');
    [h.label,String(score.n),fmt(score.brier),pct(weightedMean(subset,r=>r.probability,sel.weight)),
      pct(weightedMean(subset,r=>r.outcome,sel.weight))].forEach(t=>{const td=document.createElement('td');td.textContent=t;tr.append(td);});
    body.append(tr);
  }
  table.append(body);parent.append(table);
}
function renderCalibration() {
  const sel=selection(),rows=eligibleRows(sel,true);
  const positives=rows.filter(r=>weightOf(r,sel.weight)>0),scores=scoreRows(positives,sel.weight);
  const summary=byId('summary');summary.replaceChildren();
  summary.append(metric('Resolved events',String(scores.nEvents),'Unique markets across horizons'));
  summary.append(metric('Scored forecasts',String(scores.n),'One observation per market and horizon'));
  summary.append(metric('Mean Brier',fmt(scores.brier),'Lower is better · 0 is perfect'));
  const grouped=new Map();
  HORIZONS.forEach(h=>grouped.set(h.id,binRows(rows.filter(r=>r.horizon===h.id),sel.weight)));
  plot(grouped,sel);renderScores(rows,sel);
}
function td(text,className) {
  const cell=document.createElement('td');cell.textContent=text;
  if(className)cell.className=className;return cell;
}
function visibleMarketRows() {
  const sel=selection();return eligibleRows(sel,false).filter(r=>
    !sel.search || [r.label,r.event_id,r.provider,r.category,r.market_ticker].some(v=>v.toLowerCase().includes(sel.search))
  ).sort((a,b)=>a.label.localeCompare(b.label)||HORIZONS.findIndex(h=>h.id===a.horizon)-HORIZONS.findIndex(h=>h.id===b.horizon));
}
function renderMarkets() {
  const rows=visibleMarketRows(),root=byId('market-table');root.replaceChildren();
  if(!rows.length){root.textContent='No matching market observations. Add the dataset or change the filters.';return;}
  const table=document.createElement('table'),head=document.createElement('thead'),hr=document.createElement('tr');
  ['Race','Source','Office','Horizon','P(D)','Outcome','7d volume','Brier','Status'].forEach(s=>{const th=document.createElement('th');th.textContent=s;hr.append(th);});
  head.append(hr);table.append(head);
  const body=document.createElement('tbody');
  for(const r of rows.slice(0,700)) {
    const tr=document.createElement('tr');
    tr.append(td(r.label),td(r.provider),td(r.category),td(horizonLabel(r.horizon)),
      td(pct(r.probability),'num'),td(r.outcome===null?'—':(r.outcome===1?'Yes':'No')),
      td(r.volume_7d===null?'—':String(r.volume_7d),'num'),
      td(validP(r.probability)&&validOutcome(r.outcome)?fmt((r.probability-r.outcome)**2):'—','num'),
      td(r.outcome_status));
    body.append(tr);
  }
  table.append(body);root.append(table);
  if(rows.length>700){const p=document.createElement('p');p.textContent='Showing 700 of '+rows.length+' rows. CSV export includes all matching rows.';root.append(p);}
}
function exportCsv() {
  const cols=['provider','event_id','label','category','horizon','snapshot_utc','probability','outcome','volume_7d','spread','outcome_status','outcome_source','market_ticker'];
  const lines=[cols.map(escapeCSV).join(',')];
  visibleMarketRows().forEach(r=>lines.push(cols.map(k=>escapeCSV(r[k])).join(',')));
  const blob=new Blob([lines.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='market-calibration-observations.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function render() {
  const count=records.filter(r=>validP(r.probability)&&validOutcome(r.outcome)).length;
  const box=byId('dataset-status');
  box.dataset.state=count?'ready':'empty';
  box.textContent=count
    ? 'Dataset loaded: '+records.length+' observations, '+count+' scored forecasts. Source: '+(dataset.source||'local JSON')+'.'
    : 'No resolved historical forecasts loaded yet. The app is ready for data; the repository dataset is empty. You can import JSON under Methods & data.';
  byId('data-provenance').textContent='Source: '+(dataset.source||'not yet specified')+
    ' | Updated: '+(dataset.generated_at||'not yet populated')+' | Records: '+records.length;
  renderCalibration();renderMarkets();
}
async function loadRepository() {
  try{
    const response=await fetch('./data/observations.json?cache='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    ingest(await response.json());render();
  }catch(err){const box=byId('dataset-status');box.dataset.state='error';box.textContent='Could not load repository dataset: '+err.message+'. Try serving this folder via a local web server.';}
}
document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(t=>{const active=t===tab;t.classList.toggle('active',active);if(active)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current');});
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===tab.dataset.view));
}));
document.querySelectorAll('.controls input,.controls select,#search-markets').forEach(e=>e.addEventListener('input',render));
byId('export-csv').addEventListener('click',exportCsv);
byId('reset-data').addEventListener('click',loadRepository);
byId('data-file').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{ingest(JSON.parse(await file.text()));render();}
  catch(err){alert('Unable to import data: '+err.message);}
  e.target.value='';
});
loadRepository();
