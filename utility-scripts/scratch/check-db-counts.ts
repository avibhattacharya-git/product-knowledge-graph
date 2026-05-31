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
  const pgClient = await pgPool.connect();
  try {
    const brandsCount = await pgClient.query('SELECT count(*) FROM brand_embeddings');
    console.log('brand_embeddings count:', brandsCount.rows[0].count);
    
    const catsCount = await pgClient.query('SELECT count(*) FROM product_categories_search_mv WHERE category_level IN (1, 2) AND embedding IS NOT NULL');
    console.log('categories level 1/2 count:', catsCount.rows[0].count);

    const checkBrandsWithEmbedding = await pgClient.query('SELECT count(*) FROM brand_embeddings WHERE embedding IS NOT NULL');
    console.log('brand_embeddings with embedding count:', checkBrandsWithEmbedding.rows[0].count);
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
  }
}
run();
