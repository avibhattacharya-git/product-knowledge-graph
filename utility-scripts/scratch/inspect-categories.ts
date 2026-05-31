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
    console.log("=== CATEGORY INSPECTION ===");
    
    // Fetch a sample of category names and IDs
    const res = await client.query(`
      SELECT id, name, parent_category_id, category_level 
      FROM product_categories_search_mv 
      WHERE embedding IS NOT NULL
      LIMIT 40
    `);
    
    console.log("Sample Active Categories:");
    res.rows.forEach(r => {
      console.log(`  - ID: ${r.id} | Name: "${r.name}" | Level: ${r.category_level}`);
    });

    // Let's search for categories that match our blueprint keys (e.g. smartphone, console, etc.)
    const searchTerms = ['smartphones', 'headphones', 'consoles', 'laptops', 'baking', 'sodas', 'chips', 'pretzels'];
    console.log("\nSearching for blueprint term matches in category names:");
    for (const term of searchTerms) {
      const match = await client.query(`
        SELECT id, name 
        FROM product_categories_search_mv 
        WHERE embedding IS NOT NULL 
          AND (toLower(name) CONTAINS toLower($1) OR toLower(name) LIKE '%' || toLower($1) || '%')
        LIMIT 3
      `, [term]);
      
      console.log(`- Term "${term}":`);
      if (match.rows.length === 0) {
        console.log("  No matches found");
      } else {
        match.rows.forEach(m => {
          console.log(`  -> ID: ${m.id} | Name: "${m.name}"`);
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
