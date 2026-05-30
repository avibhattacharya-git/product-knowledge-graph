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
    console.log("=== BRAND AND CATEGORY FILTER BREAKDOWN ===");

    // 1. Check brand_id presence
    const brandPresence = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN brand_id IS NULL THEN 1 END) as null_brand,
        COUNT(CASE WHEN brand_id IS NOT NULL THEN 1 END) as non_null_brand
      FROM global_products_search_mv
      WHERE (validation_state IS NULL OR validation_state != 'INVALID')
    `);
    console.log("Brand ID presence in valid products:");
    console.log(`  - Total Valid Products: ${brandPresence.rows[0].total}`);
    console.log(`  - Null Brand ID: ${brandPresence.rows[0].null_brand} (${((brandPresence.rows[0].null_brand / brandPresence.rows[0].total) * 100).toFixed(2)}%)`);
    console.log(`  - Non-Null Brand ID: ${brandPresence.rows[0].non_null_brand} (${((brandPresence.rows[0].non_null_brand / brandPresence.rows[0].total) * 100).toFixed(2)}%)`);

    // 2. Check why non-null brand_ids are not in active brands
    const brandOverlap = await client.query(`
      SELECT 
        COUNT(*) as count
      FROM global_products_search_mv p
      WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
        AND p.brand_id IS NOT NULL
        AND p.brand_id NOT IN (SELECT id FROM brands_search_mv)
    `);
    console.log("\nBrand ID overlap check:");
    console.log(`  - Products with brand_id NOT in brands_search_mv: ${brandOverlap.rows[0].count}`);

    const brandNoEmbedding = await client.query(`
      SELECT 
        COUNT(*) as count
      FROM global_products_search_mv p
      WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
        AND p.brand_id IS NOT NULL
        AND p.brand_id IN (SELECT id FROM brands_search_mv WHERE embedding IS NULL)
    `);
    console.log(`  - Products with brand_id in brands_search_mv but WITHOUT embeddings: ${brandNoEmbedding.rows[0].count}`);

    // 3. Category matching analysis
    const categoryPresence = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN direct_category_ids IS NULL OR direct_category_ids = '' THEN 1 END) as null_cat,
        COUNT(CASE WHEN direct_category_ids IS NOT NULL AND direct_category_ids != '' THEN 1 END) as non_null_cat
      FROM global_products_search_mv
      WHERE (validation_state IS NULL OR validation_state != 'INVALID')
    `);
    console.log("\nCategory ID presence in valid products:");
    console.log(`  - Null or Empty Category ID: ${categoryPresence.rows[0].null_cat} (${((categoryPresence.rows[0].null_cat / categoryPresence.rows[0].total) * 100).toFixed(2)}%)`);
    console.log(`  - Non-Empty Category ID: ${categoryPresence.rows[0].non_null_cat} (${((categoryPresence.rows[0].non_null_cat / categoryPresence.rows[0].total) * 100).toFixed(2)}%)`);

    // Check how many of those non-null categories have no matching category in the table at all
    const sqlNoCategoryMatch = `
      SELECT COUNT(*) as count 
      FROM global_products_search_mv p
      WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
        AND p.brand_id IN (SELECT id FROM brands_search_mv WHERE embedding IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 
          FROM unnest(string_to_array(replace(replace(p.direct_category_ids::text, '{', ''), '}', ''), ',')) AS cat_id
          WHERE TRIM(cat_id) IN (SELECT id FROM product_categories_search_mv)
        )
    `;
    const noCatMatchRes = await client.query(sqlNoCategoryMatch);
    console.log(`  - Valid products with active brands but ZERO matching categories in product_categories_search_mv: ${noCatMatchRes.rows[0].count}`);

  } catch (err: any) {
    console.error('Error during brand analysis:', err.stack || err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
