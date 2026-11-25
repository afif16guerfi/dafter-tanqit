const express=require('express'),{MongoClient,ObjectId}=require('mongodb'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),helmet=require('helmet'),rateLimit=require('express-rate-limit'),path=require('path');
const {MONGODB_URI,JWT_SECRET,ADMIN_USER='admin',ADMIN_PASSWORD,DB_NAME='dafter',PORT=3000}=process.env;
if(!MONGODB_URI||!JWT_SECRET){console.error('MONGODB_URI و JWT_SECRET مطلوبان');process.exit(1)}
const app=express();app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","'unsafe-inline'","https://cdnjs.cloudflare.com"],scriptSrcAttr:["'unsafe-inline'"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["https://fonts.gstatic.com","data:"],imgSrc:["'self'","data:"],connectSrc:["'self'","https://fonts.googleapis.com","https://fonts.gstatic.com"],upgradeInsecureRequests:null}}}));
app.use(express.json({limit:'12mb'}));
let db;const col=n=>db.collection(n),oid=x=>ObjectId.isValid(x)?new ObjectId(x):null;
const pub=u=>({id:String(u._id),username:u.username,name:u.name,role:u.role,active:u.active,subject:u.subject||''});
const audit=(uid,action,detail)=>col('audit').insertOne({uid,action,detail,at:new Date()}).catch(()=>{});
const wrap=f=>(q,s,n)=>f(q,s,n).catch(e=>{console.error(e);s.status(500).json({error:'خطأ في الخادم'})});
const auth=roles=>wrap(async(q,s,n)=>{let p;try{p=jwt.verify((q.headers.authorization||'').slice(7),JWT_SECRET)}catch(e){return s.status(401).json({error:'انتهت الجلسة، سجّل الدخول من جديد'})}
const u=oid(p.id)&&await col('users').findOne({_id:oid(p.id)});if(!u||!u.active)return s.status(401).json({error:'الحساب معطّل أو غير موجود'});
if(roles&&!roles.includes(u.role))return s.status(403).json({error:'غير مصرّح'});q.user=u;n()});
const bad=(s,m)=>s.status(400).json({error:m});

app.post('/api/login',rateLimit({windowMs:9e5,max:20,standardHeaders:true,legacyHeaders:false}),wrap(async(q,s)=>{
 const{username='',password=''}=q.body||{};const u=await col('users').findOne({username:String(username).trim().toLowerCase()});
 if(!u||!u.active||!(await bcrypt.compare(String(password),u.hash)))return s.status(401).json({error:'اسم المستخدم أو كلمة المرور غير صحيحة'});
 audit(u._id,'login','');s.json({token:jwt.sign({id:String(u._id)},JWT_SECRET,{expiresIn:'30d'}),user:pub(u)})}));
app.get('/api/me',auth(),(q,s)=>s.json({user:pub(q.user)}));

// بيانات الأستاذ: وثيقة واحدة لكل أستاذ، معزولة بمعرّف الحساب
app.get('/api/data',auth(['teacher']),wrap(async(q,s)=>{const d=await col('data').findOne({_id:q.user._id});s.json({state:d?.state||null,ver:d?.ver||0})}));
app.put('/api/data',auth(['teacher']),wrap(async(q,s)=>{
 const{state,ver}=q.body||{};if(!state||typeof state!=='object'||!Array.isArray(state.cl))return bad(s,'بيانات غير صالحة');
 const c=col('data'),id=q.user._id,cur=await c.findOne({_id:id},{projection:{ver:1}}),conflict=()=>s.status(409).json({error:'عُدّلت البيانات من جهاز آخر. ستُعاد تحميل الصفحة.'});
 let nv;
 if(cur){const r=await c.updateOne({_id:id,ver:ver},{$set:{state,at:new Date()},$inc:{ver:1}});if(!r.matchedCount)return conflict();nv=ver+1}
 else{if(ver)return conflict();try{await c.insertOne({_id:id,state,ver:1,at:new Date()});nv=1}catch(e){return conflict()}}
 const sn=col('snapshots'),last=await sn.find({uid:id}).sort({at:-1}).limit(1).next();
 if(!last||Date.now()-last.at>864e5){await sn.insertOne({uid:id,at:new Date(),state});const old=await sn.find({uid:id}).sort({at:-1}).skip(14).project({_id:1}).toArray();if(old.length)await sn.deleteMany({_id:{$in:old.map(x=>x._id)}})}
 s.json({ver:nv})}));
app.get('/api/snapshots',auth(['teacher']),wrap(async(q,s)=>{const l=await col('snapshots').find({uid:q.user._id}).sort({at:-1}).limit(14).project({at:1}).toArray();s.json({list:l.map(x=>({id:String(x._id),at:x.at}))})}));
app.post('/api/snapshots/:id',auth(['teacher']),wrap(async(q,s)=>{const i=oid(q.params.id),x=i&&await col('snapshots').findOne({_id:i,uid:q.user._id});if(!x)return s.status(404).json({error:'النسخة غير موجودة'});
 await col('data').updateOne({_id:q.user._id},{$set:{state:x.state,at:new Date()},$inc:{ver:1}},{upsert:true});audit(q.user._id,'restore',String(i));s.json({ok:1})}));

// إدارة الحسابات
const A=auth(['admin']);
app.get('/api/users',A,wrap(async(q,s)=>{const l=await col('users').find({}).sort({role:1,name:1}).toArray();s.json({users:l.map(pub)})}));
app.post('/api/users',A,wrap(async(q,s)=>{const b=q.body||{},username=String(b.username||'').trim().toLowerCase(),pw=String(b.password||'');
 if(!/^[a-z0-9._-]{3,30}$/.test(username))return bad(s,'اسم المستخدم: 3 إلى 30 حرفاً لاتينياً أو أرقاماً');if(pw.length<8)return bad(s,'كلمة المرور قصيرة (8 أحرف على الأقل)');
 try{const r=await col('users').insertOne({username,hash:await bcrypt.hash(pw,10),name:String(b.name||'').trim().slice(0,100),subject:String(b.subject||'').trim().slice(0,100),role:'teacher',active:true,createdAt:new Date()});audit(q.user._id,'create_user',username);s.json({id:String(r.insertedId)})}
 catch(e){if(e.code===11000)return bad(s,'اسم المستخدم مستعمل');throw e}}));
app.patch('/api/users/:id',A,wrap(async(q,s)=>{const id=oid(q.params.id);if(!id)return bad(s,'معرّف غير صالح');const b=q.body||{},set={};
 if(b.name!=null)set.name=String(b.name).trim().slice(0,100);
 if(b.subject!=null)set.subject=String(b.subject).trim().slice(0,100);
 if(b.password!=null){if(String(b.password).length<8)return bad(s,'كلمة المرور قصيرة (8 أحرف على الأقل)');set.hash=await bcrypt.hash(String(b.password),10)}
 if(b.toggle){const u=await col('users').findOne({_id:id});if(!u)return s.status(404).json({error:'غير موجود'});if(String(id)===String(q.user._id))return bad(s,'لا يمكنك تعطيل حسابك');set.active=!u.active}
 if(!Object.keys(set).length)return bad(s,'لا تغييرات');const r=await col('users').updateOne({_id:id},{$set:set});if(!r.matchedCount)return s.status(404).json({error:'غير موجود'});
 audit(q.user._id,'update_user',String(id)+' '+Object.keys(set).join(','));s.json({ok:1})}));
app.delete('/api/users/:id',A,wrap(async(q,s)=>{const id=oid(q.params.id),u=id&&await col('users').findOne({_id:id});if(!u)return s.status(404).json({error:'غير موجود'});if(u.role!=='teacher')return bad(s,'لا يمكن حذف حساب الإدارة');
 await Promise.all([col('users').deleteOne({_id:id}),col('data').deleteOne({_id:id}),col('snapshots').deleteMany({uid:id}),col('cj_schedules').deleteMany({uid:id}),col('cj_lessons').deleteMany({uid:id}),col('cj_settings').deleteMany({uid:id})]);audit(q.user._id,'delete_user',u.username);s.json({ok:1})}));


// ===== الدفتر اليومي (Cahier Journal): مجموعات مستقلة cj_* معزولة بمعرّف الحساب، لا تمسّ وثيقة دفتر التنقيط =====
// الجداول الزمنية: كل جدول له فترة (بداية/نهاية اختيارية). الدروس: وثيقة مستقلة لكل (موسم، تاريخ، حصة) تحفظ اسم القسم نفسه،
// فلا تتأثر الدروس المسجلة بأي تعديل لاحق على الجداول. التواريخ نصوص YYYY-MM-DD (لا مناطق زمنية).
const T=auth(['teacher']),CJ_SLOTS=['m1','m2','m3','m4','a1','a2','a3'],cs=(v,n)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,n),csm=(v,n)=>String(v==null?'':v).replace(/\r/g,'').trim().slice(0,n);
const isD=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===s};
const dAdd=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*864e5).toISOString().slice(0,10),fD=s=>s.split('-').reverse().join('/'),MAXD='9999-12-31';
const seasonOf=v=>cs(v,30);
const cleanCells=c=>{const o={};if(c&&typeof c==='object')for(const k of Object.keys(c)){if(!/^[0-4]_(m[1-4]|a[1-3])$/.test(k))continue;const v=cs(c[k],100);if(v)o[k]=v}return o};
const sOut=x=>({id:String(x._id),season:x.season,name:x.name,start:x.start,end:x.end||null,cells:x.cells||{},createdAt:x.createdAt,updatedAt:x.updatedAt});
const lOut=x=>({id:String(x._id),season:x.season,date:x.date,slot:x.slot,section:x.section,axis:x.axis||'',topic:x.topic||'',cont:!!x.cont,items:x.items||[],absent:!!x.absent,createdAt:x.createdAt,updatedAt:x.updatedAt});

// فحص الجدول: صلاحية التواريخ ومنع التداخل. autoClose: إنهاء جدول مفتوح سابق تلقائياً في اليوم السابق لبداية الجدول الجديد المفتوح.
async function schCheck(q,b,selfId){b=b||{};const season=seasonOf(b.season),start=b.start,end=b.end==null||b.end===''?null:b.end;
 if(!season)return{err:'الموسم الدراسي مطلوب'};if(!isD(start))return{err:'تاريخ البداية غير صالح'};if(end!==null&&!isD(end))return{err:'تاريخ النهاية غير صالح'};
 if(end!==null&&end<start)return{err:'تاريخ النهاية يسبق تاريخ البداية'};
 const all=await col('cj_schedules').find({uid:q.user._id,season}).toArray(),
  conf=all.filter(x=>(!selfId||String(x._id)!==String(selfId))&&x.start<=(end||MAXD)&&start<=(x.end||MAXD)),
  closable=end===null&&conf.length>0&&conf.every(x=>!x.end&&x.start<start);
 if(conf.length&&!(b.autoClose&&closable))return{err:'تعارض في التواريخ مع: '+conf.map(x=>`«${x.name}» (${fD(x.start)} → ${x.end?fD(x.end):'مفتوح'})`).join('، '),conflicts:conf.map(sOut),canClose:closable};
 return{doc:{season,name:cs(b.name,60)||'جدول',start,end,cells:cleanCells(b.cells)},close:conf};}
const schErr=(s,r)=>s.status(r.conflicts?409:400).json({error:r.err,conflicts:r.conflicts,canClose:!!r.canClose});

app.get('/api/cj/boot',T,wrap(async(q,s)=>{const season=seasonOf(q.query.season);if(!season)return bad(s,'الموسم مطلوب');const uid=q.user._id;
 const[sch,set,cat,dates]=await Promise.all([
  col('cj_schedules').find({uid,season}).sort({start:1}).toArray(),
  col('cj_settings').findOne({uid,season}),
  col('cj_lessons').aggregate([{$match:{uid,season,absent:{$ne:true}}},{$match:{$or:[{topic:{$ne:''}},{axis:{$ne:''}}]}},{$group:{_id:{s:'$section',a:'$axis',t:'$topic'},last:{$max:'$date'}}},{$limit:5000}]).toArray(),
  col('cj_lessons').aggregate([{$match:{uid,season}},{$group:{_id:'$date',n:{$sum:1},a:{$sum:{$cond:['$absent',1,0]}}}},{$sort:{_id:1}},{$limit:5000}]).toArray()]);
 s.json({schedules:sch.map(sOut),colors:(set&&set.colors)||[],hidden:(set&&set.hidden)||[],catalog:cat.map(x=>({section:x._id.s,axis:x._id.a||'',topic:x._id.t||'',last:x.last})),dates:dates.map(x=>({d:x._id,n:x.n,a:x.a}))})}));

app.post('/api/cj/schedules',T,wrap(async(q,s)=>{const r=await schCheck(q,q.body);if(r.err)return schErr(s,r);const now=new Date();
 for(const x of r.close)await col('cj_schedules').updateOne({_id:x._id,uid:q.user._id},{$set:{end:dAdd(r.doc.start,-1),updatedAt:now}});
 const i=await col('cj_schedules').insertOne({...r.doc,uid:q.user._id,createdAt:now,updatedAt:now});audit(q.user._id,'cj_sched_add',String(i.insertedId));s.json({id:String(i.insertedId)})}));
app.put('/api/cj/schedules/:id',T,wrap(async(q,s)=>{const id=oid(q.params.id),x=id&&await col('cj_schedules').findOne({_id:id,uid:q.user._id});if(!x)return s.status(404).json({error:'الجدول غير موجود'});
 const r=await schCheck(q,{...q.body,season:x.season},id);if(r.err)return schErr(s,r);const now=new Date();
 for(const c of r.close)await col('cj_schedules').updateOne({_id:c._id,uid:q.user._id},{$set:{end:dAdd(r.doc.start,-1),updatedAt:now}});
 await col('cj_schedules').updateOne({_id:id,uid:q.user._id},{$set:{name:r.doc.name,start:r.doc.start,end:r.doc.end,cells:r.doc.cells,updatedAt:now}});audit(q.user._id,'cj_sched_edit',String(id));s.json({ok:1})}));
app.delete('/api/cj/schedules/:id',T,wrap(async(q,s)=>{const id=oid(q.params.id);if(!id)return bad(s,'معرّف غير صالح');const r=await col('cj_schedules').deleteOne({_id:id,uid:q.user._id});if(!r.deletedCount)return s.status(404).json({error:'الجدول غير موجود'});audit(q.user._id,'cj_sched_del',String(id));s.json({ok:1})}));

app.get('/api/cj/lessons',T,wrap(async(q,s)=>{const season=seasonOf(q.query.season),from=q.query.from,to=q.query.to;
 if(!season||!isD(from)||!isD(to)||to<from||Date.parse(to)-Date.parse(from)>800*864e5)return bad(s,'معطيات غير صالحة');
 const l=await col('cj_lessons').find({uid:q.user._id,season,date:{$gte:from,$lte:to}}).sort({date:1,slot:1}).toArray();s.json({list:l.map(lOut)})}));
app.put('/api/cj/lessons',T,wrap(async(q,s)=>{const b=q.body||{},season=seasonOf(b.season),date=b.date,slot=b.slot,section=cs(b.section,100);
 if(!season||!isD(date)||!CJ_SLOTS.includes(slot))return bad(s,'معطيات غير صالحة');const dw=new Date(date+'T00:00:00Z').getUTCDay();if(dw>4)return bad(s,'التاريخ ليس من أيام العمل (الأحد إلى الخميس)');
 if(!section)return bad(s,'اختر القسم أولاً');
 const items=(Array.isArray(b.items)?b.items:[]).slice(0,80).map(x=>csm(x,500)).filter(Boolean),axis=cs(b.axis,200),topic=cs(b.topic,300),absent=b.absent===true,cont=b.cont===true&&!!topic,uid=q.user._id;
 if(!absent&&!axis&&!topic&&!items.length){await col('cj_lessons').deleteOne({uid,season,date,slot});return s.json({deleted:1})}   // لا نحفظ حصة فارغة تماماً
 const now=new Date(),f={uid,season,date,slot},run=()=>col('cj_lessons').findOneAndUpdate(f,{$set:{section,axis,topic,cont,items,absent,updatedAt:now},$setOnInsert:{createdAt:now}},{upsert:true,returnDocument:'after'});
 let r;try{r=await run()}catch(e){if(e.code===11000)r=await run();else throw e}
 s.json({lesson:lOut(r.value||r)})}));
app.delete('/api/cj/lessons',T,wrap(async(q,s)=>{const season=seasonOf(q.query.season),date=q.query.date,slot=q.query.slot;if(!season||!isD(date)||!CJ_SLOTS.includes(slot))return bad(s,'معطيات غير صالحة');
 await col('cj_lessons').deleteOne({uid:q.user._id,season,date,slot});s.json({ok:1})}));
app.get('/api/cj/catalog',T,wrap(async(q,s)=>{const season=seasonOf(q.query.season),uid=q.user._id;if(!season)return bad(s,'الموسم مطلوب');
 const[cat,dates]=await Promise.all([col('cj_lessons').aggregate([{$match:{uid,season,absent:{$ne:true}}},{$match:{$or:[{topic:{$ne:''}},{axis:{$ne:''}}]}},{$group:{_id:{s:'$section',a:'$axis',t:'$topic'},last:{$max:'$date'}}},{$limit:5000}]).toArray(),
  col('cj_lessons').aggregate([{$match:{uid,season}},{$group:{_id:'$date',n:{$sum:1},a:{$sum:{$cond:['$absent',1,0]}}}},{$sort:{_id:1}},{$limit:5000}]).toArray()]);
 s.json({catalog:cat.map(x=>({section:x._id.s,axis:x._id.a||'',topic:x._id.t||'',last:x.last})),dates:dates.map(x=>({d:x._id,n:x.n,a:x.a}))})}));
app.put('/api/cj/settings',T,wrap(async(q,s)=>{const b=q.body||{},season=seasonOf(b.season);if(!season)return bad(s,'الموسم مطلوب');
 const colors=(Array.isArray(b.colors)?b.colors:[]).slice(0,300).map(x=>({n:cs(x&&x.n,100),c:String(x&&x.c||'').toLowerCase()})).filter(x=>x.n&&/^#[0-9a-f]{6}$/.test(x.c)),
  hidden=(Array.isArray(b.hidden)?b.hidden:[]).slice(0,300).map(x=>cs(x,100)).filter(Boolean);
 await col('cj_settings').updateOne({uid:q.user._id,season},{$set:{colors,hidden,updatedAt:new Date()},$setOnInsert:{createdAt:new Date()}},{upsert:true});s.json({ok:1})}));

app.get('/healthz',(q,s)=>s.type('text').send('ok'));  // نقطة فحص خفيفة للإبقاء على الخدمة مستيقظة
app.use(express.static(path.join(__dirname,'public')));
app.use('/api',(q,s)=>s.status(404).json({error:'غير موجود'}));
(async()=>{const cl=await new MongoClient(MONGODB_URI).connect();db=cl.db(DB_NAME);
 await col('users').createIndex({username:1},{unique:true});await col('snapshots').createIndex({uid:1,at:-1});
 await col('cj_schedules').createIndex({uid:1,season:1,start:1});
 await col('cj_lessons').createIndex({uid:1,season:1,date:1,slot:1},{unique:true});await col('cj_lessons').createIndex({uid:1,season:1,section:1});
 await col('cj_settings').createIndex({uid:1,season:1},{unique:true});
 if(ADMIN_PASSWORD&&!(await col('users').findOne({role:'admin'}))){await col('users').insertOne({username:ADMIN_USER.toLowerCase(),hash:await bcrypt.hash(ADMIN_PASSWORD,10),name:'الإدارة',role:'admin',active:true,createdAt:new Date()});console.log('تم إنشاء حساب الإدارة')}
 app.listen(PORT,()=>{console.log('يعمل على المنفذ '+PORT);keepAlive()})})().catch(e=>{console.error(e);process.exit(1)});

/* منع نوم الخدمة على Render (الخطة المجانية تنام بعد ~15 دقيقة بلا زيارات): نداء ذاتي كل 10 دقائق.
   يعمل تلقائياً على Render عبر RENDER_EXTERNAL_URL، أو عبر KEEPALIVE_URL يدوياً. KEEPALIVE=off لإيقافه. */
function keepAlive(){const u=process.env.KEEPALIVE_URL||process.env.RENDER_EXTERNAL_URL;if(!u||process.env.KEEPALIVE==='off')return;
 const url=u.replace(/\/+$/,'')+'/healthz',ping=()=>fetch(url,{signal:AbortSignal.timeout(20000)}).then(r=>console.log('keep-alive',r.status)).catch(e=>console.warn('keep-alive فشل:',e.message));
 setInterval(ping,10*60*1000).unref();console.log('keep-alive مفعّل ->',url)}
