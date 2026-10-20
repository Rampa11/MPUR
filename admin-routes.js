import {rateLimit} from 'express-rate-limit';
import {adminConfigured,credentialsMatch,createSession,sessionFromRequest,requireAdmin,requireAdminRequest,setSessionCookie} from './auth.js';
import {parties,partyNames} from './domain.js';
import {approvedJoin,publicColumns,rankedParties,buildTotalsQuery,validElection} from './reporting.js';
import {reviewSubmission} from './reviews.js';
export const queueQuery=`WITH keys AS (
   SELECT s.unit,s.election,s.election_date,min(s.created_at) AS first_received FROM submissions s
   LEFT JOIN submission_reviews r ON r.submission_id=s.id
   WHERE ($1='all' OR COALESCE(r.status,'pending')=$1) AND ($2='' OR s.location::text ILIKE '%'||$2||'%' OR s.unit ILIKE '%'||$2||'%')
   GROUP BY s.unit,s.election,s.election_date ORDER BY min(s.created_at),s.unit,s.election,s.election_date LIMIT 21 OFFSET $3
  ) SELECT ${publicColumns},COALESCE(r.status,'pending') AS status,r.reviewed_by,r.reason,r.reviewed_at,
   COALESCE((SELECT jsonb_agg(e) FROM (SELECT previous_status,status,reviewed_by,reason,created_at FROM review_events WHERE submission_id=s.id ORDER BY created_at DESC LIMIT 20)e),'[]'::jsonb) AS history
   FROM keys k JOIN submissions s USING(unit,election,election_date) LEFT JOIN submission_reviews r ON r.submission_id=s.id
   ORDER BY k.first_received,k.unit,k.election,k.election_date,s.slot`;
export function addReportingRoutes(app,pool,wrap,db){
 app.use('/api/admin',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.get('/api/admin/session',(req,res)=>res.json({configured:adminConfigured(),username:sessionFromRequest(req)?.username||null}));
 app.post('/api/admin/login',rateLimit({windowMs:15*60000,limit:10,skipSuccessfulRequests:true,standardHeaders:'draft-8',legacyHeaders:false}),requireAdminRequest,(req,res)=>{
  if(!adminConfigured())return res.status(503).json({error:'Set ADMIN_PASSWORD (at least 16 characters) and SESSION_SECRET (at least 32 characters) on your server to enable admin sign-in.'});
  if(!credentialsMatch(req.body.username,req.body.password))return res.status(401).json({error:'Incorrect username or password.'});
  setSessionCookie(req,res,createSession(req.body.username));res.json({username:req.body.username});
 });
 app.post('/api/admin/logout',requireAdminRequest,(req,res)=>{setSessionCookie(req,res,'',true);res.json({ok:true});});
 app.get('/api/admin/queue',requireAdmin,db,wrap(async(req,res)=>{
  const status=['pending','approved','rejected','all'].includes(req.query.status)?req.query.status:'pending';
  const page=Math.max(0,Math.min(100000,parseInt(req.query.page)||0));const search=typeof req.query.search==='string'?req.query.search.slice(0,180):'';
  const rows=(await pool.query(queueQuery,[status,search,page*20])).rows;
  const grouped=new Map();for(const row of rows){const date=typeof row.election_date==='string'?row.election_date.slice(0,10):row.election_date.toISOString().slice(0,10);const key=JSON.stringify([row.unit,row.election,date]);if(!grouped.has(key))grouped.set(key,{unit:row.unit,election:row.election,date,location:row.location,submissions:[]});grouped.get(key).submissions.push(row);}
  res.json({groups:[...grouped.values()].slice(0,20),hasNext:grouped.size>20,page});
 }));
 app.post('/api/admin/review',requireAdminRequest,requireAdmin,db,wrap(async(req,res)=>{
  const {id,decision,reason}=req.body;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||!['approved','rejected','pending'].includes(decision)||typeof reason!=='string'||reason.trim().length<5||reason.length>2000)return res.status(400).json({error:'Choose a submission and decision, and enter a review note (5–2,000 characters).'});
  const result=await reviewSubmission(pool,id,decision,req.admin,reason.trim());res.status(result.status).json(result);
 }));
 app.get('/api/slots',wrap(async(req,res)=>{
  const {unit,election,date}=req.query;if(typeof unit!=='string'||!validElection(election,date))return res.status(400).json({error:'Choose a unit, election and valid date.'});
  const count=pool?Number((await pool.query('SELECT count(*) FROM submissions WHERE unit=$1 AND election=$2 AND election_date=$3',[unit,election,date])).rows[0].count):0;res.json({count,limit:3});
 }));
 app.get('/api/elections',wrap(async(req,res)=>{res.json(pool?(await pool.query('SELECT DISTINCT election,election_date::text AS date FROM submissions ORDER BY date DESC,election')).rows:[]);}));
 app.get('/api/totals',wrap(async(req,res)=>{
  const {election,date}=req.query;const levels={nation:-1,state:0,lga:1,ward:2,unit:3};const level=req.query.level||'nation';const scope=typeof req.query.scope==='string'&&req.query.scope?req.query.scope:null;
  if(!Object.hasOwn(levels,level)||!validElection(election,date)||scope?.length>100)return res.status(400).json({error:'Choose a valid election, date and reporting level.'});
  const page=Math.max(0,Math.min(100000,parseInt(req.query.page)||0));
  const rows=pool?(await pool.query(buildTotalsQuery(),[election,date,scope,levels[level],page*50])).rows:[];
  const groups=rows.map(r=>({...r,valid_votes:Number(r.valid_votes),registered:Number(r.registered),accredited:Number(r.accredited),rejected:Number(r.rejected),parties:rankedParties(r.parties)}));
  if(level==='nation'&&!groups.length)groups.push({id:'nation',name:'Nigeria',reporting_units:0,valid_votes:0,registered:0,accredited:0,rejected:0,parties:rankedParties([])});
  res.set('Cache-Control','no-store').json({election,date,level,scope,page,hasNext:page*50+50<(rows[0]?.group_count||0),groupCount:rows[0]?.group_count||0,updatedAt:new Date().toISOString(),groups,parties,partyNames});
 }));
}
