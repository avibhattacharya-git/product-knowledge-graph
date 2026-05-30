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
    console.log("=== MINING SEMANTIC PRODUCT SUBSTITUTES VIA PGVECTOR ===");
    
    // Pick a famous active product to test (e.g. a baking mix or a dog treat)
    // We will query a product from global_products_search_mv that has an embedding in global_product_embeddings
    const sampleProductRes = await client.query(`
      SELECT p.id, p.name, p.brand_name, p.direct_category_ids
      FROM global_products_search_mv p
      JOIN global_product_embeddings pe ON pe.global_product_id = p.id
      WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
        AND p.name ILIKE '%dog%' AND p.name ILIKE '%treat%'
      LIMIT 1
    `);
    
    if (sampleProductRes.rows.length === 0) {
      console.log("Could not find a sample product with embeddings.");
      return;
    }
    
    const sample = sampleProductRes.rows[0];
    console.log(`Sample Product: "${sample.name}" (ID: ${sample.id} | Brand: ${sample.brand_name})`);
    console.log(`Categories: ${sample.direct_category_ids}`);

    // Query 10 nearest semantic products in the same category from global_product_embeddings
    const query = `
      SELECT 
        p2.id, 
        p2.name, 
        p2.brand_name,
        p2.msrp,
        (pe1.embedding <=> pe2.embedding) AS distance
      FROM global_product_embeddings pe1
      JOIN global_product_embeddings pe2 ON pe1.global_product_id <> pe2.global_product_id
      JOIN global_products_search_mv p2 ON p2.id = pe2.global_product_id
      WHERE pe1.global_product_id = $1
        AND p2.direct_category_ids = $2
        AND (p2.validation_state IS NULL OR p2.validation_state != 'INVALID')
      ORDER BY (pe1.embedding <=> pe2.embedding) ASC
      LIMIT 10
    `;
    
    const start = Date.now();
    const res = await client.query(query, [sample.id, sample.direct_category_ids]);
    const duration = Date.now() - start;
    
    console.log(`\nSemantic Substitutes found in ${duration}ms:`);
    console.log("---------------------------------------------------------------------------------");
    res.rows.forEach((r, idx) => {
      console.log(`  ${idx + 1}. "${r.name}"`);
      console.log(`     Brand: ${r.brand_name} | Price: $${parseFloat(r.msrp || '0').toFixed(2)}`);
      console.log(`     Distance: ${parseFloat(r.distance).toFixed(4)}`);
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
