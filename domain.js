export const parties = ['A','AA','ADP','APP','AAC','ADC','APC','APGA','APM','BP','DLA','LP','NDP','NRM','NNPP','NDC','PDP','PRP','SDP','YPP','YP','ZLP'];
export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function validateSubmission(b) {
  if (typeof b.unit !== 'string' || !b.unit || !b.election || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || Number.isNaN(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0,10)!==b.date) throw Error('Choose a polling unit, election and valid election date.');
  if (!['Presidential','Governorship','Senate','House of Representatives','State Assembly','Local Government'].includes(b.election)) throw Error('Invalid election.');
  for (const key of ['registered','accredited','rejected']) if (!Number.isSafeInteger(b[key]) || b[key] < 0 || b[key] > 100000) throw Error('Voter counts must be whole numbers between 0 and 100,000.');
  if (b.accredited > b.registered) throw Error('Accredited voters cannot exceed registered voters.');
  if (!Array.isArray(b.votes) || !b.votes.length || b.votes.length > parties.length) throw Error('Enter party results.');
  const seen = new Set();
  for (const row of b.votes) { if (!parties.includes(row.party) || seen.has(row.party) || !Number.isSafeInteger(row.votes) || row.votes < 0) throw Error('Choose unique parties and enter valid whole vote counts.'); seen.add(row.party); }
  const total = b.votes.reduce((s,r)=>s+r.votes,0);
  if (total+b.rejected > b.accredited) throw Error('Votes plus rejected ballots cannot exceed accredited voters.');
  if (b.confirm !== true) throw Error('Confirm that you have carefully reviewed this permanent submission.');
  if (!b.file || !['image/jpeg','image/png','application/pdf'].includes(b.file.type)) throw Error('Upload a JPG, PNG or PDF result sheet.');
  if (typeof b.file.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.file.data)) throw Error('Invalid attachment.');
  const data = Buffer.from(b.file.data,'base64');
  if (!data.length || data.length > 5*1024*1024) throw Error('Result sheet must be at most 5 MB.');
  const valid = b.file.type==='application/pdf' ? data.subarray(0,5).toString()==='%PDF-' : b.file.type==='image/png' ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : data[0]===255 && data[1]===216 && data[2]===255;
  if (!valid) throw Error('Attachment contents do not match the selected file type.');
  const max = Math.max(...b.votes.map(r=>r.votes));
  return {total,winners:max===0?[]:b.votes.filter(r=>r.votes===max).map(r=>r.party),data};
}
