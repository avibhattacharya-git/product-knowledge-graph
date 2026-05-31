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
    console.log("Checking global_products and global_product_embeddings tables...");
    const countProducts = await client.query("SELECT count(*) FROM global_products");
    const countEmbeddings = await client.query("SELECT count(*) FROM global_product_embeddings");
    
    console.log(`Total rows in global_products: ${countProducts.rows[0].count}`);
    console.log(`Total rows in global_product_embeddings: ${countEmbeddings.rows[0].count}`);

    if (parseInt(countEmbeddings.rows[0].count) > 0) {
      console.log("\nSample row from global_product_embeddings:");
      const sample = await client.query("SELECT * FROM global_product_embeddings LIMIT 1");
      const sampleRow = sample.rows[0];
      const embeddingLength = sampleRow.embedding ? (sampleRow.embedding.length || "unknown") : "null";
      console.log(`- global_product_id: ${sampleRow.global_product_id}`);
      console.log(`- embedding field present: ${!!sampleRow.embedding}`);
      console.log(`- embedding length/dimensions: ${embeddingLength}`);
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
