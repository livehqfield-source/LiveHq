// OrderPilot MVP — standalone retailer post-order operations workspace.
// This first build is a demo prototype: data is in-memory and resets on refresh.
// Do not enter real customer information until authentication and durable storage are implemented.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export async function handleOrderPilot(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>OrderPilot · Live HQ</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#172033;background:#f4f6fa;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}.shell{min-height:100vh;display:grid;grid-template-columns:244px 1fr}
aside{background:#111c31;color:#e9eef9;padding:25px 16px;display:flex;flex-direction:column;gap:26px}
.brand{font-size:20px;font-weight:800;letter-spacing:-.7px;padding:0 10px}.brand span{color:#69a7ff}
.tag{font-size:10px;color:#8fa2c4;text-transform:uppercase;letter-spacing:1.5px;margin:0 10px 8px}
nav{display:grid;gap:5px}nav button{border:0;background:transparent;color:#aebbd2;text-align:left;padding:11px 12px;border-radius:9px;font:600 13px inherit;cursor:pointer}
nav button.active,nav button:hover{background:#223451;color:#fff}.navicon{display:inline-block;width:23px;color:#8bb8ff}
.aside-foot{margin-top:auto;color:#8798b5;font-size:11px;line-height:1.6;padding:0 10px}
main{min-width:0;padding:28px clamp(18px,4vw,48px) 50px;max-width:1500px;width:100%;margin:auto}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:27px}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:#71809a;font-weight:700}
h1{font-size:27px;letter-spacing:-.8px;margin:5px 0 4px}.sub{font-size:13px;color:#748097}
.topright{display:flex;align-items:center;gap:10px}.demo{font-size:11px;background:#fff5df;color:#93621b;padding:7px 10px;border-radius:20px;font-weight:700}
button,.btn{cursor:pointer}.primary{background:#2463d4;color:#fff;border:0;border-radius:9px;padding:10px 14px;font-weight:700;font-size:12px}.primary:hover{background:#174eaf}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:22px}
.card,.panel{background:white;border:1px solid #e7ebf2;border-radius:13px;padding:18px;box-shadow:0 2px 8px #17203308}
.metric-label{font-size:12px;color:#77839a}.metric{font-size:28px;font-weight:800;letter-spacing:-1px;margin:8px 0 3px}.metric-note{font-size:11px;color:#7d899e}
.columns{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);gap:16px}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:15px}
h2{font-size:15px;margin:0;letter-spacing:-.2px}.muted{color:#8190a6;font-size:12px}
table{border-collapse:collapse;width:100%;font-size:12px}th{text-align:left;color:#8994a7;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.6px;padding:10px 8px;border-bottom:1px solid #edf0f5}
td{padding:12px 8px;border-bottom:1px solid #f0f2f6;color:#354158}tr:last-child td{border:0}
.status{display:inline-block;padding:5px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;background:#edf2fb;color:#47628d}
.status.Open,.status.Delayed{background:#fff0e8;color:#b45b2d}.status.Resolved,.status.Delivered{background:#e7f7ee;color:#27804e}.status.In.progress,.status.Processing{background:#eaf1ff;color:#3868b5}
.priority{font-weight:700}.high{color:#c45a3d}.medium{color:#ad812d}.low{color:#64806e}
.activity{display:grid;gap:15px}.activity-item{display:grid;grid-template-columns:9px 1fr;gap:10px;font-size:12px;color:#59667d;line-height:1.5}.dot{width:8px;height:8px;border-radius:50%;background:#4d86e8;margin-top:4px}
.toolbar{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px}.search,select,input,textarea{border:1px solid #dfe5ee;border-radius:8px;padding:10px 11px;font:inherit;font-size:12px;background:#fff;color:#263249}
.search{min-width:220px;flex:1}.tablewrap{overflow:auto}.empty{text-align:center;color:#8a95a8;padding:30px}
.page{display:none}.page.active{display:block}
.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:grid;gap:6px}.field label{font-size:11px;color:#66748c;font-weight:700}.field input,.field select,.field textarea{width:100%}.field.full{grid-column:1/-1}.field textarea{min-height:75px;resize:vertical}
.modal{position:fixed;inset:0;background:#111c3180;display:none;align-items:center;justify-content:center;padding:18px;z-index:5}.modal.show{display:flex}.dialog{background:#fff;border-radius:15px;padding:22px;width:min(540px,100%);max-height:90vh;overflow:auto}.dialoghead{display:flex;justify-content:space-between;align-items:center;margin-bottom:17px}.close{border:0;background:#f0f3f8;border-radius:7px;padding:7px 10px}
.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.secondary{background:#eef2f8;color:#52617a;border:0;border-radius:8px;padding:10px 13px;font-weight:700;font-size:12px}
.notice{border:1px solid #f2dfb5;background:#fff9eb;color:#846126;padding:12px 14px;border-radius:10px;font-size:11px;line-height:1.5;margin-bottom:18px}
.reportgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.reportbar{height:8px;background:#edf1f7;border-radius:9px;overflow:hidden;margin:10px 0}.reportbar span{display:block;height:100%;background:#4d82df;border-radius:9px}
@media(max-width:900px){.shell{grid-template-columns:1fr}aside{padding:13px 15px;gap:12px}.brand{padding:3px 7px}aside .tag,.aside-foot{display:none}nav{display:flex;overflow:auto}nav button{white-space:nowrap;padding:9px 11px}.cards{grid-template-columns:repeat(2,1fr)}.columns{grid-template-columns:1fr}}
@media(max-width:520px){main{padding:20px 13px}.top{align-items:flex-start;flex-direction:column}.topright{width:100%;justify-content:space-between}.cards{gap:9px}.card{padding:14px}.metric{font-size:24px}.formgrid{grid-template-columns:1fr}.field.full{grid-column:auto}.reportgrid{grid-template-columns:1fr}}
</style></head><body>
<div class="shell"><aside><div class="brand">Order<span>Pilot</span></div>
<div><div class="tag">Workspace</div><nav id="nav">
<button class="active" data-page="overview"><span class="navicon">◫</span>Overview</button>
<button data-page="cases"><span class="navicon">▤</span>Customer cases</button>
<button data-page="deliveries"><span class="navicon">↗</span>Delivery follow-ups</button>
<button data-page="returns"><span class="navicon">↩</span>Returns & complaints</button>
<button data-page="reports"><span class="navicon">▥</span>Reports</button></nav></div>
<div class="aside-foot">A Live HQ product<br>Post-order support, under control.</div></aside>
<main><header class="top"><div><div class="eyebrow">Retail operations</div><h1 id="heading">Good morning</h1><div class="sub">Keep every customer order moving.</div></div><div class="topright"><span class="demo">DEMO DATA ONLY</span><button class="primary" id="newCase">+ New case</button></div></header>
<div class="notice"><b>Prototype mode:</b> This workspace uses fictional sample records held only in this browser session. Do not enter real customer details. Secure retailer accounts, database storage and integrations are not connected yet.</div>
<section class="page active" id="page-overview">
<div class="cards" id="metrics"></div><div class="columns">
<div class="panel"><div class="panel-head"><h2>Recent customer cases</h2><button class="secondary" data-go="cases">View all</button></div><div class="tablewrap"><table><thead><tr><th>Case</th><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th></tr></thead><tbody id="recentRows"></tbody></table></div></div>
<div class="panel"><div class="panel-head"><h2>Needs attention</h2><span class="muted">Action queue</span></div><div class="activity" id="attention"></div></div></div></section>
<section class="page" id="page-cases"><div class="panel"><div class="panel-head"><h2>Customer cases</h2><span class="muted" id="caseCount"></span></div><div class="toolbar"><input class="search" id="caseSearch" placeholder="Search case, customer or order…"><select id="caseStatus"><option value="">All statuses</option><option>Open</option><option>In progress</option><option>Waiting</option><option>Resolved</option></select><select id="casePriority"><option value="">All priorities</option><option>High</option><option>Medium</option><option>Low</option></select></div><div class="tablewrap"><table><thead><tr><th>Case ID</th><th>Customer</th><th>Order</th><th>Category</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody id="caseRows"></tbody></table></div></div></section>
<section class="page" id="page-deliveries"><div class="panel"><div class="panel-head"><h2>Delivery follow-ups</h2><span class="muted">Track exceptions before customers chase</span></div><div class="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Courier</th><th>Tracking ref</th><th>Delivery status</th><th>Follow-up</th></tr></thead><tbody id="deliveryRows"></tbody></table></div></div></section>
<section class="page" id="page-returns"><div class="panel"><div class="panel-head"><h2>Returns & complaints</h2><span class="muted">Review and record next steps</span></div><div class="tablewrap"><table><thead><tr><th>Case</th><th>Customer</th><th>Reason</th><th>Order</th><th>Status</th><th></th></tr></thead><tbody id="returnRows"></tbody></table></div></div></section>
<section class="page" id="page-reports"><div class="panel"><div class="panel-head"><h2>Service snapshot</h2><button class="primary" id="exportCsv">Export cases CSV</button></div><div class="reportgrid" id="reportMetrics"></div><div style="margin-top:25px"><h2>Case status mix</h2><div id="statusBars"></div></div></div></section>
</main></div>
<div class="modal" id="caseModal"><div class="dialog"><div class="dialoghead"><h2 id="modalTitle">Create customer case</h2><button class="close" id="closeModal">✕</button></div>
<form id="caseForm"><div class="formgrid">
<div class="field"><label>Customer name</label><input name="customer" required maxlength="80" placeholder="Demo customer"></div>
<div class="field"><label>Order number</label><input name="order" required maxlength="40" placeholder="e.g. ORD-2048"></div>
<div class="field"><label>Issue category</label><select name="category"><option>Delivery delay</option><option>Missing parcel</option><option>Damaged item</option><option>Return / refund</option><option>Product enquiry</option><option>Other</option></select></div>
<div class="field"><label>Priority</label><select name="priority"><option>Medium</option><option>High</option><option>Low</option></select></div>
<div class="field"><label>Status</label><select name="status"><option>Open</option><option>In progress</option><option>Waiting</option><option>Resolved</option></select></div>
<div class="field"><label>Courier (optional)</label><input name="courier" maxlength="60" placeholder="Courier name"></div>
<div class="field full"><label>Issue summary</label><textarea name="summary" maxlength="500" placeholder="Describe the customer's issue…" required></textarea></div>
</div><div class="actions"><button type="button" class="secondary" id="cancelModal">Cancel</button><button class="primary" type="submit">Save demo case</button></div></form></div></div>
<script>
const initial = [
{id:'OP-1001',customer:'Taylor M.',order:'ORD-4821',category:'Delivery delay',priority:'High',status:'Open',courier:'Fastway',tracking:'FW-883019',follow:'Today',summary:'Parcel has not moved for 3 days.'},
{id:'OP-1002',customer:'Sam K.',order:'ORD-4814',category:'Damaged item',priority:'Medium',status:'In progress',courier:'The Courier Guy',tracking:'TCG-229104',follow:'Tomorrow',summary:'Customer received a damaged outer box.'},
{id:'OP-1003',customer:'Alex R.',order:'ORD-4799',category:'Return / refund',priority:'Low',status:'Waiting',courier:'',tracking:'',follow:'Friday',summary:'Awaiting returned item.'},
{id:'OP-1004',customer:'Jamie P.',order:'ORD-4788',category:'Missing parcel',priority:'High',status:'Open',courier:'PUDO',tracking:'PD-551802',follow:'Today',summary:'Delivery marked complete but not received.'},
{id:'OP-1005',customer:'Morgan D.',order:'ORD-4772',category:'Product enquiry',priority:'Low',status:'Resolved',courier:'',tracking:'',follow:'—',summary:'Product specification question answered.'}
];
let cases = initial.map(x=>({...x}));
const $ = id=>document.getElementById(id);
const esc = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const status = s=>'<span class="status '+esc(s)+'">'+esc(s)+'</span>';
const priority = p=>'<span class="priority '+p.toLowerCase()+'">'+esc(p)+'</span>';
function metrics(){const open=cases.filter(c=>c.status!=='Resolved').length, urgent=cases.filter(c=>c.priority==='High'&&c.status!=='Resolved').length, delivery=cases.filter(c=>c.category.toLowerCase().includes('delivery')||c.category.toLowerCase().includes('parcel')).length, resolved=cases.filter(c=>c.status==='Resolved').length;
$('metrics').innerHTML=[['Open cases',open,'Require a next action'],['High priority',urgent,'Prioritise these first'],['Delivery issues',delivery,'Parcels and courier queries'],['Resolved',resolved,'Closed in this demo']].map(([a,b,c])=>'<div class="card"><div class="metric-label">'+a+'</div><div class="metric">'+b+'</div><div class="metric-note">'+c+'</div></div>').join('');
$('reportMetrics').innerHTML=[['Total cases',cases.length],['Open / active',open],['Resolved',resolved]].map(([a,b])=>'<div class="card"><div class="metric-label">'+a+'</div><div class="metric">'+b+'</div></div>').join('');
const statuses=['Open','In progress','Waiting','Resolved'];$('statusBars').innerHTML=statuses.map(s=>{const n=cases.filter(c=>c.status===s).length;return '<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:13px"><span>'+s+'</span><b>'+n+'</b></div><div class="reportbar"><span style="width:'+(cases.length?n/cases.length*100:0)+'%"></span></div>'}).join('');
}
function row(c,detail=false){return '<tr><td><b>'+esc(c.id)+'</b></td><td>'+esc(c.customer)+'</td><td>'+esc(c.order)+'</td><td>'+esc(c.category)+'</td><td>'+priority(c.priority)+'</td><td>'+status(c.status)+'</td><td><button class="secondary" data-edit="'+esc(c.id)+'">Open</button></td></tr>'}
function render(){metrics();$('recentRows').innerHTML=cases.slice(0,5).map(c=>'<tr><td><b>'+esc(c.id)+'</b></td><td>'+esc(c.customer)+'</td><td>'+esc(c.category)+'</td><td>'+priority(c.priority)+'</td><td>'+status(c.status)+'</td></tr>').join('');
const q=$('caseSearch').value.toLowerCase(), st=$('caseStatus').value, pr=$('casePriority').value;
const filtered=cases.filter(c=>(!q||[c.id,c.customer,c.order,c.category].join(' ').toLowerCase().includes(q))&&(!st||c.status===st)&&(!pr||c.priority===pr));
$('caseRows').innerHTML=filtered.length?filtered.map(row).join(''):'<tr><td colspan="7" class="empty">No matching cases.</td></tr>';$('caseCount').textContent=filtered.length+' shown';
const ds=cases.filter(c=>c.tracking);$('deliveryRows').innerHTML=ds.map(c=>'<tr><td><b>'+esc(c.order)+'</b></td><td>'+esc(c.customer)+'</td><td>'+esc(c.courier)+'</td><td>'+esc(c.tracking)+'</td><td>'+status(c.category==='Delivery delay'?'Delayed':c.status)+'</td><td>'+esc(c.follow)+'</td></tr>').join('')||'<tr><td colspan="6" class="empty">No delivery follow-ups.</td></tr>';
const rs=cases.filter(c=>c.category==='Return / refund'||c.category==='Damaged item');$('returnRows').innerHTML=rs.map(c=>'<tr><td><b>'+esc(c.id)+'</b></td><td>'+esc(c.customer)+'</td><td>'+esc(c.category)+'</td><td>'+esc(c.order)+'</td><td>'+status(c.status)+'</td><td><button class="secondary" data-edit="'+esc(c.id)+'">Open</button></td></tr>').join('')||'<tr><td colspan="6" class="empty">No returns or complaints.</td></tr>';
const attention=cases.filter(c=>c.status!=='Resolved').sort((a,b)=>(a.priority==='High'?-1:0)-(b.priority==='High'?-1:0)).slice(0,4);
$('attention').innerHTML=attention.map(c=>'<div class="activity-item"><span class="dot"></span><div><b>'+esc(c.id)+' · '+esc(c.order)+'</b><br>'+esc(c.summary)+'<br><span class="muted">'+esc(c.status)+' · '+esc(c.follow)+'</span></div></div>').join('')||'<div class="muted">Nothing needs attention.</div>';
}
function go(page){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+page));document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));$('heading').textContent=({overview:'Good morning',cases:'Customer cases',deliveries:'Delivery follow-ups',returns:'Returns & complaints',reports:'Reports'})[page];}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$('newCase').onclick=()=>{$('caseForm').reset();$('caseModal').classList.add('show')};['closeModal','cancelModal'].forEach(id=>$(id).onclick=()=>$('caseModal').classList.remove('show'));
$('caseForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),n=1001+cases.length;cases.unshift({id:'OP-'+n,customer:f.get('customer'),order:f.get('order'),category:f.get('category'),priority:f.get('priority'),status:f.get('status'),courier:f.get('courier'),tracking:'',follow:'Today',summary:f.get('summary')});$('caseModal').classList.remove('show');go('cases');render()};
['caseSearch','caseStatus','casePriority'].forEach(id=>$(id).addEventListener(id==='caseSearch'?'input':'change',render));
document.addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(!b)return;const c=cases.find(x=>x.id===b.dataset.edit);if(!c)return;const next=prompt('Update status for '+c.id+'\nEnter: Open, In progress, Waiting or Resolved',c.status);if(['Open','In progress','Waiting','Resolved'].includes(next)){c.status=next;render()}});
$('exportCsv').onclick=()=>{const cols=['id','customer','order','category','priority','status','courier','tracking','follow','summary'];const csv=[cols.join(','),...cases.map(c=>cols.map(k=>'"'+String(c[k]??'').replace(/"/g,'""')+'"').join(','))].join('\r\n');const a=document.createElement('a'),u=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.href=u;a.download='orderpilot-demo-cases.csv';a.click();URL.revokeObjectURL(u)};
render();
</script></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" } });
}
