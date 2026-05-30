import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
});

async function checkBrands() {
  try {
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'brand_competitor_judgments'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('=== Brand Competitive Mapping is starting up shortly... ===');
      return;
    }
    
    const countRes = await pool.query(`
      SELECT competes, count(*) as count 
      FROM brand_competitor_judgments 
      GROUP BY competes
    `);
    
    console.log('=== Real-Time Brand Competitor Judgment Statistics ===');
    let total = 0;
    countRes.rows.forEach(r => {
      const cnt = parseInt(r.count);
      total += cnt;
      console.log(`- Competes [${r.competes}]: ${cnt.toLocaleString()} pairs`);
    });
    console.log(`Total Judged Brand Pairs: ${total.toLocaleString()}`);

    const sampleRes = await pool.query(`
      SELECT b1.name as brand1, b2.name as brand2, r.competes
      FROM brand_competitor_judgments r
      JOIN brands_search_mv b1 ON b1.id = r.brand1_id
      JOIN brands_search_mv b2 ON b2.id = r.brand2_id
      WHERE r.competes = true
      ORDER BY r.evaluated_at DESC
      LIMIT 10
    `);

    console.log('\n=== Recent Direct Competitor Discoveries ===');
    if (sampleRes.rows.length === 0) {
      console.log('(No competitive brand matches evaluated yet - starting evaluations...)');
    } else {
      sampleRes.rows.forEach(r => {
        console.log(`* [COMPETES] ${r.brand1} <==> ${r.brand2}`);
      });
    }
  } catch (err: any) {
    console.error('Error fetching brand judgments:', err.message);
  } finally {
    await pool.end();
  }
}

checkBrands();
