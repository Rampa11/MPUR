import {pool} from '../db.js';
import {readFile} from 'node:fs/promises';
if (!pool) throw Error('Set DATABASE_URL in .env to your Neon connection string.');
let client;
try {
 client=await pool.connect();
 await client.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
 console.log('Neon schema ready, including approvals and review history.');
} finally {
 if(client){try{await client.query('ROLLBACK');}finally{client.release();}}
 await pool.end();
}
