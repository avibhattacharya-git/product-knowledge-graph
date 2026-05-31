import pg from 'pg';

const pgPool = new pg.Pool({
  host: 'localhost',
  port: 5445,
  user: 'postgres',
  password: 'postgres',
  database: 'ProductData'
});

async function checkCokeJudgments() {
  const pgClient = await pgPool.connect();
  try {
    const res = await pgClient.query(`
      SELECT bcj.*, b1.name AS brand1_name, b2.name AS brand2_name
      FROM brand_competitor_judgments bcj
      JOIN brands_search_mv b1 ON bcj.brand1_id = b1.id
      JOIN brands_search_mv b2 ON bcj.brand2_id = b2.id
      WHERE b1.id IN ('677', '681', '44443') OR b2.id IN ('677', '681', '44443')
    `);
    
    console.log(`=== Judgments involving Coca-Cola (ID 677) ===`);
    console.log(`Found ${res.rows.length} entries:`);
    res.rows.forEach(r => {
      console.log(`- "${r.brand1_name}" (ID: ${r.brand1_id}) <-> "${r.brand2_name}" (ID: ${r.brand2_id}) | Competes: ${r.competes}`);
    });
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
  }
}

checkCokeJudgments();
