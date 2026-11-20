const express=require('express'),{MongoClient,ObjectId}=require('mongodb'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),helmet=require('helmet'),rateLimit=require('express-rate-limit'),path=require('path');
const {MONGODB_URI,JWT_SECRET,ADMIN_USER='admin',ADMIN_PASSWORD,DB_NAME='dafter',PORT=3000}=process.env;
if(!MONGODB_URI||!JWT_SECRET){console.error('MONGODB_URI و JWT_SECRET مطلوبان');process.exit(1)}
const app=express();app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","'unsafe-inline'","https://cdnjs.cloudflare.com"],scriptSrcAttr:["'unsafe-inline'"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["https://fonts.gstatic.com"],imgSrc:["'self'","data:"],connectSrc:["'self'"],upgradeInsecureRequests:null}}}));
app.use(express.json({limit:'12mb'}));
let db;const col=n=>db.collection(n),oid=x=>ObjectId.isValid(x)?new ObjectId(x):null;
const pub=u=>({id:String(u._id),username:u.username,name:u.name,role:u.role,active:u.active});
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
 try{const r=await col('users').insertOne({username,hash:await bcrypt.hash(pw,10),name:String(b.name||'').trim().slice(0,100),role:'teacher',active:true,createdAt:new Date()});audit(q.user._id,'create_user',username);s.json({id:String(r.insertedId)})}
 catch(e){if(e.code===11000)return bad(s,'اسم المستخدم مستعمل');throw e}}));
app.patch('/api/users/:id',A,wrap(async(q,s)=>{const id=oid(q.params.id);if(!id)return bad(s,'معرّف غير صالح');const b=q.body||{},set={};
 if(b.name!=null)set.name=String(b.name).trim().slice(0,100);
 if(b.password!=null){if(String(b.password).length<8)return bad(s,'كلمة المرور قصيرة (8 أحرف على الأقل)');set.hash=await bcrypt.hash(String(b.password),10)}
 if(b.toggle){const u=await col('users').findOne({_id:id});if(!u)return s.status(404).json({error:'غير موجود'});if(String(id)===String(q.user._id))return bad(s,'لا يمكنك تعطيل حسابك');set.active=!u.active}
 if(!Object.keys(set).length)return bad(s,'لا تغييرات');const r=await col('users').updateOne({_id:id},{$set:set});if(!r.matchedCount)return s.status(404).json({error:'غير موجود'});
 audit(q.user._id,'update_user',String(id)+' '+Object.keys(set).join(','));s.json({ok:1})}));
app.delete('/api/users/:id',A,wrap(async(q,s)=>{const id=oid(q.params.id),u=id&&await col('users').findOne({_id:id});if(!u)return s.status(404).json({error:'غير موجود'});if(u.role!=='teacher')return bad(s,'لا يمكن حذف حساب الإدارة');
 await Promise.all([col('users').deleteOne({_id:id}),col('data').deleteOne({_id:id}),col('snapshots').deleteMany({uid:id})]);audit(q.user._id,'delete_user',u.username);s.json({ok:1})}));

app.use(express.static(path.join(__dirname,'public')));
app.use('/api',(q,s)=>s.status(404).json({error:'غير موجود'}));
(async()=>{const cl=await new MongoClient(MONGODB_URI).connect();db=cl.db(DB_NAME);
 await col('users').createIndex({username:1},{unique:true});await col('snapshots').createIndex({uid:1,at:-1});
 if(ADMIN_PASSWORD&&!(await col('users').findOne({role:'admin'}))){await col('users').insertOne({username:ADMIN_USER.toLowerCase(),hash:await bcrypt.hash(ADMIN_PASSWORD,10),name:'الإدارة',role:'admin',active:true,createdAt:new Date()});console.log('تم إنشاء حساب الإدارة')}
 app.listen(PORT,()=>console.log('يعمل على المنفذ '+PORT))})().catch(e=>{console.error(e);process.exit(1)});
