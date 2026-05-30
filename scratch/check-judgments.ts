import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
});

async function check() {
  try {
    const countRes = await pool.query(`
      SELECT relationship_type, count(*) as count 
      FROM category_relationships_cache 
      GROUP BY relationship_type
    `);
    
    console.log('=== Real-Time Category Judgment Statistics ===');
    let total = 0;
    countRes.rows.forEach(r => {
      const cnt = parseInt(r.count);
      total += cnt;
      console.log(`- ${r.relationship_type}: ${cnt.toLocaleString()} pairs`);
    });
    console.log(`Total Judged Pairs: ${total.toLocaleString()}`);

    const sampleRes = await pool.query(`
      SELECT r.relationship_type, c1.name as cat1, c2.name as cat2 
      FROM category_relationships_cache r
      JOIN product_categories_search_mv c1 ON c1.id::text = r.category1_id
      JOIN product_categories_search_mv c2 ON c2.id::text = r.category2_id
      WHERE r.relationship_type != 'NONE'
      ORDER BY r.evaluated_at DESC
      LIMIT 10
    `);

    console.log('\n=== Recent Semantic Discoveries ===');
    sampleRes.rows.forEach(r => {
      console.log(`* [${r.relationship_type}] ${r.cat1} <==> ${r.cat2}`);
    });
  } catch (err: any) {
    console.error('Error fetching judgments:', err.message);
  } finally {
    await pool.end();
  }
}

check();
