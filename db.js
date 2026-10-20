import pg from 'pg';
export const pool = process.env.DATABASE_URL ? new pg.Pool({connectionString:process.env.DATABASE_URL, max:5}) : null;
