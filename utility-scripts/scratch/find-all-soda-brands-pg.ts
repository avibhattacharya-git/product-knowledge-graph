import pg from 'pg';

const pgPool = new pg.Pool({
  host: 'localhost',
  port: 5445,
  user: 'postgres',
  password: 'postgres',
  database: 'ProductData'
});

async function testCokeVectorRanks() {
  const pgClient = await pgPool.connect();
  try {
    console.log('=== Finding Top 20 Nearest Brand Embeddings to Coca-Cola (ID 677) Sharing a Category ===');
    const res = await pgClient.query(`
      SELECT 
        b2.id AS brand_id,
        b2.name AS brand_name,
        (b1.embedding <=> b2.embedding) AS distance,
        1 - (b1.embedding <=> b2.embedding) AS similarity
      FROM brands_search_mv b1
      JOIN brand_category_map_mv m1 ON m1.brand_id = b1.id
      JOIN brand_category_map_mv m2 ON m2.category_id = m1.category_id
      JOIN brands_search_mv b2 ON m2.brand_id = b2.id AND b2.id = m2.brand_id
      WHERE b1.id = '677' AND b2.id <> '677' AND b2.embedding IS NOT NULL
      GROUP BY b2.id, b2.name, b1.embedding, b2.embedding
      ORDER BY b1.embedding <=> b2.embedding ASC
      LIMIT 20
    `);
    
    console.log(`Rankings:`);
    res.rows.forEach((r, idx) => {
      console.log(`${idx + 1}. Brand: "${r.brand_name}" (ID: ${r.brand_id}) | Distance: ${parseFloat(r.distance).toFixed(4)} | Similarity: ${(parseFloat(r.similarity)*100).toFixed(2)}%`);
    });

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
  }
}

testCokeVectorRanks();
