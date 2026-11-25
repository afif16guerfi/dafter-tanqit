/* ===== وحدة الدفتر اليومي (Cahier Journal) =====
   وحدة مستقلة عن دفتر التنقيط: تقرأ أقسام الأستاذ من الحالة الموجودة (S.cl) ولا تعدّلها، وتخزّن بياناتها في مجموعات منفصلة
   على الخادم (/api/cj/*): الجداول الزمنية، الدروس (وثيقة لكل موسم+تاريخ+حصة)، وإعدادات الألوان.
   التواريخ نصوص YYYY-MM-DD تُحسب بتوقيت UTC فلا تتأثر بالمنطقة الزمنية ولا بالتوقيت الصيفي.
   الأسبوع: الأحد → الخميس. كل شيء داخل دالة معزولة ولا يُعرَّف في النطاق العام سوى: modNav, cjView, cjGo, CJH, CJ_PCSS. */
(function(){
'use strict';
const DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس'],
 SL=[{id:'m1',n:'الحصة الأولى',a:'08:00',b:'09:00',p:0},{id:'m2',n:'الحصة الثانية',a:'09:00',b:'10:00',p:0},{id:'m3',n:'الحصة الثالثة',a:'10:00',b:'11:00',p:0},{id:'m4',n:'الحصة الرابعة',a:'11:00',b:'12:00',p:0},
  {id:'a1',n:'الحصة الأولى',a:'14:00',b:'15:00',p:1},{id:'a2',n:'الحصة الثانية',a:'15:00',b:'16:00',p:1},{id:'a3',n:'الحصة الثالثة',a:'16:00',b:'17:00',p:1}],
 PAL=['#e53935','#d81b60','#8e24aa','#5e35b1','#3949ab','#1e88e5','#039be5','#00acc1','#00897b','#43a047','#7cb342','#c0ca33','#fdd835','#ffb300','#fb8c00','#f4511e','#6d4c41','#546e7a'],
 MAXD='9999-12-31';
/* ---------- التواريخ ---------- */
const dp=s=>Date.parse(s+'T00:00:00Z'),isD=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(dp(s))&&new Date(dp(s)).toISOString().slice(0,10)===s,
 dAdd=(s,n)=>new Date(dp(s)+n*864e5).toISOString().slice(0,10),dow=s=>new Date(dp(s)).getUTCDay(),wk0=s=>dAdd(s,-dow(s)),fd=s=>s?s.split('-').reverse().join('/'):'',
 tod=()=>{const d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())},
 curWk=()=>{const t=tod(),w=wk0(t);return dow(t)>=5?dAdd(w,7):w},   // الجمعة والسبت: نعرض الأسبوع القادم
 ovl=(a,b)=>a.start<=(b.end||MAXD)&&b.start<=(a.end||MAXD);
/* ---------- الألوان ---------- */
const hx=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),tint=(h,a)=>'#'+hx(h).map(v=>Math.round(255+(v-255)*a).toString(16).padStart(2,'0')).join(''),
 hash=s=>{let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))>>>0;return h};
/* ---------- الحالة ---------- */
let st=null,L=null,SE=null,EX=null;
const newSt=()=>({uid:ME.id,season:nz(S.p.season||''),week:curWk(),sch:[],colors:new Map(),hidden:new Set(),cat:[],dates:[],lessons:new Map(),loaded:new Set(),ready:false,err:'',tok:0,loading:false,base:nz(S.p.season||'')});
async function ca(p,m,b){m=m||'GET';const r=await fetch('/api/cj'+p,{method:m,keepalive:m==='PUT'||m==='DELETE',headers:{'Content-Type':'application/json',...(TK?{Authorization:'Bearer '+TK}:{})},body:b?JSON.stringify(b):undefined});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||'خطأ في الاتصال'),{status:r.status,data:j});return j}
const fail=e=>{if(e&&e.status===401){alert(e.message);location.reload();return}toast((e&&e.message)||'حدث خطأ','er',6000)};
const qs=o=>Object.keys(o).map(k=>k+'='+encodeURIComponent(o[k])).join('&');
/* ---------- الأقسام والألوان ---------- */
function allSecs(){const m=new Map(),add=n=>{n=nz(n);if(n&&!m.has(nk(n)))m.set(nk(n),n)};
 (S.cl||[]).forEach(c=>{if(nz(c.season)===st.season&&!c.ar)add(c.name)});st.sch.forEach(s=>Object.values(s.cells).forEach(add));
 return[...m.values()].sort((a,b)=>a.localeCompare(b,'ar'))}
const actSecs=()=>allSecs().filter(n=>!st.hidden.has(nk(n))),color=n=>st.colors.get(nk(n))||PAL[hash(nk(n))%PAL.length];
const seasons=()=>[...new Set([st.season,...(S.cl||[]).map(c=>nz(c.season))].filter(Boolean))].sort().reverse();
/* ---------- تحميل البيانات ---------- */
function applyBoot(j){st.sch=j.schedules||[];st.colors=new Map((j.colors||[]).map(x=>[nk(x.n),x.c]));st.hidden=new Set((j.hidden||[]).map(nk));st.cat=j.catalog||[];st.dates=j.dates||[]}
async function load(){if(st.loading)return;st.loading=true;const t=++st.tok;try{applyBoot(await ca('/boot?'+qs({season:st.season})));st.ready=true;st.err=''}catch(e){st.err=e.message;if(e.status===401){st.loading=false;return fail(e)}}
 st.loading=false;if(t!==st.tok)return;draw();if(st.ready)ensureWk()}
async function reloadBoot(){applyBoot(await ca('/boot?'+qs({season:st.season})))}
async function refreshCat(){try{const j=await ca('/catalog?'+qs({season:st.season}));st.cat=j.catalog;st.dates=j.dates}catch(e){}}
async function fetchLessons(from,to){return(await ca('/lessons?'+qs({season:st.season,from,to}))).list}
async function ensureWk(){const w=st.week;if(st.loaded.has(w))return;try{const l=await fetchLessons(w,dAdd(w,4));
  for(let i=0;i<5;i++)SL.forEach(s=>st.lessons.delete(dAdd(w,i)+'|'+s.id));l.forEach(x=>st.lessons.set(x.date+'|'+x.slot,x));st.loaded.add(w);if(st.week===w)draw()}catch(e){fail(e)}}
/* ---------- بيانات الخلية: الجدول الساري في ذلك التاريخ + الدرس المسجل (إن وُجد، وهو يحمل اسم قسمه الخاص) ---------- */
const schFor=(d,sch)=>(sch||st.sch).filter(s=>s.start<=d&&d<=(s.end||MAXD)).sort((a,b)=>b.start.localeCompare(a.start))[0]||null;
function cellData(date,slot,lm,sch){const l=lm.get(date+'|'+slot),sc=schFor(date,sch),sec=l?l.section:((sc&&sc.cells[dow(date)+'_'+slot])||'');return{l,sc,sec,date,slot}}
/* ---------- رسم الجدول الأسبوعي (للشاشة وللطباعة/PDF) ---------- */
function cellInner(d,mode){const l=d.l,pr=mode==='pr';if(!d.sec&&!l)return pr?'':'<span class="cjplus">＋</span>';
 let h=`<div class="cjs">${esc(d.sec)}</div>`;
 if(l&&l.absent)h+='<div class="cjab">ظرف الغياب</div>';
 else if(l){if(l.axis)h+=`<div class="cja">${pr?'المحور: ':''}${esc(l.axis)}</div>`;if(l.topic)h+=`<div class="cjt">${pr?'الموضوع: ':''}${l.cont?'تابع لدرس ':''}${esc(l.topic)}</div>`;
  if(l.items.length)h+=pr?'<ul class="cji">'+l.items.map(x=>`<li>${esc(x)}</li>`).join('')+'</ul>':`<div class="cjn">☰ ${l.items.length} عناصر</div>`}
 else if(!pr)h+='<div class="cjhint">لم يُسجَّل الدرس</div>';return h}
function cellEl(d,mode){const pr=mode==='pr',cl=d.l?(d.l.absent?'abs':'done'):(d.sec?'sched':'empty'),c=d.sec?color(d.sec):'',
 sty=d.sec?` style="--c:${c};--t:${tint(c,.2)}"`:'',cls='cjc '+cl+(d.sec?' has':'');
 return pr?`<div class="${cls}"${sty}>${cellInner(d,mode)}</div>`
  :`<div class="${cls}"${sty} tabindex="0" role="button" aria-label="${esc(d.sec||'حصة فارغة')} ${fd(d.date)}" onclick="CJH.open('${d.date}','${d.slot}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();CJH.open('${d.date}','${d.slot}')}">${cellInner(d,mode)}</div>`}
function grid(week,mode,lm,sch){const days=[0,1,2,3,4].map(i=>dAdd(week,i)),t=tod();
 let h=`<div class="cjg ${mode}"><div class="cjh cjco"></div>`+days.map((d,i)=>`<div class="cjh${mode==='app'&&d===t?' today':''}"><b>${DAYS[i]}</b><span>${fd(d)}</span></div>`).join('');
 SL.forEach((s,k)=>{if(k===4)h+='<div class="cjsp"></div>';
  h+=`<div class="cjl${s.p?' pm':''}">${k===0?'<i>الفترة الصباحية</i>':k===4?'<i>الفترة المسائية</i>':''}<b>${s.n}</b><span><bdi dir="ltr">${s.a} – ${s.b}</bdi></span></div>`;
  days.forEach(d=>{h+=cellEl(cellData(d,s.id,lm,sch),mode)})});return h+'</div>'}
function mobile(week){const days=[0,1,2,3,4].map(i=>dAdd(week,i)),t=tod();
 return'<div class="cjmob">'+days.map((d,i)=>`<div class="cjmd"><div class="cjmh${d===t?' today':''}"><b>${DAYS[i]}</b><span>${fd(d)}</span></div>`+SL.map(s=>`<div class="cjmr${s.p?' pm':''}"><div class="cjml"><b>${s.n}${s.p?' (مساءً)':''}</b><span><bdi dir="ltr">${s.a} – ${s.b}</bdi></span></div>${cellEl(cellData(d,s.id,st.lessons),'app')}</div>`).join('')+'</div>').join('')+'</div>'}
const wkTitle=w=>`الأسبوع من الأحد ${fd(w)} إلى الخميس ${fd(dAdd(w,4))}`,
 schLabel=s=>`«${esc(s.name)}» (${fd(s.start)} ← ${s.end?fd(s.end):'مفتوح'})`;
/* ---------- الشاشة الرئيسية للوحدة ---------- */
const IC={tq:'<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
 cj:'<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h3M8 18h6"/></svg>'};
window.modNav=a=>`<div class="modnav noprint"><button class="g ${a==='tq'?'on':''}" onclick="CJH.nav('tq')" aria-label="دفتر التنقيط">${IC.tq}<span>دفتر التنقيط<small>النقاط والمعدلات والإحصائيات</small></span></button><button class="g ${a==='cj'?'on':''}" onclick="CJH.nav('cj')" aria-label="الدفتر اليومي">${IC.cj}<span>الدفتر اليومي<small>الجداول الزمنية والدروس الأسبوعية</small></span></button></div>`;
window.cjGo=()=>{cur=null;nsOn=false;cjOn=true;render();scrollTo(0,0)};
window.cjView=()=>{if(!st||st.uid!==ME.id||st.base!==nz(S.p.season||'')){st=newSt();L=SE=EX=null}$('#hs').textContent=S.p.name?('الأستاذ: '+S.p.name):'';$('#app').style.maxWidth='1500px';
 if(!st.season)return void($('#app').innerHTML=window.modNav('cj')+'<div class="card"><h2>الدفتر اليومي</h2><p>حدّد «الموسم الدراسي» من الصفحة الرئيسية (بيانات الأستاذ) أولاً، ثم عُد إلى الدفتر اليومي.</p></div>');
 draw();if(!st.ready&&!st.err)load();else if(st.ready)ensureWk()};
function draw(){if(!cjOn||!st||ME.role==='admin')return;const w=st.week,days=[0,1,2,3,4].map(i=>dAdd(w,i)),isCur=w===curWk(),
 used=[...new Set(days.map(d=>schFor(d)).filter(Boolean))];
 let h=window.modNav('cj');
 h+=`<div class="card noprint cjbar"><div class="row"><label class="fit cjlab">الموسم الدراسي</label><select class="fit" onchange="CJH.season(this.value)" aria-label="الموسم">${seasons().map(s=>`<option ${s===st.season?'selected':''}>${esc(s)}</option>`).join('')}</select>
<button class="fit" onclick="CJH.schList()">🗓 الجداول الزمنية</button><button class="fit g" onclick="CJH.colors()">🎨 الأقسام والألوان</button><button class="fit g" onclick="CJH.weeks()">📚 مراجعة الأسابيع</button><button class="fit g" onclick="CJH.exp()">⬇ تصدير / طباعة</button></div></div>`;
 if(st.err&&!st.ready)h+=`<div class="card"><p class="er">${esc(st.err)}</p><button onclick="CJH.retry()">إعادة المحاولة</button></div>`;
 else if(!st.ready)h+='<div class="card"><p class="mut">جارٍ تحميل الدفتر اليومي…</p></div>';
 else{
  h+=`<div class="card noprint cjnav"><div class="cjttl"><b>${wkTitle(w)}</b><span class="mut">${isCur?'الأسبوع الحالي':''}</span></div><div class="row cjnb">
<button class="fit g" onclick="CJH.week(-1)" aria-label="الأسبوع السابق">› الأسبوع السابق</button><button class="fit g" onclick="CJH.week(1)" aria-label="الأسبوع التالي">الأسبوع التالي ‹</button><button class="fit ${isCur?'g':''}" onclick="CJH.today()">الأسبوع الحالي</button>
<input class="fit" type="date" value="${days[0]}" onchange="CJH.goto(this.value)" aria-label="الانتقال إلى تاريخ">
</div>`;
  if(!st.sch.length)h+='<div class="cjwarn">لا يوجد أي جدول زمني بعد. <button class="fit" onclick="CJH.newS()">أنشئ جدولك الأول</button></div>';
  else if(!used.length)h+='<div class="cjwarn">لا يوجد جدول زمني ساري في هذا الأسبوع. <button class="fit" onclick="CJH.newS()">إنشاء جدول</button></div>';
  else h+=`<div class="mut cjsi">الجدول الساري: ${used.map(schLabel).join(' ، ')}</div>`;
  h+='</div>';
  if(!allSecs().length)h+='<div class="card"><p class="mut">لا توجد أقسام لهذا الموسم. أنشئ أقسامك من «دفتر التنقيط» (الموسم '+esc(st.season)+') وستظهر هنا تلقائياً.</p></div>';
  h+=st.loaded.has(w)?`<div class="cjbd">${grid(w,'app',st.lessons)}${mobile(w)}</div>`:'<div class="card"><p class="mut">جارٍ تحميل حصص الأسبوع…</p></div>'}
 $('#app').innerHTML=h}
/* ---------- نوافذ منبثقة ---------- */
function modal(html,wide){let m=document.getElementById('cjm');if(!m){m=document.createElement('div');m.id='cjm';m.className='cjov noprint';document.body.appendChild(m);m.addEventListener('mousedown',e=>{if(e.target===m)m._dn=1;else m._dn=0});m.addEventListener('click',e=>{if(e.target===m&&m._dn)CJH.cl()})}
 m.innerHTML=`<div class="box${wide?' wide':''}" role="dialog" aria-modal="true">${html}</div>`;return m}
const mclose=()=>{const m=document.getElementById('cjm');if(m)m.remove()};
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('cjm'))CJH.cl()});
const stat=t=>{const e=document.getElementById('cjst');if(e)e.textContent=t};
/* ---------- نافذة الحصة ---------- */
const prevTopics=sec=>{const m=new Map();st.cat.filter(x=>nk(x.section)===nk(sec)&&x.topic).sort((a,b)=>b.last.localeCompare(a.last)).forEach(x=>{const k=nk(x.axis)+'|'+nk(x.topic);if(!m.has(k))m.set(k,x)});return[...m.values()]},
 prevAxes=sec=>{const m=new Map();st.cat.filter(x=>nk(x.section)===nk(sec)&&x.axis).sort((a,b)=>b.last.localeCompare(a.last)).forEach(x=>{if(!m.has(nk(x.axis)))m.set(nk(x.axis),x.axis)});return[...m.values()]};
function lessonOpen(date,slot){if(!st.ready||!st.loaded.has(st.week))return;const l=st.lessons.get(date+'|'+slot),d=cellData(date,slot,st.lessons);
 L={date,slot,exist:!!l,section:d.sec,axis:l?l.axis:'',topic:l?l.topic:'',cont:l?l.cont:false,items:l?[...l.items]:[],absent:l?l.absent:false,dirty:false,t:0,q:Promise.resolve(),failed:false};
 if(!L.items.length)L.items=[''];lm()}
function lm(foc){if(!L)return;const sl=SL.find(x=>x.id===L.slot),sec=L.section,c=sec?color(sec):'#999',secs=actSecs(),all=secs.some(n=>nk(n)===nk(sec))||!sec?secs:[...secs,sec],tp=prevTopics(sec),ax=prevAxes(sec);
 const idx=tp.findIndex(x=>nk(x.topic)===nk(L.topic)&&(nk(x.axis)===nk(L.axis)||!L.axis));
 let h=`<div class="cjlh" style="--c:${c}"><div><h2>${DAYS[dow(L.date)]} ${fd(L.date)}</h2><div class="mut">${sl.n}${sl.p?' (الفترة المسائية)':''} · <bdi dir="ltr">${sl.a} – ${sl.b}</bdi></div></div><button class="g fit" onclick="CJH.cl()" aria-label="إغلاق">✕</button></div>
<div class="cjf"><label for="cjsec">القسم</label><select id="cjsec" onchange="CJH.sec(this.value)" style="border-inline-start:8px solid ${c}">${sec?'':'<option value="">— اختر القسم —</option>'}${all.map(n=>`<option value="${esc(n)}" ${nk(n)===nk(sec)?'selected':''}>${esc(n)}</option>`).join('')}</select></div>
<label class="chip cjabt ${L.absent?'on':''}"><input type="checkbox" ${L.absent?'checked':''} onchange="CJH.abs(this.checked)"> غياب الأستاذ</label>`;
 if(L.absent)h+='<div class="cjabn">ظرف الغياب</div>';
 else{
  h+=`<div class="cjf"><label for="cjax">المحور</label><input id="cjax" list="cjaxl" value="${esc(L.axis)}" placeholder="اختر محوراً سابقاً أو اكتب محوراً جديداً" autocomplete="off" oninput="CJH.axis(this.value)"><datalist id="cjaxl">${ax.map(a=>`<option value="${esc(a)}">`).join('')}</datalist>
${ax.length?`<div class="chips cjch">${ax.slice(0,8).map((a,i)=>`<button class="chip g ${nk(a)===nk(L.axis)?'on':''}" onclick="CJH.axc(${i})">${esc(a)}</button>`).join('')}</div>`:''}</div>
<div class="cjf"><label>الموضوع</label><div class="cjseg"><button class="g ${L.cont?'':'on'}" onclick="CJH.mode(0)">موضوع جديد</button><button class="g ${L.cont?'on':''}" onclick="CJH.mode(1)" ${tp.length?'':'disabled title="لا توجد مواضيع سابقة لهذا القسم"'}>متابعة درس سابق</button></div>`;
  if(L.cont)h+=`<select id="cjtp" onchange="CJH.pick(this.value)" aria-label="الدرس الذي نتابعه"><option value="">— اختر الدرس —</option>${grp(tp,idx)}</select>${L.topic?`<div class="cjprev">سيُدرج: <b>تابع لدرس ${esc(L.topic)}</b></div>`:''}`;
  else h+=`<input id="cjtn" list="cjtl" value="${esc(L.topic)}" placeholder="اكتب موضوع الحصة (أو اختر موضوعاً سابقاً)" autocomplete="off" oninput="CJH.topic(this.value)"><datalist id="cjtl">${tp.map(x=>`<option value="${esc(x.topic)}">`).join('')}</datalist>`;
  h+=`</div><div class="cjf"><label>عناصر الدرس</label><div id="cjit">${L.items.map((x,i)=>`<div class="cjir"><span class="cjnum">${i+1}</span><input id="cji${i}" dir="rtl" value="${esc(x)}" placeholder="عنصر الدرس" autocomplete="off" oninput="CJH.it(${i},this.value)" onkeydown="CJH.ik(event,${i})" onpaste="CJH.ip(event,${i})">
<button class="g fit" onclick="CJH.mv(${i},-1)" ${i?'':'disabled'} aria-label="أعلى">↑</button><button class="g fit" onclick="CJH.mv(${i},1)" ${i<L.items.length-1?'':'disabled'} aria-label="أسفل">↓</button><button class="d fit" onclick="CJH.rm(${i})" aria-label="حذف العنصر">✕</button></div>`).join('')}</div>
<button class="g" onclick="CJH.add()">＋ إضافة عنصر</button></div>`}
 h+=`<div class="row cjfoot"><button class="fit" onclick="CJH.cl()">حفظ وإغلاق</button>${L.exist?'<button class="fit d" onclick="CJH.del()">مسح بيانات الحصة</button>':''}<span id="cjst" class="mut">${L.dirty?'غير محفوظ…':L.exist?'محفوظ ✓':''}</span></div>`;
 modal(h);if(foc){const e=document.getElementById(foc);if(e){e.focus();if(e.setSelectionRange&&e.value)try{e.setSelectionRange(e.value.length,e.value.length)}catch(x){}}}}
function grp(tp,idx){const g=new Map();tp.forEach((x,i)=>{const k=x.axis||'بدون محور';if(!g.has(k))g.set(k,[]);g.get(k).push([x,i])});
 return[...g].map(([k,a])=>`<optgroup label="${esc(k)}">${a.map(([x,i])=>`<option value="${i}" ${i===idx?'selected':''}>${esc(x.topic)}</option>`).join('')}</optgroup>`).join('')}
const touch=()=>{if(!L)return;L.dirty=true;stat('غير محفوظ…');clearTimeout(L.t);L.t=setTimeout(flush,800)};
function snap(){return{season:st.season,date:L.date,slot:L.slot,section:L.section,axis:nz(L.axis),topic:nz(L.topic),cont:L.cont&&!!nz(L.topic),items:L.items.map(x=>String(x).trim()).filter(Boolean),absent:L.absent}}
function flush(){if(!L)return Promise.resolve();clearTimeout(L.t);if(!L.dirty)return L.q;const s=snap(),Lr=L;L.dirty=false;
 L.q=L.q.then(()=>persist(Lr,s));return L.q}
async function persist(Lr,s){const has=s.absent||s.axis||s.topic||s.items.length;
 try{if(!s.section){if(has){Lr.dirty=true;Lr.failed=true;stat('اختر القسم ليُحفظ الدرس')}return}
  Lr.failed=false;
  if(has){const r=await ca('/lessons','PUT',s);st.lessons.set(s.date+'|'+s.slot,r.lesson);Lr.exist=true}
  else if(st.lessons.has(s.date+'|'+s.slot)||Lr.exist){await ca('/lessons?'+qs({season:s.season,date:s.date,slot:s.slot}),'DELETE');st.lessons.delete(s.date+'|'+s.slot);Lr.exist=false}
  if(L===Lr)stat(Lr.exist?'تم الحفظ ✓':'')}
 catch(e){Lr.dirty=true;Lr.failed=true;stat('فشل الحفظ — ستُعاد المحاولة');if(e.status===401)return fail(e);if(L===Lr)Lr.t=setTimeout(flush,4000)}}
addEventListener('visibilitychange',()=>{if(document.hidden&&L&&L.dirty)flush()});
async function closeL(){const Lr=L;clearTimeout(Lr.t);if(Lr.dirty)flush();await Lr.q;
 if(Lr.dirty&&!confirm('تعذّر حفظ آخر التعديلات (تأكد من اختيار القسم ومن الاتصال). هل تريد الإغلاق دون حفظ؟')){Lr.t=setTimeout(flush,3000);return false}
 L=null;return true}
/* ---------- محرر الجدول الزمني ---------- */
const sName=()=>'جدول '+(st.sch.length+1);
function listS(){if(!st)return;const t=tod(),rows=st.sch.map(s=>{const state=s.start>t?'قادم':(s.end&&s.end<t)?'منتهٍ':'ساري';
 return`<div class="cls"><div><b>${esc(s.name)}</b> <span class="cjbg ${state==='ساري'?'ok':''}">${state}</span><div class="mut">من ${fd(s.start)} إلى ${s.end?fd(s.end):'<b>إشعار آخر (مفتوح)</b>'} · ${Object.keys(s.cells).length} حصة مبرمجة</div></div>
<div class="row"><button class="fit" onclick="CJH.editS('${s.id}')">تعديل</button><button class="fit g" onclick="CJH.copyS('${s.id}')">نسخ كأساس لجدول جديد</button><button class="fit d" onclick="CJH.delS('${s.id}')">حذف</button></div></div>`}).join('');
 modal(`<div class="cjlh"><h2>الجداول الزمنية — موسم ${esc(st.season)}</h2><button class="g fit" onclick="CJH.cl()" aria-label="إغلاق">✕</button></div>
<p class="mut">لكل جدول فترة محددة. الأسبوع يعرض تلقائياً الجدول الساري في كل يوم. الدروس المسجلة لا تتأثر بتغيير الجداول، وكل الجداول السابقة محفوظة.</p>
<div class="row" style="margin-bottom:8px"><button class="fit" onclick="CJH.newS()">＋ جدول جديد</button></div>${rows||'<p class="mut">لا توجد جداول بعد.</p>'}`,1)}
function openS(o){SE={id:o.id||null,name:o.name,start:o.start,end:o.end||'',open:!o.end,cells:{...o.cells},brush:'',err:'',conf:null};editS()}
function editS(){if(!SE)return;const secs=[...new Set([...actSecs(),...Object.values(SE.cells)])],b=SE.brush;
 if(b===''&&secs.length&&!SE.bset){SE.brush=secs[0];SE.bset=1}
 const cell=(di,s)=>{const v=SE.cells[di+'_'+s.id],c=v?color(v):'';return`<button class="cjsc ${v?'has':''}" ${v?`style="--c:${c};--t:${tint(c,.25)}"`:''} onclick="CJH.paint(${di},'${s.id}')" aria-label="${DAYS[di]} ${s.n}${s.p?' مساءً':''}">${v?esc(v):'—'}</button>`};
 let g=`<div class="cjg se"><div class="cjh cjco"></div>${DAYS.map(d=>`<div class="cjh"><b>${d}</b></div>`).join('')}`;
 SL.forEach((s,k)=>{if(k===4)g+='<div class="cjsp"></div>';g+=`<div class="cjl"><b>${s.n}${s.p?' (مساءً)':''}</b><span><bdi dir="ltr">${s.a} – ${s.b}</bdi></span></div>`+DAYS.map((_,di)=>cell(di,s)).join('')});g+='</div>';
 const others=st.sch.filter(s=>s.id!==SE.id);
 modal(`<div class="cjlh"><h2>${SE.id?'تعديل الجدول':'جدول زمني جديد'}</h2><button class="g fit" onclick="CJH.cl()" aria-label="إغلاق">✕</button></div>
<div class="grid2cj"><div class="cjf"><label>اسم الجدول</label><input id="sen" value="${esc(SE.name)}" oninput="CJH.sn(this.value)" maxlength="60"></div>
<div class="cjf"><label>يبدأ العمل به في</label><input id="ses" type="date" value="${SE.start}" onchange="CJH.ss(this.value)"></div>
<div class="cjf"><label>ينتهي في</label><input id="see" type="date" value="${SE.end}" ${SE.open?'disabled':''} onchange="CJH.se(this.value)"><label class="chip"><input type="checkbox" ${SE.open?'checked':''} onchange="CJH.sopen(this.checked)"> بلا نهاية (الجدول الحالي)</label></div>
${!SE.id&&others.length?`<div class="cjf"><label>نسخ محتوى جدول سابق</label><select onchange="CJH.seed(this.value)"><option value="">— جدول فارغ —</option>${others.map(s=>`<option value="${s.id}">${esc(s.name)} (${fd(s.start)})</option>`).join('')}</select></div>`:''}</div>
<h3 style="margin:10px 0 4px">املأ الحصص: اختر قسماً ثم انقر على الحصص</h3>
<div class="chips cjbr">${secs.map((n,i)=>`<button class="chip ${nk(n)===nk(SE.brush)&&SE.brush!==null?'on':''}" style="--c:${color(n)};--t:${tint(color(n),.25)}" onclick="CJH.brush(${i})"><i class="sw" style="background:${color(n)}"></i>${esc(n)}</button>`).join('')}<button class="chip g ${SE.brush===null?'on':''}" onclick="CJH.brush(-1)">⌫ ممحاة (حصة فارغة)</button><button class="chip g" onclick="CJH.clearS()">مسح الكل</button></div>
${secs.length?'':'<p class="mut">لا توجد أقسام. أنشئ أقسامك في «دفتر التنقيط» لهذا الموسم أو فعّلها من «الأقسام والألوان».</p>'}
<div class="cjscroll">${g}</div>
<div id="seerr" class="cjerr" role="alert">${SE.err||''}</div>
<div class="row cjfoot"><button class="fit" onclick="CJH.saveS()">حفظ الجدول</button><button class="fit g" onclick="CJH.schList()">رجوع</button></div>`,1);SE._secs=secs}
async function saveS(){const s=SE;if(!s)return;const err=m=>{s.err=m;const e=document.getElementById('seerr');if(e)e.innerHTML=m};
 s.name=nz(s.name)||sName();if(!isD(s.start))return err('أدخل تاريخ بداية صحيحاً');const end=s.open?null:s.end;if(!s.open&&!isD(end))return err('أدخل تاريخ النهاية أو فعّل «بلا نهاية»');if(end&&end<s.start)return err('تاريخ النهاية يسبق تاريخ البداية');
 const me={start:s.start,end},conf=st.sch.filter(x=>x.id!==s.id&&ovl(me,x));let auto=false;
 if(conf.length){const closable=end===null&&conf.every(x=>!x.end&&x.start<s.start);
  if(!closable)return err('⚠ تعارض في التواريخ مع: '+conf.map(schLabel).join('، ')+'. عدّل تواريخ هذا الجدول أو الجدول الآخر لتجنّب التداخل.');
  if(!confirm('الجدول «'+conf.map(x=>x.name).join('، ')+'» مفتوح النهاية.\nهل تريد إنهاءه تلقائياً في '+fd(dAdd(s.start,-1))+' (اليوم السابق لبداية هذا الجدول)؟'))return err('لم يُحفظ الجدول: يوجد تداخل مع جدول مفتوح النهاية.');auto=true}
 const body={season:st.season,name:s.name,start:s.start,end,cells:s.cells,autoClose:auto};
 try{if(s.id)await ca('/schedules/'+s.id,'PUT',body);else await ca('/schedules','POST',body);await reloadBoot();SE=null;toast('تم حفظ الجدول الزمني','ok',3000);listS();draw()}
 catch(e){if(e.status===401)return fail(e);err('⚠ '+esc(e.message))}}
/* ---------- الأقسام والألوان ---------- */
async function saveSet(){try{await ca('/settings','PUT',{season:st.season,colors:[...st.colors].map(([k,c])=>({n:CN.get(k)||k,c})),hidden:[...st.hidden].map(k=>CN.get(k)||k)})}catch(e){fail(e)}}
let CN=new Map();
function colorsOpen(){const secs=allSecs();CN=new Map(secs.map(n=>[nk(n),n]));st._cs=secs;
 modal(`<div class="cjlh"><h2>الأقسام والألوان</h2><button class="g fit" onclick="CJH.cl()" aria-label="إغلاق">✕</button></div>
<p class="mut">الأقسام مستوردة تلقائياً من دفتر التنقيط (موسم ${esc(st.season)}). فعّل الأقسام التي تُدرّسها في الدفتر اليومي واختر لكل قسم لوناً يظهر في كل حصصه.</p>
${secs.map((n,i)=>{const c=color(n),on=!st.hidden.has(nk(n));return`<div class="cjcr"><label class="chip"><input type="checkbox" ${on?'checked':''} onchange="CJH.hide(${i},this.checked)"> <b style="border-inline-start:8px solid ${c};padding-inline-start:8px">${esc(n)}</b></label>
<div class="cjpal">${PAL.map(p=>`<button class="cjdot ${p===c?'on':''}" style="background:${p}" onclick="CJH.setc(${i},'${p}')" aria-label="لون ${p}"></button>`).join('')}<input type="color" value="${c}" onchange="CJH.setc(${i},this.value)" aria-label="لون مخصص"><button class="g fit" onclick="CJH.setc(${i},'')">افتراضي</button></div></div>`}).join('')||'<p class="mut">لا توجد أقسام لهذا الموسم.</p>'}
<div class="row cjfoot"><button class="fit" onclick="CJH.cl()">تم</button></div>`,1)}
/* ---------- مراجعة الأسابيع ---------- */
function weeksOpen(only){const m=new Map();st.dates.forEach(x=>{const w=wk0(x.d),o=m.get(w)||{n:0,a:0};o.n+=x.n;o.a+=x.a;m.set(w,o)});
 const first=[...st.sch.map(s=>s.start),...st.dates.map(x=>x.d)].sort()[0],last=[...st.dates.map(x=>x.d),curWk()].sort().pop(),list=[];
 if(first)for(let w=wk0(first);w<=wk0(last);w=dAdd(w,7))if(!only||m.has(w))list.push(w);
 modal(`<div class="cjlh"><h2>مراجعة الأسابيع — موسم ${esc(st.season)}</h2><button class="g fit" onclick="CJH.cl()" aria-label="إغلاق">✕</button></div>
<label class="chip"><input type="checkbox" ${only?'checked':''} onchange="CJH.weeks(this.checked)"> الأسابيع التي بها دروس مسجلة فقط</label>
<div class="cjwl">${list.reverse().map(w=>{const o=m.get(w),sc=[...new Set([0,1,2,3,4].map(i=>schFor(dAdd(w,i))).filter(Boolean).map(s=>s.name))];
  return`<div class="cls"><div><b>${fd(w)} ← ${fd(dAdd(w,4))}</b>${w===st.week?' <span class="cjbg ok">معروض الآن</span>':''}<div class="mut">${o?`${o.n} حصة مسجلة${o.a?` · ${o.a} غياب`:''}`:'لا دروس مسجلة'}${sc.length?' · '+esc(sc.join('، ')):''}</div></div><button class="fit g" onclick="CJH.goto('${w}',1)">فتح</button></div>`}).join('')||'<p class="mut">لا توجد أسابيع بعد.</p>'}</div>`,1)}
/* ---------- التصدير والطباعة ---------- */
const seasonEnd=()=>{const y=(st.season.match(/\d{4}/g)||[]).map(Number);return(y.length>1?y[1]:(y[0]||new Date().getFullYear())+1)+'-08-31'};
function allRange(){const ds=st.dates.map(x=>x.d),starts=st.sch.map(s=>s.start);if(!ds.length&&!starts.length)return null;const from=[...starts,...ds].sort()[0],cap=tod()<seasonEnd()?tod():seasonEnd(),
 ends=[...ds,...st.sch.map(s=>s.end||(cap>s.start?cap:s.start))].sort();return{from,to:ends[ends.length-1]}}
function expOpen(){if(!EX)EX={mode:'wk',w1:st.week,from:st.week,to:dAdd(st.week,11),skip:true};
 const e=EX,r=e.mode==='all'?allRange():null;
 modal(`<div class="cjlh"><h2>تصدير وطباعة الدفتر اليومي</h2><button class="g fit" onclick="CJH.cl()" aria-label="إغلاق">✕</button></div>
<p class="mut">كل صفحة (A4 أفقي) تحتوي أسبوعين كاملين بالأقسام والألوان والمحاور والمواضيع وعناصر الدروس وحالات الغياب.</p>
<div class="cjf"><label>ماذا تريد أن تُخرِج؟</label><div class="chips">
<label class="chip"><input type="radio" name="exm" ${e.mode==='wk'?'checked':''} onchange="CJH.exm('wk')"> أسبوعان محدّدان</label>
<label class="chip"><input type="radio" name="exm" ${e.mode==='rng'?'checked':''} onchange="CJH.exm('rng')"> فترة زمنية محددة</label>
<label class="chip"><input type="radio" name="exm" ${e.mode==='all'?'checked':''} onchange="CJH.exm('all')"> الموسم الدراسي كاملاً</label></div></div>
${e.mode==='wk'?`<div class="cjf"><label>الأسبوع الأول (يُضاف إليه الأسبوع الذي يليه)</label><input type="date" value="${e.w1}" onchange="CJH.exs('w1',this.value)"><div class="mut">الصفحة: ${wkTitle(wk0(e.w1))}<br>و${wkTitle(dAdd(wk0(e.w1),7))}</div></div>`:''}
${e.mode==='rng'?`<div class="grid2cj"><div class="cjf"><label>من تاريخ</label><input type="date" value="${e.from}" onchange="CJH.exs('from',this.value)"></div><div class="cjf"><label>إلى تاريخ</label><input type="date" value="${e.to}" onchange="CJH.exs('to',this.value)"></div></div>`:''}
${e.mode==='all'?`<div class="mut">${r?`من ${fd(r.from)} إلى ${fd(r.to)}`:'لا توجد بيانات بعد'}</div>`:''}
${e.mode!=='wk'?`<label class="chip"><input type="checkbox" ${e.skip?'checked':''} onchange="CJH.exs('skip',this.checked)"> تخطّي الأسابيع التي لا تحتوي أي درس مسجّل</label>`:''}
<div class="row cjfoot"><button class="fit" onclick="CJH.doPdf()">⬇ تصدير PDF</button><button class="fit g" onclick="CJH.doPrint()">🖨 طباعة مباشرة</button><button class="fit g" onclick="CJH.cl()">إغلاق</button></div>`,1)}
function expRange(){const e=EX;if(e.mode==='wk'){const w=wk0(isD(e.w1)?e.w1:st.week);return{weeks:[w,dAdd(w,7)],from:w,to:dAdd(w,11),fixed:1}}
 let r=e.mode==='all'?allRange():{from:e.from,to:e.to};if(!r||!isD(r.from)||!isD(r.to)||r.to<r.from)return null;
 const ws=[];for(let w=wk0(r.from);w<=r.to;w=dAdd(w,7))ws.push(w);return{weeks:ws,from:wk0(r.from),to:dAdd(wk0(r.to),4)}}
async function expData(){const R=expRange();if(!R){toast('حدّد فترة صحيحة للتصدير','er',5000);return null}
 if(Date.parse(R.to)-Date.parse(R.from)>780*864e5){toast('الفترة طويلة جداً، اختر فترة أقصر','er',5000);return null}
 let lm;try{lm=new Map((await fetchLessons(R.from,R.to)).map(x=>[x.date+'|'+x.slot,x]))}catch(e){fail(e);return null}
 let ws=R.weeks;if(!R.fixed){const has=w=>[0,1,2,3,4].some(i=>SL.some(s=>lm.has(dAdd(w,i)+'|'+s.id)));
  ws=ws.filter(w=>has(w)||(!EX.skip&&[0,1,2,3,4].some(i=>schFor(dAdd(w,i)))))}
 if(!ws.length){toast('لا توجد أسابيع للتصدير ضمن هذه الخيارات','er',5000);return null}return{weeks:ws,lm,from:ws[0],to:dAdd(ws[ws.length-1],4)}}
function headHTML(a,b){const p=S.p;return`<div class="cjhd"><div class="band"><div class="b">الدفتر اليومي</div><div class="a">الموسم الدراسي ${esc(st.season)}</div></div>
<div class="meta"><div>مديرية التربية ${esc(p.dir||'')} · ${esc(p.type||'')} ${esc(p.school||'')}</div><div>الأستاذ: <span class="r">${esc(p.name||'')}</span> · المادة: ${esc(curSubj())}</div></div>
<div class="ttl"><span>الدفتر اليومي – من <i>${fd(a)}</i> إلى <i>${fd(dAdd(b,4))}</i></span></div></div>`}
function weekPrint(w,lm){const sc=[...new Set([0,1,2,3,4].map(i=>schFor(dAdd(w,i))).filter(Boolean).map(s=>s.name))];
 return`<div class="cjpw"><div class="cjpt"><span>${wkTitle(w)}</span><span>${sc.length?'الجدول: '+esc(sc.join(' ← ')):'بلا جدول زمني'}</span></div>${grid(w,'pr',lm)}</div>`}
/* توزيع الأسبوعين على صفحة A4 أفقية بحجم خط تلقائي: أكبر خط يتّسع به المحتوى كاملاً (12.5px → 5px)، وإن لم يتّسع يُصغَّر الكل */
function fitBody(host,html,bh){const box=pdfBox(host,'l'),w=document.createElement('div');w.className='cjpg';w.innerHTML=html;box.appendChild(w);let f=12.5;
 for(;f>=5;f-=.5){w.style.setProperty('--cjf',f+'px');if(w.getBoundingClientRect().height<=bh)break}
 if(f<5){f=5;w.style.setProperty('--cjf','5px')}const h=w.getBoundingClientRect().height;box.parentNode.remove();
 if(h<=bh){w.style.height=bh+'px';return w}return pdfFit(w,h,bh)}
function buildPages(host,ws,lm){const out=[];for(let i=0;i<ws.length;i+=2){const pair=ws.slice(i,i+2),head=headHTML(pair[0],pair[pair.length-1]),P=pdfProbe(host,'l',head);
  out.push({or:'l',head,hh:P.hh,fh:P.fh,body:fitBody(host,pair.map(w=>weekPrint(w,lm)).join(''),P.bh)})}return out}
function fileName(D){return pdfFile(['الدفتر-اليومي',curSubj(),st.season,fd(D.from).replace(/\//g,'-')+'_'+fd(D.to).replace(/\//g,'-')])}
async function doPrint(D){const host=pdfHost();try{await pdfReady();const pages=buildPages(host,D.weeks,D.lm),N=pages.length;
  pxMount(pages.map((p,i)=>'<section class="pxs cj l">'+pdfPageEl(p,i+1,N).outerHTML+'</section>').join(''));host.innerHTML='';setTimeout(()=>print(),250)}
 catch(e){host.innerHTML='';toast('تعذّر تجهيز الطباعة: '+((e&&e.message)||e),'er',0)}}
/* ---------- الدوال المستدعاة من الواجهة ---------- */
window.CJH={
 nav(a){if(L||document.getElementById('cjm'))return;if(a==='tq')home();else cjGo()},
 async cl(){if(L){if(!(await closeL()))return;mclose();draw();refreshCat().then(draw);return}SE=null;mclose();draw()},
 season(v){if(!v||v===st.season)return;st.tok++;Object.assign(st,{loading:false,season:v,sch:[],cat:[],dates:[],lessons:new Map(),loaded:new Set(),ready:false,err:'',week:curWk()});draw();load()},
 retry(){st.err='';draw();load()},
 week(n){st.week=dAdd(st.week,7*n);draw();ensureWk()},today(){st.week=curWk();draw();ensureWk()},
 goto(v,close){if(!isD(v))return;st.week=wk0(v);if(close)mclose();draw();ensureWk()},
 open:lessonOpen,
 /* الحصة */
 sec(v){L.section=v;if(L.cont){L.cont=false;L.topic=''}lm();touch()},
 abs(on){L.absent=on;lm();touch()},
 axis(v){L.axis=v;touch()},axc(i){const a=prevAxes(L.section)[i];if(a==null)return;L.axis=a;lm();touch()},
 topic(v){L.topic=v;L.cont=false;touch()},
 mode(c){if(!!c===L.cont)return;L.cont=!!c;if(c){const t=prevTopics(L.section);const q=t.find(x=>nk(x.axis)===nk(L.axis))||t[0];if(q){L.topic=q.topic;L.axis=q.axis||L.axis}else L.cont=false}else L.topic='';lm();touch()},
 pick(i){const q=prevTopics(L.section)[+i];if(!q){L.topic='';lm();return touch()}L.topic=q.topic;if(q.axis)L.axis=q.axis;lm();touch()},
 it(i,v){L.items[i]=v;touch()},
 add(){L.items.push('');lm('cji'+(L.items.length-1))},
 rm(i){L.items.splice(i,1);if(!L.items.length)L.items=[''];lm('cji'+Math.min(i,L.items.length-1));touch()},
 mv(i,d){const j=i+d;if(j<0||j>=L.items.length)return;[L.items[i],L.items[j]]=[L.items[j],L.items[i]];lm('cji'+j);touch()},
 ik(e,i){if(e.key==='Enter'){e.preventDefault();L.items.splice(i+1,0,'');lm('cji'+(i+1));touch()}else if(e.key==='Backspace'&&!e.target.value&&L.items.length>1){e.preventDefault();L.items.splice(i,1);lm('cji'+Math.max(0,i-1));touch()}},
 ip(e,i){const t=(e.clipboardData||window.clipboardData).getData('text');if(!/\r?\n/.test(t))return;e.preventDefault();const p=t.split(/\r?\n/).map(x=>x.replace(/^[\s\-–•*·\d.)]+(?=\S)/,'').trim()).filter(Boolean);if(!p.length)return;
  L.items.splice(i,1,...p);lm('cji'+(i+p.length-1));touch()},
 async del(){if(!L||!confirm('مسح كل بيانات هذه الحصة (المحور والموضوع والعناصر والغياب)؟'))return;const Lr=L;clearTimeout(Lr.t);Lr.dirty=false;await Lr.q;
  try{await ca('/lessons?'+qs({season:st.season,date:Lr.date,slot:Lr.slot}),'DELETE');st.lessons.delete(Lr.date+'|'+Lr.slot);L=null;mclose();draw();refreshCat().then(draw)}catch(e){fail(e)}},
 /* الجداول */
 schList(){if(SE){SE=null}listS()},
 newS(){const last=st.sch.length?null:(()=>{const y=+(st.season.match(/\d{4}/)||[new Date().getFullYear()])[0];return y+'-09-15'})();
  openS({name:sName(),start:last||tod(),end:'',cells:{}})},
 editS(id){const s=st.sch.find(x=>x.id===id);if(s)openS(s)},
 copyS(id){const s=st.sch.find(x=>x.id===id);if(!s)return;openS({name:s.name+' (نسخة)',start:s.end?dAdd(s.end,1):tod(),end:'',cells:s.cells})},
 async delS(id){const s=st.sch.find(x=>x.id===id);if(!s||!confirm('حذف الجدول «'+s.name+'»؟\nالدروس المسجلة سابقاً لن تُحذف، لكن الحصص غير المسجلة في فترته ستظهر فارغة.'))return;
  try{await ca('/schedules/'+id,'DELETE');await reloadBoot();listS();draw()}catch(e){fail(e)}},
 sn(v){SE.name=v},ss(v){SE.start=v},se(v){SE.end=v},
 sopen(on){SE.open=on;if(on)SE.end='';editS()},
 seed(id){const s=st.sch.find(x=>x.id===id);SE.cells=s?{...s.cells}:{};editS()},
 brush(i){SE.brush=i<0?null:SE._secs[i];editS()},
 paint(di,sid){const k=di+'_'+sid;if(SE.brush===null||SE.brush==='')delete SE.cells[k];else SE.cells[k]=SE.brush;editS()},
 clearS(){if(confirm('مسح كل حصص هذا الجدول؟')){SE.cells={};editS()}},
 saveS,
 /* الأقسام والألوان */
 colors:colorsOpen,
 setc(i,c){const n=st._cs[i];if(!n)return;if(c)st.colors.set(nk(n),c);else st.colors.delete(nk(n));colorsOpen();saveSet()},
 hide(i,on){const n=st._cs[i];if(!n)return;on?st.hidden.delete(nk(n)):st.hidden.add(nk(n));saveSet()},
 weeks:weeksOpen,
 /* التصدير */
 exp(){expOpen()},exm(m){EX.mode=m;expOpen()},exs(k,v){EX[k]=v;if(k==='from'&&isD(v)&&EX.to<v)EX.to=v;if(k!=='skip')expOpen()},
 async doPdf(){const D=await expData();if(!D)return;const name=fileName(D),title='الدفتر اليومي — '+curSubj()+' — '+st.season;mclose();draw();
  pdfDirect({name,title,build:h=>buildPages(h,D.weeks,D.lm),fallback:()=>doPrint(D)})},
 async doPrint(){const D=await expData();if(!D)return;mclose();draw();doPrint(D)}
};
/* ---------- الأنماط ---------- */
window.CJ_PCSS=`
.cjg{display:grid;grid-template-columns:var(--lw,8.2em) repeat(5,minmax(0,1fr));grid-template-rows:auto repeat(4,auto) 5px repeat(3,auto);gap:1px;background:var(--lc);border:1px solid var(--lc);--lc:#666;--cb:#fff}
.cjg>*{background:var(--cb);min-width:0}
.cjg .cjsp{grid-column:1/-1;background:var(--lc);padding:0}
.cjh{padding:.3em .3em;text-align:center;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.3;background:var(--tsoft,#e8f7f8)}
.cjh span{font-weight:600;font-size:.88em;color:#444}
.cjl{padding:.25em .45em;display:flex;flex-direction:column;justify-content:center;line-height:1.3;background:#f4f6f7}
.cjl i{font-style:normal;font-size:.78em;color:#fff;background:#6b7a80;border-radius:3px;padding:0 .4em;align-self:flex-start;margin-bottom:.15em}
.cjl.pm i{background:#8a6d3b}
.cjl span{font-size:.85em;color:#555}
.cjc{padding:.25em .45em;display:flex;flex-direction:column;gap:.1em;overflow-wrap:anywhere;line-height:1.35}
.cjs{font-weight:800}.cja{font-size:.88em;color:#444}.cjt{font-weight:700}
.cji{margin:.1em 0 0;padding-inline-start:1.15em;list-style:disc;font-size:.92em}.cji li{margin:0}
.cjab{font-weight:800;color:#b3261e}
.cjg.pr .cjc.has{background:var(--t);box-shadow:inset -.4em 0 0 var(--c)}
.cjg.pr .cjc.abs{background:repeating-linear-gradient(135deg,#f9d6d6 0 .6em,#fff1f1 .6em 1.2em);box-shadow:inset -.4em 0 0 var(--c)}
.cjpg{display:flex;flex-direction:column;gap:.55em;font-size:var(--cjf,11px);color:#111;direction:rtl;font-family:Cairo,Tahoma,sans-serif}
.cjpw{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.cjpw .cjg{flex:1 1 auto;align-content:stretch}
.cjpt{display:flex;justify-content:space-between;gap:1em;font-weight:800;padding:.2em .6em;background:var(--pp,#22bfc7);color:#fff;border-radius:.5em .5em 0 0;font-size:1.05em}
.pgh .cjhd .band{font-size:16px}.pgh .cjhd .meta{padding:3px 28px;font-size:12px;line-height:1.4;font-weight:600}
.pgh .cjhd .ttl{margin:4px 26px 2px;padding:3px 18px;min-height:34px;font-size:18px}
@page cjl{size:A4 landscape;margin:0}
@media print{.pxs.cj{page:cjl;width:1123px;height:793px;overflow:hidden}.pxs.cj .pgx{break-inside:avoid}}
`;
const APPCSS=`
.modnav{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-bottom:12px}
.modnav button.g{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:var(--r);background:var(--card);color:var(--ink);border:2px solid var(--bd);font-size:17px;font-weight:800;text-align:start;min-height:66px}
.modnav button.g.on{border-color:var(--teal);background:color-mix(in srgb,var(--teal) 14%,var(--card))}
.modnav svg{flex:0 0 auto;color:var(--teal)}.modnav small{display:block;font-weight:500;color:var(--mut);font-size:12.5px}
.cjlab{font-weight:700;padding:0 4px;min-height:0;flex:0 0 auto}
.cjttl{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;font-size:18px;margin-bottom:8px}
.cjnb{margin-bottom:4px}.cjsi{margin-top:6px;font-size:13.5px}
.cjwarn{margin-top:8px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,#f5a623 22%,var(--card));border:1px solid #f5a623;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.cjg.app{--lc:var(--bd);--cb:var(--card);border-radius:var(--r);overflow:hidden;font-size:14px}
.cjg.app .cjh,.cjg.se .cjh{background:color-mix(in srgb,var(--teal) 14%,var(--card));padding:8px 4px}.cjg.se .cjh span{color:var(--mut)}.cjg.app .cjh.today{background:var(--teal);color:var(--ptp)}.cjg.app .cjh.today span{color:inherit}
.cjg.app .cjh span{color:var(--mut)}
.cjg.app .cjl,.cjg.se .cjl{background:color-mix(in srgb,var(--ink) 5%,var(--card));padding:6px 8px}.cjg.app .cjl span,.cjg.se .cjl span{color:var(--mut)}.cjg.app .cjl.pm i{background:#8a6d3b}
.cjg.app .cjc{min-height:76px;padding:6px 8px;cursor:pointer;transition:filter .12s}
.cjg.app .cjc:hover,.cjg.app .cjc:focus-visible{outline:2px solid var(--teal);outline-offset:-2px}
.cjg.app .cjc.empty{background:repeating-linear-gradient(135deg,transparent 0 9px,color-mix(in srgb,var(--mut) 10%,transparent) 9px 10px),var(--card);align-items:center;justify-content:center;color:var(--mut);min-height:54px}
.cjplus{opacity:.35;font-size:20px}
.cjg.app .cjc.has{background:color-mix(in srgb,var(--c) 22%,var(--card));box-shadow:inset -6px 0 0 var(--c)}
.cjg.app .cjc.sched{background:color-mix(in srgb,var(--c) 12%,var(--card))}
.cjg.app .cjc.abs{background:repeating-linear-gradient(135deg,color-mix(in srgb,#e55 30%,var(--card)) 0 8px,color-mix(in srgb,#e55 12%,var(--card)) 8px 16px);box-shadow:inset -6px 0 0 var(--c,#e55)}
.cjg.app .cjab{color:#c0302b}
.cjg.app .cjt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cjg.app .cja{color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cjn{font-size:12px;color:var(--mut)}.cjhint{font-size:12px;color:var(--mut)}
.cjg.app .cjc,.cjmob .cjc{position:relative}.cjg.app .cjc.done::after,.cjmob .cjc.done::after{content:"✓";position:absolute;top:4px;left:6px;font-size:12px;color:#2a9d5c;font-weight:800}
.cjmob{display:none;gap:10px;grid-template-columns:minmax(0,1fr)}.cjmd{min-width:0}
.cjmd{border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;background:var(--card)}
.cjmh{display:flex;justify-content:space-between;padding:8px 12px;background:color-mix(in srgb,var(--teal) 14%,var(--card));font-weight:800}.cjmh.today{background:var(--teal);color:var(--ptp)}
.cjmr{display:grid;grid-template-columns:6.5em minmax(0,1fr);border-top:1px solid var(--bd)}.cjmr.pm+.cjmr.pm{}
.cjml{padding:6px 8px;font-size:13px;display:flex;flex-direction:column;background:color-mix(in srgb,var(--ink) 5%,var(--card))}.cjml span{color:var(--mut)}
.cjmob .cjc{min-height:58px;padding:6px 10px;cursor:pointer;display:flex;flex-direction:column;gap:2px;position:relative}
.cjmob .cjc.empty{color:var(--mut);align-items:center;justify-content:center;min-height:44px;background:repeating-linear-gradient(135deg,transparent 0 9px,color-mix(in srgb,var(--mut) 10%,transparent) 9px 10px),var(--card)}
.cjmob .cjc.has{background:color-mix(in srgb,var(--c) 22%,var(--card));box-shadow:inset -6px 0 0 var(--c)}.cjmob .cjc.sched{background:color-mix(in srgb,var(--c) 12%,var(--card))}
.cjmob .cjc.abs{background:repeating-linear-gradient(135deg,color-mix(in srgb,#e55 30%,var(--card)) 0 8px,color-mix(in srgb,#e55 12%,var(--card)) 8px 16px)}
.cjmob .cjs,.cjg.app .cjs{font-weight:800}.cjmob .cja{color:var(--mut);font-size:13px}.cjmob .cjt{font-weight:600}.cjmob .cjab{color:#c0302b;font-weight:800}
@media(max-width:760px){.cjg.app{display:none}.cjmob{display:grid}}
.cjov{position:fixed;inset:0;z-index:55;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:calc(env(safe-area-inset-top,0px) + 10px) 8px 12px;overflow:auto}
.cjov .box{min-width:0;max-width:100%;background:var(--card);color:var(--ink);border:1px solid var(--bd);border-radius:var(--r);width:min(680px,100%);padding:14px;margin:auto}.cjov .box.wide{width:min(980px,100%)}
html[data-ut=glass] .cjov .box{background:var(--bg)}
.cjlh{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:3px solid var(--c,var(--teal))}.cjlh h2{margin:0}
.cjf{margin:10px 0}.cjf>label{display:block;font-weight:700;margin-bottom:4px}.cjf input,.cjf select{width:100%}
.cjch{margin-top:6px}.cjseg{display:flex;gap:6px;margin-bottom:6px}.cjseg button{flex:1}.cjseg button.on{background:var(--teal);color:var(--ptp);border-color:transparent}
.cjprev{margin-top:6px;padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--teal) 14%,var(--card))}
.cjir{display:flex;gap:6px;align-items:center;margin-bottom:6px}.cjir input{flex:1 1 auto;min-width:0}.cjir button{padding:6px 10px;min-height:40px}.cjnum{flex:0 0 24px;text-align:center;color:var(--mut);font-weight:700}
.cjabt{margin:6px 0}.cjabt.on{outline:2px solid #e55;outline-offset:-2px}
.cjabn{margin:14px 0;padding:22px 10px;border-radius:10px;text-align:center;font-size:24px;font-weight:800;color:#c0302b;background:repeating-linear-gradient(135deg,color-mix(in srgb,#e55 26%,var(--card)) 0 10px,color-mix(in srgb,#e55 10%,var(--card)) 10px 20px)}
.cjfoot{margin-top:14px;align-items:center}.cjfoot .mut{flex:1 1 auto}
.cjbg{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--mut) 20%,var(--card))}.cjbg.ok{background:color-mix(in srgb,#2a9d5c 25%,var(--card));color:var(--ink)}
.grid2cj{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:0 12px}
.cjscroll{overflow:auto;margin-top:8px}.cjscroll .cjg{min-width:640px;--lc:var(--bd);--cb:var(--card);font-size:14px}
.cjsc{width:100%;min-height:44px;border-radius:0;background:var(--card);color:var(--mut);border:0;font-weight:600;padding:4px}
.cjsc.has{background:color-mix(in srgb,var(--c) 26%,var(--card));color:var(--ink);box-shadow:inset -5px 0 0 var(--c);font-weight:800}
.cjscroll .cjl{padding:6px 8px;font-size:13px}.cjscroll .cjh{padding:6px}
.cjbr .chip{border:1px solid var(--bd);background:color-mix(in srgb,var(--c,#888) 18%,var(--card));color:var(--ink)}.cjbr .chip.g{background:transparent}
.cjerr{margin-top:8px;color:#c00;font-weight:700}
.cjcr{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:8px 0;border-top:1px solid var(--bd)}
.cjpal{display:flex;flex-wrap:wrap;gap:5px;align-items:center}.cjdot{width:26px;height:26px;min-height:26px;padding:0;border-radius:50%;border:2px solid transparent}.cjdot.on{border-color:var(--ink);box-shadow:0 0 0 2px var(--card) inset}
.cjpal input[type=color]{min-height:30px;height:30px}
.cjwl{max-height:60vh;overflow:auto;margin-top:8px}
@media(max-width:600px){header.top{flex-wrap:wrap}.cjnb button,.cjnb input{flex:1 1 40%}}
@media print{#cjm{display:none!important}}
`;
const sty=document.createElement('style');sty.id='cjcss';sty.textContent=window.CJ_PCSS+APPCSS;document.head.appendChild(sty);
})();
