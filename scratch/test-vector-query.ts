import pg from 'pg';
import 'dotenv/config';

const pgPool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5445'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData'
});

async function run() {
  const client = await pgPool.connect();
  try {
    console.log("=== TESTING CANDIDATE PRUNING QUERY ===");
    const start = Date.now();
    
    const query = `
      WITH brand_candidates AS (
        SELECT 
          b1.id AS brand1_id,
          b1.name AS brand1_name,
          b2.id AS brand2_id,
          b2.name AS brand2_name,
          (b1.embedding <=> b2.embedding) AS distance,
          ROW_NUMBER() OVER(PARTITION BY b1.id ORDER BY (b1.embedding <=> b2.embedding) ASC) as rank
        FROM brands_search_mv b1
        JOIN brands_search_mv b2 ON b1.id <> b2.id
        WHERE b1.embedding IS NOT NULL AND b2.embedding IS NOT NULL
          AND EXISTS (
            SELECT 1 
            FROM brand_category_map_mv m1
            JOIN brand_category_map_mv m2 ON m1.category_id = m2.category_id
            WHERE m1.brand_id = b1.id AND m2.brand_id = b2.id
          )
      )
      SELECT brand1_id, brand1_name, brand2_id, brand2_name, distance
      FROM brand_candidates
      WHERE rank <= 4
      LIMIT 30
    `;
    
    const res = await client.query(query);
    const duration = Date.now() - start;
    
    console.log(`Query completed in ${duration}ms, returned ${res.rows.length} rows.`);
    console.log("Sample Brand Candidates:");
    res.rows.forEach(r => {
      console.log(`  - Brand 1: "${r.brand1_name}" (ID: ${r.brand1_id})`);
      console.log(`    Brand 2: "${r.brand2_name}" (ID: ${r.brand2_id})`);
      console.log(`    Distance: ${parseFloat(r.distance).toFixed(4)}`);
      console.log("------------------------------------------");
    });

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
