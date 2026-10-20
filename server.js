import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import geo from 'nigeria-inec-geo';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {parties,partyNames,normalize,validateSubmission} from './domain.js';
import {addReportingRoutes} from './admin-routes.js';
import {approvedJoin,publicColumns} from './reporting.js';
import {sessionFromRequest} from './auth.js';
const app=express();
if(process.env.RENDER==='true')app.set('trust proxy',1);
app.get('/healthz',(req,res)=>res.json({status:'ok'}));
app.use(helmet({contentSecurityPolicy:{directives:{styleSrc:["'self'","https://fonts.googleapis.com"],fontSrc:["'self'","https://fonts.gstatic.com"]}}})); app.use(express.json({limit:'8mb'}));
app.use('/api',rateLimit({windowMs:60000,limit:90,standardHeaders:'draft-8',legacyHeaders:false}));
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const db=(req,res,next)=>pool?next():res.status(503).json({error:'Neon is not connected yet. Add DATABASE_URL to .env and run npm run db:setup. Browsing the national directory is available.'});
addReportingRoutes(app,pool,wrap,db);
async function find(id){if(typeof id!=='string')return null;const standard=id.startsWith('custom:')?null:geo.findByCode(id); if(standard)return {...standard,full_code:id}; if(!pool)return null; return (await pool.query('SELECT id AS full_code,name,parent,kind FROM locations WHERE id=$1',[id])).rows[0];}
app.get('/api/config',(req,res)=>res.json({parties,partyNames,connected:!!pool,counts:{states:geo.states().length,lgas:geo.lgas().length,wards:geo.wards().length,units:geo.pollingUnits().length}}));
app.get('/api/locations',wrap(async(req,res)=>{
 const {kind,parent}=req.query; let rows=[];
 if(kind==='state')rows=geo.states();
 else {if(typeof parent!=='string'||!await find(parent))return res.status(400).json({error:'Choose a valid parent location.'});
 const [state,lga,ward]=parent.split('/');
 if(kind==='lga')rows=geo.lgas({state});
 else if(kind==='ward')rows=parent.startsWith('custom:')?[]:geo.wards({state,lga});
 else if(kind==='unit')rows=parent.startsWith('custom:')?[]:geo.pollingUnits({state,lga,ward});
 else return res.status(400).json({error:'Invalid location kind.'});
 if(pool&&['ward','unit'].includes(kind)) rows=[...rows,...(await pool.query('SELECT id AS full_code,name FROM locations WHERE kind=$1 AND parent=$2 ORDER BY name',[kind,parent])).rows]; }
 res.json(rows.map(r=>({id:r.full_code||(kind==='state'?r.code:parent+'/'+r.code),name:r.name}))); }));
app.post('/api/locations',db,wrap(async(req,res)=>{
 const {kind,parent,name,code}=req.body;
 if(!['ward','unit'].includes(kind)||typeof parent!=='string'||typeof name!=='string'||name.trim().length<2||name.length>180||!normalize(name))return res.status(400).json({error:'Enter a valid location name.'});
 const p=await find(parent);if(!p || (kind==='ward' ? parent.split('/').length!==2 : !(p.kind==='ward'||parent.split('/').length===3)))return res.status(400).json({error:'Choose the correct parent location.'});
 const [state,lga,ward]=parent.split('/');const existing=parent.startsWith('custom:')?[]:kind==='ward'?geo.wards({state,lga}):geo.pollingUnits({state,lga,ward});
 if(code&&(!/^\d{1,4}$/.test(String(code))))return res.status(400).json({error:'Use a numeric ward or polling unit code.'});
 const codeKey=code?String(Number(code)):null;
 if(existing.some(r=>normalize(r.name)===normalize(name)||(codeKey!==null&&String(Number(r.code))===codeKey)))return res.status(409).json({error:`This ${kind==='unit'?'polling unit':'ward'} already exists.`});
 try{const id='custom:'+randomUUID();await pool.query('INSERT INTO locations(id,kind,parent,name,name_key,code_key) VALUES($1,$2,$3,$4,$5,$6)',[id,kind,parent,name.trim(),normalize(name),codeKey]);res.status(201).json({id,name:name.trim()});}catch(e){if(e.code==='23505')return res.status(409).json({error:'This polling unit or ward already exists.'});throw e;}
}));
app.get('/api/results',wrap(async(req,res)=>{res.set('Cache-Control','no-store');if(!pool)return res.json([]); const unit=typeof req.query.unit==='string'?req.query.unit:null;res.json((await pool.query(`SELECT ${publicColumns} FROM submissions s ${approvedJoin} WHERE ($1::text IS NULL OR s.unit=$1) ORDER BY s.created_at DESC LIMIT 100`,[unit])).rows);}));
app.get('/api/stats',wrap(async(req,res)=>res.json(pool?(await pool.query(`SELECT count(*)::int AS submissions,count(DISTINCT s.unit)::int AS units FROM submissions s ${approvedJoin}`)).rows[0]:{submissions:0,units:0})));
app.post('/api/submissions',db,wrap(async(req,res)=>{
 let v;try{v=validateSubmission(req.body);}catch(e){return res.status(400).json({error:e.message});}
 const b=req.body;const unit=await find(b.unit);if(!unit)return res.status(400).json({error:'Polling unit does not exist.'});
 if(!(unit.kind==='unit'||b.unit.split('/').length===4))return res.status(400).json({error:'Select a polling unit.'});
 const chain=[]; let item=unit;while(item){chain.unshift({id:item.full_code||item.code,name:item.name});const id=item.full_code||item.code;const parent=item.parent||(id.includes('/')?id.split('/').slice(0,-1).join('/'):null);item=parent?await find(parent):null;}
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.unit+'|'+b.election+'|'+b.date]);
 const count=Number((await client.query('SELECT count(*) FROM submissions WHERE unit=$1 AND election=$2 AND election_date=$3',[b.unit,b.election,b.date])).rows[0].count);
 if(count>=3){await client.query('ROLLBACK');return res.status(409).json({error:'This polling unit already has three submissions for this election.'});}
 const id=randomUUID();await client.query('INSERT INTO submissions(id,unit,election,election_date,slot,location,registered,accredited,rejected,votes,total,winners,file_type,file_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,b.unit,b.election,b.date,count+1,JSON.stringify(chain),b.registered,b.accredited,b.rejected,JSON.stringify(b.votes),v.total,JSON.stringify(v.winners),b.file.type,v.data]);await client.query('COMMIT');res.status(201).json({id,slot:count+1});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.get('/api/results/:id/file',db,wrap(async(req,res)=>{if(!/^[a-f0-9-]{36}$/.test(req.params.id))return res.sendStatus(404);const r=(await pool.query("SELECT s.file_type,s.file_data FROM submissions s LEFT JOIN submission_reviews r ON r.submission_id=s.id WHERE s.id=$1 AND (r.status='approved' OR $2::boolean)",[req.params.id,Boolean(sessionFromRequest(req))])).rows[0];if(!r)return res.sendStatus(404);res.set({'Content-Type':r.file_type,'Content-Disposition':'inline','Cache-Control':'private, no-store'}).send(r.file_data);}));
app.use(express.static('public'));
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||500).json({error:err.status===413?'Attachment is too large.':'Unable to complete the request. Check the database connection and try again.'});});
const port=process.env.PORT||3000;
const host=process.env.HOST||'127.0.0.1';
const server=app.listen(port,host,()=>console.log(`MPUR listening on ${host}:${port}`));
let stopping=false;
function shutdown(){
 if(stopping)return;stopping=true;
 const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();
 server.close(async()=>{try{if(pool)await pool.end();clearTimeout(timeout);process.exit(0);}catch{process.exit(1);}});
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
