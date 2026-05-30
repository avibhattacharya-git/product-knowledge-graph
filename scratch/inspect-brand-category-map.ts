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
    console.log("=== INSPECTING brand_category_map_mv ===");

    // 1. Get column schema
    const colsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'brand_category_map_mv'
    `);
    console.log("Columns of brand_category_map_mv:");
    colsRes.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type})`);
    });

    // 2. Fetch sample rows
    const rowsRes = await client.query(`
      SELECT * 
      FROM brand_category_map_mv 
      WHERE brand_id IS NOT NULL AND category_id IS NOT NULL
      LIMIT 10
    `);
    console.log("\nSample Rows:");
    console.log(JSON.stringify(rowsRes.rows, null, 2));

    // 3. Inspect if we have count columns or ranking columns in the view
    // E.g., is there a product count per brand-category intersection?
    // Let's see if there is product_count, volume, etc.

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
