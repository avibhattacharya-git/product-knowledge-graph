import pg from 'pg';

const pgPool = new pg.Pool({
  host: 'localhost',
  port: 5445,
  user: 'postgres',
  password: 'postgres',
  database: 'ProductData'
});

async function run() {
  const client = await pgPool.connect();
  try {
    // 1. Inspect schema
    const colsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'global_product_category_relationships'
    `);
    console.log("Schema of global_product_category_relationships:");
    colsRes.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type})`);
    });

    // 2. Fetch sample rows
    const rowsRes = await client.query(`
      SELECT * FROM global_product_category_relationships LIMIT 10
    `);
    console.log("\nSample Rows:");
    console.log(JSON.stringify(rowsRes.rows, null, 2));

    // 3. Count unique relationship types
    const countRes = await client.query(`
      SELECT relationship_type, count(*) as count 
      FROM global_product_category_relationships 
      GROUP BY relationship_type
    `);
    console.log("\nRelationship Types and Counts:");
    countRes.rows.forEach(row => {
      console.log(`  - Type: ${row.relationship_type} | Count: ${row.count}`);
    });

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
