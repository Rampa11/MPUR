import {parties} from './domain.js';
export const elections=['Presidential','Governorship','Senate','House of Representatives','State Assembly','Local Government'];
export function validElection(election,date){return elections.includes(election)&&typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;}
export const approvedJoin='JOIN submission_reviews r ON r.submission_id=s.id AND r.status=\'approved\'';
export const publicColumns='s.id,s.unit,s.election,s.election_date,s.slot,s.location,s.registered,s.accredited,s.rejected,s.votes,s.total,s.winners,s.created_at';
export function rankedParties(rows){
 const counts=new Map(parties.map(p=>[p,0]));for(const row of rows)counts.set(row.party,Number(row.votes));
 const max=Math.max(0,...counts.values());const tied=[...counts.values()].filter(n=>n===max).length>1;
 return [...counts].map(([party,votes])=>({party,votes,status:max===0?'no_votes':votes===max?(tied?'tied':'leading'):'trailing'})).sort((a,b)=>b.votes-a.votes||a.party.localeCompare(b.party));
}
export function buildTotalsQuery(){return `WITH accepted AS (
 SELECT s.* FROM submissions s ${approvedJoin}
 WHERE s.election=$1 AND s.election_date=$2::date AND ($3::text IS NULL OR s.location @> jsonb_build_array(jsonb_build_object('id',$3::text)))
), grouped AS (
 SELECT CASE WHEN $4::int<0 THEN 'nation' ELSE location->$4::int->>'id' END AS id,
 CASE WHEN $4::int<0 THEN 'Nigeria' ELSE location->$4::int->>'name' END AS name,
 count(*)::int AS reporting_units,sum(total)::bigint AS valid_votes,sum(registered)::bigint AS registered,sum(accredited)::bigint AS accredited,sum(rejected)::bigint AS rejected
 FROM accepted GROUP BY 1,2
), party_totals AS (
 SELECT CASE WHEN $4::int<0 THEN 'nation' ELSE location->$4::int->>'id' END AS id,
 v->>'party' AS party,sum((v->>'votes')::bigint)::bigint AS votes
 FROM accepted CROSS JOIN LATERAL jsonb_array_elements(votes) v GROUP BY 1,2
)
SELECT g.*,count(*) OVER()::int AS group_count,COALESCE((SELECT jsonb_agg(jsonb_build_object('party',p.party,'votes',p.votes)) FROM party_totals p WHERE p.id=g.id),'[]'::jsonb) AS parties
FROM grouped g WHERE g.id IS NOT NULL ORDER BY g.name,g.id LIMIT 50 OFFSET $5`;}
