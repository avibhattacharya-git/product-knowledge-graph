import pg from 'pg';

const pgPool = new pg.Pool({
  host: 'localhost',
  port: 5445,
  user: 'postgres',
  password: 'postgres',
  database: 'ProductData'
});

async function run() {
  const client = await pgPool.connect();
  try {
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log("Postgres Tables in Public Schema:");
    res.rows.forEach(r => {
      console.log(`  - ${r.table_name}`);
    });
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
