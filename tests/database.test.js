import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {reviewSubmission} from '../reviews.js';
import {buildTotalsQuery,approvedJoin,publicColumns} from '../reporting.js';
import {queueQuery} from '../admin-routes.js';
import {addReportingRoutes} from '../admin-routes.js';
import express from 'express';

test('Postgres approvals preserve submissions and count each unit once at every level',async()=>{
 const db=new PGlite();const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
 const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 const total=async(level=-1,scope=null,date='2027-02-20',election='Presidential')=>(await db.query(buildTotalsQuery(),[election,date,scope,level,0])).rows;
 const add=async(unit,slot,votes,date='2027-02-20',election='Presidential')=>{
  const id=randomUUID();const [state,lga,ward]=unit.split('/');const sum=votes.reduce((s,r)=>s+r.votes,0);
  const location=[{id:state,name:state==='10'?'DELTA':'EDO'},{id:state+'/'+lga,name:'LGA '+lga},{id:state+'/'+lga+'/'+ward,name:'WARD '+ward},{id:unit,name:'UNIT '+unit}];
  await db.query('INSERT INTO submissions(id,unit,election,election_date,slot,location,registered,accredited,rejected,votes,total,winners,file_type,file_data) VALUES($1,$2,$3,$4,$5,$6,$7,$7,0,$8,$7,$9,$10,$11)',[id,unit,election,date,slot,JSON.stringify(location),sum,JSON.stringify(votes),JSON.stringify([]),'application/pdf',new Uint8Array([37,80,68,70,45])]);return id;
 };
 try{
  await db.exec(schema);
  const first=await add('10/01/01/001',1,[{party:'NDC',votes:250},{party:'APC',votes:100},{party:'ADC',votes:50}]);
  const second=await add('10/01/01/001',2,[{party:'NDC',votes:200},{party:'APC',votes:150},{party:'ADC',votes:50}]);
  const third=await add('10/01/01/001',3,[{party:'PDP',votes:400}]);
  await db.exec(schema); // Migration is repeatable and existing reports stay pending.
  assert.equal((await total()).length,0);
  const queue=(await db.query(queueQuery,['pending','',0])).rows;
  assert.equal(queue.length,3);assert.ok(queue.every(r=>r.status==='pending'));
  assert.equal((await db.query(`SELECT ${publicColumns} FROM submissions s ${approvedJoin}`)).rows.length,0);
  assert.equal((await reviewSubmission(pool,first,'approved','admin','Checked signed sheet')).status,200);
  assert.equal((await reviewSubmission(pool,first,'approved','admin','Repeated decision')).unchanged,true);
  assert.equal((await reviewSubmission(pool,second,'approved','other-admin','Conflicting approval')).status,409);
  await assert.rejects(db.query("INSERT INTO submission_reviews(submission_id,unit,election,election_date,status,reviewed_by,reason) SELECT id,unit,election,election_date,'approved','admin','constraint test' FROM submissions WHERE id=$1",[second]),/unique|duplicate/i);
  assert.equal((await reviewSubmission(pool,third,'rejected','admin','Does not match sheet')).status,200);
  const rejectedGroup=(await db.query(queueQuery,['rejected','DELTA',0])).rows;
  assert.equal(rejectedGroup.length,3);assert.equal(rejectedGroup.find(r=>r.id===first).status,'approved');
  for(const level of [-1,0,1,2,3]){const groups=await total(level);assert.equal(groups.length,1);assert.equal(Number(groups[0].valid_votes),400);assert.equal(groups[0].reporting_units,1);}
  const otherUnit=await add('10/01/01/002',1,[{party:'NDC',votes:150},{party:'APC',votes:50}]);
  await reviewSubmission(pool,otherUnit,'approved','admin','Checked another unit');
  const otherState=await add('12/01/01/001',1,[{party:'NDC',votes:1},{party:'APC',votes:9}]);
  await reviewSubmission(pool,otherState,'approved','admin','Checked other state');
  const nextElection=await add('10/01/01/001',1,[{party:'APP',votes:99}],'2028-02-20');
  await reviewSubmission(pool,nextElection,'approved','admin','Checked next election');
  const differentType=await add('10/01/01/001',1,[{party:'PDP',votes:88}],'2027-02-20','Governorship');
  await reviewSubmission(pool,differentType,'approved','admin','Checked governorship');
  const nation=(await total())[0];assert.equal(Number(nation.valid_votes),610);assert.equal(nation.reporting_units,3);
  assert.equal(Number(nation.parties.find(p=>p.party==='NDC').votes),401);
  const delta=(await total(0,'10'))[0];assert.equal(Number(delta.valid_votes),600);assert.equal(delta.reporting_units,2);
  assert.equal((await total(0)).length,2);assert.equal((await total(3,'10/01/01')).length,2);
  assert.equal(Number((await total(-1,null,'2028-02-20'))[0].valid_votes),99);
  assert.equal(Number((await total(-1,null,'2027-02-20','Governorship'))[0].valid_votes),88);
  await assert.rejects(db.query('UPDATE submissions SET total=total WHERE id=$1',[first]),/permanent/i);
  await assert.rejects(db.query('DELETE FROM submissions WHERE id=$1',[first]),/permanent/i);
  await reviewSubmission(pool,first,'pending','admin','Rechecking sheet before replacement');
  assert.equal(Number((await total())[0].valid_votes),210);
  await reviewSubmission(pool,second,'approved','admin','Second sheet verified after review');
  assert.equal(Number((await total())[0].parties.find(p=>p.party==='NDC').votes),351);
  assert.equal(Number((await db.query('SELECT count(*) FROM review_events WHERE submission_id=$1',[first])).rows[0].count),2);
  await assert.rejects(db.query('DELETE FROM review_events WHERE submission_id=$1',[first]),/permanent/i);
  // Exercise real HTTP auth, CSRF checks, queue grouping and totals against this isolated database.
  const env={ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,SESSION_SECRET:process.env.SESSION_SECRET,ADMIN_USERNAME:process.env.ADMIN_USERNAME,NODE_ENV:process.env.NODE_ENV};
  process.env.ADMIN_PASSWORD='api-test-password-123';process.env.SESSION_SECRET='api-test-secret-longer-than-thirty-two-characters';process.env.ADMIN_USERNAME='reviewer';process.env.NODE_ENV='test';
  const app=express();app.use(express.json());addReportingRoutes(app,pool,fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next),(req,res,next)=>next());
  app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body,extra={})=>fetch(base+'/api/admin/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-MPUR-Admin':'1',...extra},body:JSON.stringify(body)});
  try{
   assert.equal((await fetch(base+'/api/admin/queue')).status,401);
   assert.equal((await post('review',{id:first,decision:'approved',reason:'Unauthorized request'})).status,401);
   assert.equal((await post('login',{username:'reviewer',password:'wrong'})).status,401);
   const login=await post('login',{username:'reviewer',password:'api-test-password-123'});assert.equal(login.status,200);
   const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
   const queueResponse=await fetch(base+'/api/admin/queue?status=all&search=DELTA',{headers:{cookie}});assert.equal(queueResponse.status,200);
   const body=await queueResponse.json();const group=body.groups.find(g=>g.unit==='10/01/01/001'&&g.election==='Presidential'&&g.date==='2027-02-20');assert.equal(group.submissions.length,3);
   assert.equal((await post('review',{id:first,decision:'approved',reason:'Cross site request'},{cookie,origin:'https://untrusted.example'})).status,403);
   assert.equal((await post('review',{id:first,decision:'approved',reason:'Concurrent conflicting selection'},{cookie})).status,409);
   const totalsResponse=await fetch(base+'/api/totals?election=Presidential&date=2027-02-20&level=state&scope=10');assert.equal(totalsResponse.status,200);
   const stateTotals=await totalsResponse.json();assert.equal(stateTotals.groups.length,1);assert.equal(stateTotals.groups[0].valid_votes,600);assert.equal(stateTotals.groups[0].parties.length,22);
   assert.equal((await fetch(base+'/api/totals?election=Presidential&date=2027-02-31')).status,400);
   const slots=await fetch(base+'/api/slots?unit=10%2F01%2F01%2F001&election=Presidential&date=2027-02-20');assert.equal((await slots.json()).count,3);
   const decision=await post('review',{id:first,decision:'rejected',reason:'Sheet does not match verified report'},{cookie});assert.equal(decision.status,200);
  }finally{await new Promise(resolve=>server.close(resolve));for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 }finally{await db.close();}
});
