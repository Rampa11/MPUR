import {pool} from '../db.js';
import {readFile} from 'node:fs/promises';
if (!pool) throw Error('Set DATABASE_URL in .env to your Neon connection string.');
try { await pool.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8')); console.log('Neon schema ready.'); } finally {await pool.end();}
