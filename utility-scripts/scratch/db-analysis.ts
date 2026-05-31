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
    console.log("=== POSTGRESQL DATA ANALYSIS ===");

    // 1. Total rows in each materialized view
    const tables = [
      'global_products_search_mv',
      'brands_search_mv',
      'product_categories_search_mv',
      'brand_category_map_mv'
    ];
    for (const t of tables) {
      const res = await client.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`Table/View: ${t} | Total Rows: ${res.rows[0].count}`);
    }

    // 2. Active Brands vs Total Brands (Vector-embedded)
    const brandStats = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embedding,
        COUNT(CASE WHEN embedding IS NULL THEN 1 END) as without_embedding
      FROM brands_search_mv
    `);
    console.log("\nBrands Embeddings Stats:");
    console.log(`  - Total: ${brandStats.rows[0].total}`);
    console.log(`  - With Embeddings (Active): ${brandStats.rows[0].with_embedding}`);
    console.log(`  - Without Embeddings: ${brandStats.rows[0].without_embedding}`);

    // 3. Active Categories vs Total Categories (Vector-embedded)
    const catStats = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_embedding,
        COUNT(CASE WHEN embedding IS NULL THEN 1 END) as without_embedding
      FROM product_categories_search_mv
    `);
    console.log("\nCategories Embeddings Stats:");
    console.log(`  - Total: ${catStats.rows[0].total}`);
    console.log(`  - With Embeddings (Active): ${catStats.rows[0].with_embedding}`);
    console.log(`  - Without Embeddings: ${catStats.rows[0].without_embedding}`);

    // 4. Products filtering analysis
    console.log("\nAnalyzing Product Filters (Approach B)...");
    
    // Total valid products
    const validProds = await client.query(`
      SELECT COUNT(*) as count 
      FROM global_products_search_mv 
      WHERE (validation_state IS NULL OR validation_state != 'INVALID')
    `);
    console.log(`  - Total Valid Products (validation_state != 'INVALID'): ${validProds.rows[0].count}`);

    // Products with active brand
    const prodsWithActiveBrand = await client.query(`
      SELECT COUNT(*) as count 
      FROM global_products_search_mv p
      WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
        AND p.brand_id IN (SELECT id FROM brands_search_mv WHERE embedding IS NOT NULL)
    `);
    console.log(`  - Valid Products with Vector-Embedded Brand: ${prodsWithActiveBrand.rows[0].count}`);

    // Let's analyze how the direct_category_ids overlap works in Postgres
    // In PG, direct_category_ids is a text or varchar array or comma-separated string? Let's check how it's stored.
    // Let's inspect the data type and format of direct_category_ids in PG.
    const colInfo = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'global_products_search_mv' AND column_name = 'direct_category_ids'
    `);
    console.log(`  - 'direct_category_ids' data type: ${colInfo.rows[0]?.data_type}`);

    // Let's count how many products pass the category filter using SQL.
    // Wait, since direct_category_ids might be stored as an array or string, let's see. 
    // In etl.ts, we did:
    // const ids = Array.isArray(row.direct_category_ids) ? ... : row.direct_category_ids.replace(/[{}]/g, '').split(',')
    // In SQL, we can check if any category ID in direct_category_ids is in the set of active categories.
    // Let's write a query that simulates this. If direct_category_ids is a varchar array, we can use:
    // EXISTS (SELECT 1 FROM unnest(direct_category_ids) cat_id WHERE cat_id IN (SELECT id FROM product_categories_search_mv WHERE embedding IS NOT NULL))
    // Or if it is a text/string array or comma-separated. Let's inspect a few rows first.
    const sampleRows = await client.query(`
      SELECT id, direct_category_ids 
      FROM global_products_search_mv 
      WHERE direct_category_ids IS NOT NULL 
      LIMIT 5
    `);
    console.log("\nSample direct_category_ids values:");
    sampleRows.rows.forEach(r => {
      console.log(`  - Product ID: ${r.id} | direct_category_ids:`, r.direct_category_ids);
    });

    // Let's see if we can do the exact counts for products that pass BOTH filters in SQL
    // We'll try to query it using array operations or pattern matching if it's an array or text.
    let sqlBoth = "";
    if (colInfo.rows[0]?.data_type === 'ARRAY' || colInfo.rows[0]?.data_type?.includes('array') || Array.isArray(sampleRows.rows[0]?.direct_category_ids)) {
      sqlBoth = `
        SELECT COUNT(*) as count 
        FROM global_products_search_mv p
        WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
          AND p.brand_id IN (SELECT id FROM brands_search_mv WHERE embedding IS NOT NULL)
          AND EXISTS (
            SELECT 1 
            FROM unnest(p.direct_category_ids) AS cat_id
            WHERE TRIM(cat_id) IN (SELECT id FROM product_categories_search_mv WHERE embedding IS NOT NULL)
          )
      `;
    } else {
      // If it's a string, we can use string split or string_to_array
      sqlBoth = `
        SELECT COUNT(*) as count 
        FROM global_products_search_mv p
        WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
          AND p.brand_id IN (SELECT id FROM brands_search_mv WHERE embedding IS NOT NULL)
          AND EXISTS (
            SELECT 1 
            FROM unnest(string_to_array(replace(replace(p.direct_category_ids::text, '{', ''), '}', ''), ',')) AS cat_id
            WHERE TRIM(cat_id) IN (SELECT id FROM product_categories_search_mv WHERE embedding IS NOT NULL)
          )
      `;
    }

    const startQuery = Date.now();
    const bothRes = await client.query(sqlBoth);
    const duration = Date.now() - startQuery;
    console.log(`\nSQL-Filtered Product Count (satisfying both brand and category embedding filters):`);
    console.log(`  - Count: ${bothRes.rows[0].count}`);
    console.log(`  - SQL Query executed in: ${duration}ms`);

  } catch (err: any) {
    console.error('Error during analysis:', err.stack || err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
