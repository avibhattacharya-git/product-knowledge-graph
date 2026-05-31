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
    console.log("=== TOP 50 ACTIVE CATEGORIES BY PRODUCT COUNT ===");
    
    // In SQL, we can parse the direct_category_ids or count from global_products_search_mv
    // Let's write a query that counts products per category ID, and joins with product_categories_search_mv to get the names
    
    const query = `
      WITH product_cats AS (
        SELECT 
          TRIM(cat_id) AS cat_id,
          COUNT(*) as product_count
        FROM global_products_search_mv p,
        unnest(string_to_array(replace(replace(p.direct_category_ids::text, '{', ''), '}', ''), ',')) AS cat_id
        WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
          AND p.direct_category_ids IS NOT NULL AND p.direct_category_ids != ''
        GROUP BY TRIM(cat_id)
      )
      SELECT 
        pc.cat_id AS id, 
        c.name AS category_name, 
        c.category_taxonomy AS taxonomy,
        c.category_level AS level,
        pc.product_count
      FROM product_cats pc
      JOIN product_categories_search_mv c ON c.id = pc.cat_id
      ORDER BY pc.product_count DESC
      LIMIT 50
    `;
    
    const start = Date.now();
    const res = await client.query(query);
    const duration = Date.now() - start;
    
    console.log(`Query completed in ${duration}ms.\n`);
    console.log("Rank | Category ID | Category Name | Taxonomy | Level | Product Count");
    console.log("-------------------------------------------------------------------------");
    res.rows.forEach((r, idx) => {
      console.log(`${String(idx + 1).padEnd(4)} | ${r.id.padEnd(36)} | ${r.category_name.padEnd(25)} | ${r.taxonomy.padEnd(16)} | L${r.level} | ${parseInt(r.product_count).toLocaleString()}`);
    });

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
