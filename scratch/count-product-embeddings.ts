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
    console.log("=== COUNTING EMBEDDINGS TABLES ===");
    
    const gpRes = await client.query("SELECT COUNT(*) FROM global_product_embeddings");
    console.log(`global_product_embeddings: ${gpRes.rows[0].count} rows`);
    
    const bRes = await client.query("SELECT COUNT(*) FROM brand_embeddings");
    console.log(`brand_embeddings: ${bRes.rows[0].count} rows`);
    
    const cRes = await client.query("SELECT COUNT(*) FROM product_category_embeddings");
    console.log(`product_category_embeddings: ${cRes.rows[0].count} rows`);
    
    // Check if there are any products that have non-null embeddings in general
    // (Maybe the view global_products_search_mv doesn't join on global_product_embeddings or we don't have product embeddings populated)
    
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
