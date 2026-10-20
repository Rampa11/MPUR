import {randomUUID} from 'node:crypto';
export async function reviewSubmission(pool,id,decision,admin,reason){
 const client=await pool.connect();
 try{await client.query('BEGIN');const submission=(await client.query('SELECT id,unit,election,election_date FROM submissions WHERE id=$1',[id])).rows[0];
 if(!submission){await client.query('ROLLBACK');return {status:404,error:'Submission not found.'};}
 const date=typeof submission.election_date==='string'?submission.election_date.slice(0,10):submission.election_date.toISOString().slice(0,10);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[submission.unit+'|'+submission.election+'|'+date]);
 const existing=(await client.query('SELECT status FROM submission_reviews WHERE submission_id=$1',[id])).rows[0];
 if((existing?.status||'pending')===decision){await client.query('COMMIT');return {status:200,decision,unchanged:true};}
 if(decision==='approved'){
  const selected=(await client.query("SELECT submission_id FROM submission_reviews WHERE unit=$1 AND election=$2 AND election_date=$3 AND status='approved' AND submission_id<>$4",[submission.unit,submission.election,date,id])).rows[0];
  if(selected){await client.query('ROLLBACK');return {status:409,error:'Another submission is already approved for this polling unit and election. Return that report to pending before approving a replacement.'};}
 }
 await client.query(`INSERT INTO submission_reviews(submission_id,unit,election,election_date,status,reviewed_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(submission_id) DO UPDATE SET status=EXCLUDED.status,reviewed_by=EXCLUDED.reviewed_by,reason=EXCLUDED.reason,reviewed_at=now()`,[id,submission.unit,submission.election,date,decision,admin,reason]);
 await client.query('INSERT INTO review_events(id,submission_id,previous_status,status,reviewed_by,reason) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,existing?.status||'pending',decision,admin,reason]);
 await client.query('COMMIT');return {status:200,decision};
 }catch(e){await client.query('ROLLBACK');if(e.code==='23505')return {status:409,error:'An approved report already exists for this polling unit and election.'};throw e;}finally{client.release();}
}
