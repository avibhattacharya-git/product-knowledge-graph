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
    console.log("=== FIXED CATEGORY INSPECTION ===");

    const searchTerms = ['smartphone', 'headphone', 'console', 'laptop', 'baking', 'soda', 'chip', 'pretzel', 'audio', 'case', 'charger', 'mouse', 'keyboard', 'monitor', 'bag'];
    console.log("\nSearching for blueprint term matches in category names (using ILIKE):");
    for (const term of searchTerms) {
      const match = await client.query(`
        SELECT id, name, category_level 
        FROM product_categories_search_mv 
        WHERE embedding IS NOT NULL 
          AND name ILIKE '%' || $1 || '%'
        LIMIT 5
      `, [term]);
      
      console.log(`- Term "${term}":`);
      if (match.rows.length === 0) {
        console.log("  No matches found");
      } else {
        match.rows.forEach(m => {
          console.log(`  -> ID: ${m.id} | Name: "${m.name}" | Level: ${m.category_level}`);
        });
      }
    }

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
