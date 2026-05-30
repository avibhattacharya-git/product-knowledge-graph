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
    console.log("Running optimized windowed partition vector query for Brands...");
    const startTime = Date.now();
    const res = await client.query(`
      WITH ranked_similarities AS (
        SELECT 
          b1.brand_id AS brand1_id,
          b2.brand_id AS brand2_id,
          (b1.embedding <=> b2.embedding) AS distance,
          ROW_NUMBER() OVER(PARTITION BY b1.brand_id ORDER BY (b1.embedding <=> b2.embedding) ASC) as rank
        FROM brand_embeddings b1
        JOIN brand_embeddings b2 ON b1.brand_id <> b2.brand_id
        WHERE (b1.embedding <=> b2.embedding) <= 0.16
      )
      SELECT brand1_id, brand2_id, distance
      FROM ranked_similarities
      WHERE rank <= 4
      LIMIT 20
    `);
    
    const duration = Date.now() - startTime;
    console.log(`Query completed in ${duration}ms, returned ${res.rows.length} rows.`);
    res.rows.forEach(row => {
      console.log(`- Brand1: ${row.brand1_id} | Brand2: ${row.brand2_id} | Distance: ${row.distance.toFixed(4)}`);
    });

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
