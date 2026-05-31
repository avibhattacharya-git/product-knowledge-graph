import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5445/ProductData'
  });

  try {
    const client = await pool.connect();
    try {
      // 1. Fetch counts
      const countRes = await client.query(`
        SELECT competes, COUNT(*) as count 
        FROM brand_competitor_judgments 
        GROUP BY competes
      `);
      
      let trueCount = 0;
      let falseCount = 0;
      countRes.rows.forEach(r => {
        if (r.competes === true) trueCount = parseInt(r.count);
        if (r.competes === false) falseCount = parseInt(r.count);
      });
      const total = trueCount + falseCount;

      console.log('--- STATS ---');
      console.log(`TOTAL:${total}`);
      console.log(`TRUE:${trueCount}`);
      console.log(`FALSE:${falseCount}`);

    // 3. List all relations in public schema
    const relsRes = await client.query(`
      SELECT c.relname AS relation_name,
             CASE c.relkind
               WHEN 'r' THEN 'table'
               WHEN 'v' THEN 'view'
               WHEN 'm' THEN 'materialized view'
             END AS relation_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'v', 'm')
      ORDER BY relation_type, relation_name
    `);
    console.log('\n--- ALL TABLES, VIEWS, AND MATERIALIZED VIEWS ---');
    console.log(JSON.stringify(relsRes.rows, null, 2));
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Database Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
