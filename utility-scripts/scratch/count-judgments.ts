import pg from 'pg';

const pgPool = new pg.Pool({
  host: 'localhost',
  port: 5445,
  user: 'postgres',
  password: 'postgres',
  database: 'ProductData'
});

async function countJudgments() {
  const pgClient = await pgPool.connect();
  try {
    const res = await pgClient.query(`SELECT count(*) as count FROM brand_competitor_judgments`);
    console.log(`Current brand judgments count in PostgreSQL: ${parseInt(res.rows[0].count).toLocaleString()}`);
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
  }
}

countJudgments();
