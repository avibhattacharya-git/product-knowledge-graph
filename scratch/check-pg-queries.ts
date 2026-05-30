import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
});

async function checkQueries() {
  try {
    const res = await pool.query(`
      SELECT 
        pid,
        state,
        query,
        age(clock_timestamp(), query_start) as duration
      FROM pg_stat_activity 
      WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%'
    `);
    
    console.log('=== Active PostgreSQL Queries ===');
    if (res.rows.length === 0) {
      console.log('No active queries running right now.');
    } else {
      res.rows.forEach(r => {
        console.log(`- PID [${r.pid}] (${r.state}) duration: ${JSON.stringify(r.duration)}`);
        console.log(`  Query: ${r.query.slice(0, 300)}...\n`);
      });
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkQueries();
