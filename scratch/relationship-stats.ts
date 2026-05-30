import pg from 'pg';
import 'dotenv/config';

const pgPool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5445'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData'
});

const complementaryCategories: Record<string, string[]> = {
  'smartphones': ['headphones', 'chargers', 'cases', 'smartwatches', 'audio'],
  'headphones': ['smartphones', 'laptops', 'audio'],
  'consoles': ['controllers', 'headphones', 'gaming accessories'],
  'laptops': ['chargers', 'mice', 'keyboards', 'monitors', 'bags'],
  'baking': ['baking mixes', 'coatings', 'baking ingredients'],
  'sodas': ['chips', 'snacks', 'pretzels']
};

async function run() {
  const client = await pgPool.connect();
  try {
    console.log("=== RELATIONSHIP EVALUATION DATA STATS ===");

    // 1. Calculate category-level complements count
    const catRes = await client.query(`
      SELECT id FROM product_categories_search_mv WHERE embedding IS NOT NULL
    `);
    const categoryIds = new Set(catRes.rows.map(r => String(r.id)));
    console.log(`Active Categories: ${categoryIds.size}`);

    let complementCount = 0;
    for (const cat1 in complementaryCategories) {
      if (categoryIds.has(cat1)) {
        complementaryCategories[cat1].forEach(cat2 => {
          if (categoryIds.has(cat2)) {
            complementCount++;
          }
        });
      }
    }
    console.log(`Potential Category COMPLEMENTARY_TO edges: ${complementCount * 2} (directed symmetric)`);

    // 2. Calculate brand overlaps (COMPETES_WITH)
    const brandRes = await client.query(`
      SELECT id FROM brands_search_mv WHERE embedding IS NOT NULL
    `);
    const brandIds = new Set(brandRes.rows.map(r => String(r.id)));
    console.log(`Active Brands: ${brandIds.size}`);

    const overlapRes = await client.query(`
      SELECT brand_id, category_id 
      FROM brand_category_map_mv 
      WHERE brand_id IS NOT NULL AND category_id IS NOT NULL
    `);

    const brandsByCategory = new Map<string, Set<string>>();
    overlapRes.rows.forEach(row => {
      const bId = String(row.brand_id);
      const cId = String(row.category_id);
      
      if (brandIds.has(bId) && categoryIds.has(cId)) {
        if (!brandsByCategory.has(cId)) {
          brandsByCategory.set(cId, new Set<string>());
        }
        brandsByCategory.get(cId)!.add(bId);
      }
    });

    let totalPairs = 0;
    const addedPairs = new Set<string>();

    for (const [cId, brands] of brandsByCategory) {
      if (brands.size < 2) continue;
      const bArr = Array.from(brands);
      
      // Max 15 active brand rivals per category as implemented in etl.ts
      const sliceLen = Math.min(bArr.length, 15);
      for (let i = 0; i < sliceLen; i++) {
        for (let j = i + 1; j < sliceLen; j++) {
          const b1 = bArr[i];
          const b2 = bArr[j];
          const pairKey = b1 < b2 ? `${b1}_${b2}` : `${b2}_${b1}`;

          if (!addedPairs.has(pairKey)) {
            addedPairs.add(pairKey);
            totalPairs++;
          }
        }
      }
    }

    console.log(`\nBrand Overlaps in Categories:`);
    console.log(`  - Total unique COMPETES_WITH brand pairs: ${totalPairs}`);
    console.log(`  - Total directed COMPETES_WITH edges: ${totalPairs * 2}`);

  } catch (err: any) {
    console.error('Error in stats:', err.stack || err.message);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
