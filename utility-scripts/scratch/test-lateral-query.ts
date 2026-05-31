import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
});

async function testQuery() {
  console.log('Connecting to PostgreSQL...');
  const startTime = Date.now();
  try {
    console.log('Executing optimized CROSS JOIN LATERAL query for 5 sample brands...');
    
    const query = `
      SELECT 
        b1.id AS brand1_id,
        b1.name AS brand1_name,
        b2.id AS brand2_id,
        b2.name AS brand2_name,
        cat.name AS shared_category_name,
        b2.distance
      FROM (
        SELECT id, name, embedding 
        FROM brands_search_mv 
        WHERE embedding IS NOT NULL 
        LIMIT 5
      ) b1
      CROSS JOIN LATERAL (
        SELECT 
          b2_inner.id,
          b2_inner.name,
          m2.category_id,
          (b1.embedding <=> b2_inner.embedding) AS distance
        FROM brands_search_mv b2_inner
        JOIN brand_category_map_mv m1 ON m1.brand_id = b1.id
        JOIN brand_category_map_mv m2 ON m2.brand_id = b2_inner.id AND m2.category_id = m1.category_id
        WHERE b2_inner.id <> b1.id AND b2_inner.embedding IS NOT NULL
        ORDER BY b1.embedding <=> b2_inner.embedding ASC
        LIMIT 4
      ) b2
      JOIN product_categories_search_mv cat ON cat.id = b2.category_id
    `;
    
    const res = await pool.query(query);
    const duration = Date.now() - startTime;
    
    console.log('\n======================================================');
    console.log(`  QUERY EXECUTED SUCCESSFULLY IN ${duration}ms!`);
    console.log(`  Total candidate relationships returned: ${res.rows.length}`);
    console.log('======================================================\n');
    
    console.log('--- Brand Competitor Alignments ---');
    let currentBrand = '';
    res.rows.forEach(row => {
      if (row.brand1_name !== currentBrand) {
        currentBrand = row.brand1_name;
        console.log(`\nBrand: [${currentBrand}]`);
      }
      console.log(`  -> Competitor: ${row.brand2_name.padEnd(25)} | Category: ${row.shared_category_name.padEnd(35)} | Distance: ${parseFloat(row.distance).toFixed(4)}`);
    });
  } catch (err: any) {
    console.error('Error running lateral query test:', err.message);
  } finally {
    await pool.end();
  }
}

testQuery();
