import pg from 'pg';

const pgPool = new pg.Pool({
  host: 'localhost',
  port: 5445,
  user: 'postgres',
  password: 'postgres',
  database: 'ProductData'
});

async function testCokeCandidates() {
  const pgClient = await pgPool.connect();
  try {
    const candidateQuery = `
      SELECT 
        b1.id AS brand1_id,
        b1.name AS brand1_name,
        b2.id AS brand2_id,
        b2.name AS brand2_name,
        cat.name AS shared_category_name,
        b2.distance
      FROM brands_search_mv b1
      CROSS JOIN LATERAL (
        SELECT 
          b2_inner.id,
          b2_inner.name,
          (b1.embedding <=> b2_inner.embedding) AS distance
        FROM brands_search_mv b2_inner
        WHERE b2_inner.id <> b1.id AND b2_inner.embedding IS NOT NULL
        ORDER BY b1.embedding <=> b2_inner.embedding ASC
        LIMIT 15
      ) b2
      JOIN brand_category_map_mv m1 ON m1.brand_id = b1.id
      JOIN brand_category_map_mv m2 ON m2.brand_id = b2.id AND m2.category_id = m1.category_id
      JOIN product_categories_search_mv cat ON cat.id = m2.category_id
      WHERE b1.id = '677'
    `;
    const res = await pgClient.query(candidateQuery);
    console.log(`=== Candidates for Coca-Cola (ID 677) ===`);
    console.log(`Found ${res.rows.length} pairs:`);
    res.rows.forEach((r, idx) => {
      console.log(`${idx + 1}. "${r.brand1_name}" vs "${r.brand2_name}" | Category: "${r.shared_category_name}" | Distance: ${r.distance}`);
    });
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
  }
}

testCokeCandidates();
