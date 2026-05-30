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
    console.log("=== MINING BRAND ASSORTMENT CO-OCCURRENCE (OPTIMIZED) ===");
    
    const query = `
      WITH active_brands AS (
        SELECT id FROM brands_search_mv WHERE embedding IS NOT NULL
      ),
      category_product_counts AS (
        SELECT 
          TRIM(cat_id) AS cat_id,
          COUNT(*) as product_count
        FROM global_products_search_mv p,
        unnest(string_to_array(replace(replace(p.direct_category_ids::text, '{', ''), '}', ''), ',')) AS cat_id
        WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
          AND p.direct_category_ids IS NOT NULL AND p.direct_category_ids != ''
        GROUP BY TRIM(cat_id)
        HAVING COUNT(*) >= 500
      ),
      active_cats AS (
        SELECT id, name FROM product_categories_search_mv WHERE embedding IS NOT NULL AND id IN (SELECT cat_id FROM category_product_counts)
      ),
      category_pairs AS (
        SELECT 
          m1.category_id AS cat1_id,
          m2.category_id AS cat2_id,
          COUNT(DISTINCT m1.brand_id) AS shared_brands_count
        FROM brand_category_map_mv m1
        JOIN brand_category_map_mv m2 ON m1.brand_id = m2.brand_id AND m1.category_id < m2.category_id
        WHERE m1.brand_id IN (SELECT id FROM active_brands)
          AND m1.category_id IN (SELECT id FROM active_cats)
          AND m2.category_id IN (SELECT id FROM active_cats)
        GROUP BY m1.category_id, m2.category_id
      )
      SELECT 
        c1.name AS category1_name,
        c2.name AS category2_name,
        cp.cat1_id,
        cp.cat2_id,
        cp.shared_brands_count
      FROM category_pairs cp
      JOIN active_cats c1 ON c1.id = cp.cat1_id
      JOIN active_cats c2 ON c2.id = cp.cat2_id
      WHERE cp.shared_brands_count >= 8
      ORDER BY cp.shared_brands_count DESC
      LIMIT 40
    `;
    
    const start = Date.now();
    const res = await client.query(query);
    const duration = Date.now() - start;
    
    console.log(`Query completed in ${duration}ms, returned ${res.rows.length} rows.`);
    console.log("\nSample Co-Occurring Category Pairs (Target Candidates):");
    console.log("---------------------------------------------------------------------------------");
    res.rows.forEach(r => {
      console.log(`  - Category 1: "${r.category1_name}"`);
      console.log(`    Category 2: "${r.category2_name}"`);
      console.log(`    Shared Brands Count: ${r.shared_brands_count}`);
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
