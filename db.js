import pg from 'pg';
export const pool = process.env.DATABASE_URL ? new pg.Pool({connectionString:process.env.DATABASE_URL, max:5,connectionTimeoutMillis:10000,query_timeout:30000}) : null;
