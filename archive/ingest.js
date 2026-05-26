require('dotenv').config();
const { Pool } = require('pg');
const neo4j = require('neo4j-driver');

// Initialize Databases
const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
});

const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  )
);

// Heuristic Complementary Category Map (for matching companion items)
const complementaryCategories = {
  'smartphones': ['headphones', 'chargers', 'cases', 'smartwatches', 'audio'],
  'headphones': ['smartphones', 'laptops', 'audio'],
  'consoles': ['controllers', 'headphones', 'gaming accessories'],
  'laptops': ['chargers', 'mice', 'keyboards', 'monitors', 'bags'],
  'baking': ['baking mixes', 'coatings', 'baking ingredients']
};

// Main execution function
async function runPipeline(pg, neo) {
  console.log('\n======================================================');
  console.log('  STARTING POSTGRESQL TO NEO4J KNOWLEDGE GRAPH ETL  ');
  console.log('======================================================\n');

  const pgClient = await pg.connect();
  const session = neo.session();

  try {
    // 1. Clean out the existing Neo4j Database
    console.log('Clearing old Neo4j graph state...');
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('Graph cleared.');

    // 2. Setup Constraints to ensure data integrity
    console.log('Creating unique constraints on nodes...');
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Product) REQUIRE p.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (b:Brand) REQUIRE b.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (m:Manufacturer) REQUIRE m.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (s:CatalogSource) REQUIRE s.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (c:Category) REQUIRE c.id IS UNIQUE');
    console.log('Constraints verified.');

    // 3. Load Unit of Measure Synonyms for Normalization!
    console.log('\nLoading unit of measure synonyms from measure_synonym table...');
    const measureMap = new Map();
    try {
      const measureRes = await pgClient.query('SELECT key, canonical_form FROM measure_synonym');
      measureRes.rows.forEach(row => {
        if (row.key && row.canonical_form) {
          measureMap.set(row.key.trim().toLowerCase(), row.canonical_form.trim());
        }
      });
      console.log(`Loaded ${measureMap.size} unit of measure synonyms for normalization.`);
    } catch (err) {
      console.warn('Could not load measure_synonym table, bypassing normalization:', err.message);
    }

    // 4. Ingest Categories tree directly from product_categories_search_mv!
    console.log('\nExtracting category trees directly from product_categories_search_mv...');
    const catRes = await pgClient.query(`
      SELECT id, name, parent_category_id, category_taxonomy, category_level 
      FROM product_categories_search_mv
      WHERE embedding IS NOT NULL
    `);
    console.log(`Extracted ${catRes.rows.length} category records.`);

    // Write Category Nodes and hierarchies into Neo4j
    const categoryIds = new Set();
    const categoryNames = new Map();
    
    console.log('Loading Categories into Neo4j (Taxonomies: IBOTTA, NIELSEN)...');
    for (const row of catRes.rows) {
      categoryIds.add(row.id);
      categoryNames.set(row.id, row.name);
      await session.run(`
        MERGE (c:Category {id: $id})
        ON CREATE SET c.name = $name, c.taxonomy = $taxonomy, c.level = $level
      `, {
        id: row.id,
        name: row.name,
        taxonomy: row.category_taxonomy || 'GENERAL_TAXONOMY',
        level: row.category_level ? parseInt(row.category_level) : 1
      });
    }

    console.log('Building Category parent-child taxonomy trees...');
    let parentEdgeCount = 0;
    for (const row of catRes.rows) {
      if (row.parent_category_id && categoryIds.has(row.parent_category_id)) {
        parentEdgeCount++;
        await session.run(`
          MATCH (child:Category {id: $childId})
          MATCH (parent:Category {id: $parentId})
          MERGE (child)-[:PARENT_CATEGORY]->(parent)
        `, {
          childId: row.id,
          parentId: row.parent_category_id
        });
      }
    }
    console.log(`Linked ${parentEdgeCount} PARENT_CATEGORY relationships in Neo4j.`);

    // 5. Ingest Brand profiles and Manufacturers directly from brands_search_mv!
    console.log('\nExtracting Brand profiles and Manufacturer trees from brands_search_mv...');
    const brandRes = await pgClient.query(`
      SELECT id, name, private_label, source, manufacturer_id, manufacturer_name
      FROM brands_search_mv
      WHERE embedding IS NOT NULL
    `);
    console.log(`Extracted ${brandRes.rows.length} Brand profiles.`);

    const brandIds = new Set();
    const manufacturerIds = new Set();
    
    console.log('Loading Brands & Manufacturers into Neo4j...');
    let brandCount = 0;
    let mfgCount = 0;
    let ownedByCount = 0;

    for (const row of brandRes.rows) {
      brandIds.add(row.id);
      brandCount++;
      
      // A. Create Brand Node
      await session.run(`
        MERGE (b:Brand {id: $id})
        ON CREATE SET b.name = $name, b.privateLabel = $privateLabel, b.source = $source
      `, {
        id: row.id,
        name: row.name,
        privateLabel: row.private_label === true,
        source: row.source || 'GENERAL'
      });

      // B. Create Manufacturer Node & Edge (if available)
      if (row.manufacturer_id && row.manufacturer_name) {
        ownedByCount++;
        if (!manufacturerIds.has(row.manufacturer_id)) {
          manufacturerIds.add(row.manufacturer_id);
          mfgCount++;
          await session.run(`
            MERGE (m:Manufacturer {id: $id})
            ON CREATE SET m.name = $name
          `, {
            id: row.manufacturer_id,
            name: row.manufacturer_name
          });
        }

        // Draw OWNED_BY edge
        await session.run(`
          MATCH (b:Brand {id: $brandId})
          MATCH (m:Manufacturer {id: $mfgId})
          MERGE (b)-[:OWNED_BY]->(m)
        `, {
          brandId: row.id,
          mfgId: row.manufacturer_id
        });
      }
    }
    console.log(`Loaded ${brandCount} Brand nodes, ${mfgCount} Manufacturer nodes, and drawn ${ownedByCount} OWNED_BY relationships in Neo4j.`);

    // 6. Extract Product records from PostgreSQL (filtering out INVALID products)
    console.log('\nExtracting high-quality product records (validation_state != INVALID) from PostgreSQL...');
    const viewName = process.env.PG_VIEW_PRODUCTS || 'global_products_search_mv';
    
    // We ingest 3000 rows spanning WALMART, BEST_BUY, IBOTTA, and NIELSEN and ensure validationState != INVALID
    const query = `
      SELECT * FROM ${viewName} 
      WHERE (validation_state IS NULL OR validation_state != 'INVALID')
      LIMIT 3000
    `;
    const productsRes = await pgClient.query(query);
    console.log(`Extracted ${productsRes.rows.length} valid product records from PostgreSQL.`);

    // 7. Map, Transform & Load data into Neo4j
    const uniqueProducts = new Map();
    const uniqueSources = new Set();

    // Relationship arrays
    const sourcedFromLinks = []; // array of { productId, sourceId }
    const belongsToLinks = []; // array of { productId, categoryId }
    const mfgByLinks = []; // array of { productId, brandId }

    // Map to keep track of brand properties for heuristics
    const brandPrivateLabelMap = new Map();
    brandRes.rows.forEach(b => {
      brandPrivateLabelMap.set(b.id, b.private_label === true);
    });

    // Loop to ingest and normalize raw database fields
    productsRes.rows.forEach((row, index) => {
      const productId = String(row.id || `prod_${index}`);
      const productName = String(row.name || `Product ${productId}`);
      
      const brandId = row.brand_id ? String(row.brand_id).trim() : null;
      const brandName = row.brand_name ? String(row.brand_name).trim() : null;

      const sourceName = String(row.source === 'WALMART_API' || row.source === 'WMT_COM' ? 'Walmart API' :
                                row.source === 'BEST_BUY' ? 'Best Buy API' :
                                row.source === 'IBOTTA' ? 'Ibotta Catalog' :
                                row.source === 'NIELSEN' ? 'Nielsen Product Data' : row.source).trim();
      const sourceId = sourceName.toLowerCase().replace(/[^a-z0-9]/g, '_');

      // Double-parse pricing & details
      const price = isNaN(parseFloat(row.msrp)) ? 0.00 : parseFloat(row.msrp);
      const size = row.item_size ? parseFloat(row.item_size) : null;
      
      // Perform Unit of Measure Normalization!
      let rawMeasure = String(row.item_measure || 'N/A').trim().toLowerCase();
      let measure = row.item_measure || 'N/A';
      if (measureMap.has(rawMeasure)) {
        measure = measureMap.get(rawMeasure); // Replace with canonical form!
      }

      const gtin = row.product_id_value || 'N/A';
      const validationState = row.validation_state || 'VALID';

      // Resolve product categories mapping directly from columns!
      let productCategoryId = null;
      let productCategoryName = null;

      if (row.direct_category_ids) {
        const ids = Array.isArray(row.direct_category_ids) 
          ? row.direct_category_ids 
          : String(row.direct_category_ids).replace(/[{}]/g, '').split(',');
        
        const validId = ids.find(id => categoryIds.has(String(id).trim()));
        if (validId) {
          productCategoryId = String(validId).trim();
          productCategoryName = categoryNames.get(productCategoryId);
        }
      }

      // Approach B filter: only include product if its brand and category are active/vector-embedded
      if (!brandId || !brandIds.has(brandId) || !productCategoryId || !categoryIds.has(productCategoryId)) {
        return; // skip this product to ensure 100% graph connectivity and vector search integrity
      }

      // Populate Node pools
      uniqueProducts.set(productId, {
        id: productId,
        name: productName,
        price,
        gtin,
        size,
        measure,
        validationState,
        brandId,
        brandName,
        category: productCategoryName,
        categoryId: productCategoryId
      });

      uniqueSources.add(sourceName);

      // Populate Links maps
      sourcedFromLinks.push({ productId, sourceId });
      belongsToLinks.push({ productId, categoryId: productCategoryId });
      mfgByLinks.push({ productId, brandId });
    });

    // A. Write CatalogSource Nodes
    console.log('Loading CatalogSources in Neo4j...');
    for (const source of uniqueSources) {
      const id = source.toLowerCase().replace(/[^a-z0-9]/g, '_');
      await session.run(`
        MERGE (s:CatalogSource {id: $id})
        ON CREATE SET s.name = $name
      `, { id, name: source });
    }

    // B. Write Product Nodes
    console.log('Loading Products in Neo4j...');
    const productsList = Array.from(uniqueProducts.values());
    
    // Batch run product nodes loading to be highly performant
    const chunk = 500;
    for (let i = 0; i < productsList.length; i += chunk) {
      const batch = productsList.slice(i, i + chunk);
      await session.run(`
        UNWIND $batch AS prod
        MERGE (p:Product {id: prod.id})
        ON CREATE SET p.name = prod.name, p.price = prod.price, p.gtin = prod.gtin, p.size = prod.size, p.measure = prod.measure, p.validationState = prod.validationState
      `, { batch });
    }

    // C. Draw Node-to-Ecosystem edges
    console.log('\nDrawing relationships (SOURCED_FROM, MANUFACTURED_BY, BELONGS_TO)...');
    
    // 1. Draw SOURCED_FROM relationships
    for (const link of sourcedFromLinks) {
      await session.run(`
        MATCH (p:Product {id: $productId})
        MATCH (s:CatalogSource {id: $sourceId})
        MERGE (p)-[:SOURCED_FROM]->(s)
      `, link);
    }

    // 2. Draw MANUFACTURED_BY relationships
    for (const link of mfgByLinks) {
      if (brandIds.has(link.brandId)) {
        await session.run(`
          MATCH (p:Product {id: $productId})
          MATCH (b:Brand {id: $brandId})
          MERGE (p)-[:MANUFACTURED_BY]->(b)
        `, link);
      }
    }

    // 3. Draw BELONGS_TO relationships
    for (const link of belongsToLinks) {
      if (categoryIds.has(link.categoryId)) {
        await session.run(`
          MATCH (p:Product {id: $productId})
          MATCH (c:Category {id: $categoryId})
          MERGE (p)-[:BELONGS_TO]->(c)
        `, link);
      }
    }

    // 7. Apply Competitive Intelligence Heuristics (MSRP-based Category Price Distribution)
    console.log('\nRunning Competitor, Substitute, and Complement Heuristics...');

    let competitorCount = 0;
    let substituteCount = 0;
    let complementaryCount = 0;

    // Group products by category to easily match rivals/substitutes
    const productsByCategory = new Map();
    productsList.forEach(p => {
      if (!productsByCategory.has(p.categoryId)) productsByCategory.set(p.categoryId, []);
      productsByCategory.get(p.categoryId).push(p);
    });

    for (const [catId, prods] of productsByCategory) {
      if (prods.length < 2) continue;

      const pricedProds = prods.filter(p => p.price && p.price > 0);
      if (pricedProds.length < 2) continue;

      const totalMsrp = pricedProds.reduce((sum, p) => sum + p.price, 0);
      const avgCategoryMsrp = totalMsrp / pricedProds.length;

      const sliceSize = Math.min(pricedProds.length, 35);
      const slicedProds = pricedProds.slice(0, sliceSize);

      for (let i = 0; i < slicedProds.length; i++) {
        for (let j = i + 1; j < slicedProds.length; j++) {
          const p1 = slicedProds[i];
          const p2 = slicedProds[j];

          const p1Price = p1.price;
          const p2Price = p2.price;

          const priceDiff = Math.abs(p1Price - p2Price);
          const avgPrice = (p1Price + p2Price) / 2;

          // A. Heuristic: COMPETES_WITH
          if (priceDiff / avgPrice <= 0.25) {
            competitorCount++;
            await session.run(`
              MATCH (p1:Product {id: $p1Id})
              MATCH (p2:Product {id: $p2Id})
              MERGE (p1)-[:COMPETES_WITH]->(p2)
              MERGE (p2)-[:COMPETES_WITH]->(p1)
            `, { p1Id: p1.id, p2Id: p2.id });
          }

          // B. Heuristic: SUBSTITUTE_FOR (Category MSRP Distribution replacement)
          const premiumThreshold = avgCategoryMsrp * 1.25;
          const budgetThreshold = avgCategoryMsrp * 0.8;

          if (p1Price >= premiumThreshold && p2Price <= budgetThreshold) {
            substituteCount++;
            await session.run(`
              MATCH (cheap:Product {id: $cheapId})
              MATCH (prem:Product {id: $premiumId})
              MERGE (cheap)-[:SUBSTITUTE_FOR]->(prem)
            `, { cheapId: p2.id, premiumId: p1.id });
          } else if (p2Price >= premiumThreshold && p1Price <= budgetThreshold) {
            substituteCount++;
            await session.run(`
              MATCH (cheap:Product {id: $cheapId})
              MATCH (prem:Product {id: $premiumId})
              MERGE (cheap)-[:SUBSTITUTE_FOR]->(prem)
            `, { cheapId: p1.id, premiumId: p2.id });
          }
        }
      }
    }

    // C. Heuristic: COMPLEMENTARY_TO (Ecosystem bundles)
    const limitComps = productsList.slice(0, 1000);
    for (let i = 0; i < limitComps.length; i++) {
      for (let j = i + 1; j < limitComps.length; j++) {
        const p1 = limitComps[i];
        const p2 = limitComps[j];

        const cat1 = p1.category.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const cat2 = p2.category.toLowerCase().replace(/[^a-z0-9]/g, '_');

        const isCompCategories = (complementaryCategories[cat1] && complementaryCategories[cat1].includes(cat2)) ||
                                 (complementaryCategories[cat2] && complementaryCategories[cat2].includes(cat1));

        const isSameBrand = p1.brandId === p2.brandId;

        if (isCompCategories && isSameBrand) {
          complementaryCount++;
          await session.run(`
            MATCH (p1:Product {id: $p1Id})
            MATCH (p2:Product {id: $p2Id})
            MERGE (p1)-[:COMPLEMENTARY_TO]->(p2)
            MERGE (p2)-[:COMPLEMENTARY_TO]->(p1)
          `, { p1Id: p1.id, p2Id: p2.id });
        }
      }
    }

    console.log(`Ecosystem heuristics complete:`);
    console.log(`  - Direct Competitor links created: ${competitorCount}`);
    console.log(`  - Substitution alternative links created: ${substituteCount}`);
    console.log(`  - Complementary accessory links created: ${complementaryCount}`);

    const stats = {
      products: uniqueProducts.size,
      brands: brandCount,
      manufacturers: mfgCount,
      sources: uniqueSources.size,
      categories: categoryIds.size,
      relationships: sourcedFromLinks.length + belongsToLinks.length + mfgByLinks.length + ownedByCount + competitorCount*2 + substituteCount + complementaryCount*2
    };

    console.log('\n======================================================');
    console.log('  ETL PIPELINE SUCCESSFULLY LOADED IN NEO4J  ');
    console.log('======================================================\n');
    return stats;

  } finally {
    pgClient.release();
    await session.close();
  }
}

async function run() {
  try {
    const stats = await runPipeline(pgPool, neoDriver);
    console.log('Execution finished successfully.', stats);
  } catch (error) {
    console.error('ETL script failed:', error);
  } finally {
    await pgPool.end();
    await neoDriver.close();
  }
}

if (require.main === module) {
  run();
}

module.exports = { runPipeline };
