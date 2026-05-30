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
    console.log("=== MINING CROSS-BRAND CATEGORY COMPLEMENT CANDIDATES ===");
    
    // Query finds candidates using pgvector cosine distance between active Level 1/2 categories with embeddings
    const query = `
      WITH dept_categories AS (
        SELECT id, name, embedding 
        FROM product_categories_search_mv
        WHERE embedding IS NOT NULL 
          AND (category_level = 2 OR category_level = 1)
      ),
      candidate_pairs AS (
        SELECT DISTINCT ON (c1.id, c2.id)
          c1.id AS cat1_id,
          c1.name AS cat1_name,
          c2.id AS cat2_id,
          c2.name AS cat2_name,
          (c1.embedding <=> c2.embedding) AS distance
        FROM dept_categories c1
        JOIN dept_categories c2 ON c1.id <> c2.id
      ),
      ranked_candidates AS (
        SELECT 
          cat1_id, cat1_name, cat2_id, cat2_name, distance,
          ROW_NUMBER() OVER(PARTITION BY cat1_id ORDER BY distance ASC) as rank
        FROM candidate_pairs
      )
      SELECT cat1_id, cat1_name, cat2_id, cat2_name, distance
      FROM ranked_candidates
      WHERE rank <= 6
      LIMIT 40
    `;
    
    const start = Date.now();
    const res = await client.query(query);
    const duration = Date.now() - start;
    
    console.log(`Query completed in ${duration}ms, returned ${res.rows.length} rows.`);
    console.log("\nSample Cross-Brand Category Pairs (Target Candidates):");
    console.log("---------------------------------------------------------------------------------");
    res.rows.forEach(r => {
      console.log(`  - Category 1: "${r.cat1_name}" (ID: ${r.cat1_id})`);
      console.log(`    Category 2: "${r.cat2_name}" (ID: ${r.cat2_id})`);
      console.log(`    Distance: ${parseFloat(r.distance).toFixed(4)}`);
      console.log("---------------------------------------------------------------------------------");
    });

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
