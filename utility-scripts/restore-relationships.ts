import pg from 'pg';
import neo4j from 'neo4j-driver';
import 'dotenv/config';

// 1. Initialize Connection Pools
const pgPool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5445'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData'
});

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

// Helpers
function parseEmbedding(embStr: any): number[] | null {
  if (!embStr) return null;
  if (Array.isArray(embStr)) return embStr;
  try {
    if (typeof embStr === 'string') {
      return embStr.replace(/[\[\]\s]/g, '').split(',').map(Number);
    }
  } catch (err) {
    // ignore
  }
  return null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0.85;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function restore() {
  console.log('======================================================');
  console.log('  STARTING SAFE SEMANTIC RELATIONSHIP RESTORATION      ');
  console.log('  (Target: bolt://localhost:7687 - Primary Graph)      ');
  console.log('======================================================\n');

  const pgClient = await pgPool.connect();
  const session = neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
  const startTime = Date.now();

  try {
    // ========================================================
    // 1. Restore Category PARENT_CATEGORY edges
    // ========================================================
    console.log('1. Querying PostgreSQL for category tree parents...');
    const catRes = await pgClient.query(`
      SELECT id, parent_category_id 
      FROM product_categories_search_mv
      WHERE embedding IS NOT NULL
    `);
    
    const categoryIds = new Set<string>();
    catRes.rows.forEach(r => categoryIds.add(String(r.id)));

    const parentLinks: any[] = [];
    catRes.rows.forEach(row => {
      if (row.parent_category_id && categoryIds.has(String(row.parent_category_id))) {
        parentLinks.push({ childId: String(row.id), parentId: String(row.parent_category_id) });
      }
    });

    if (parentLinks.length > 0) {
      console.log(`--> Loading ${parentLinks.length} PARENT_CATEGORY relationships into Neo4j...`);
      await session.run(`
        UNWIND $links AS link
        MATCH (child:Category {id: link.childId})
        MATCH (parent:Category {id: link.parentId})
        MERGE (child)-[:PARENT_CATEGORY]->(parent)
      `, { links: parentLinks });
      console.log('  [SUCCESS] PARENT_CATEGORY relationships loaded.');
    }

    // ========================================================
    // 2. Restore Brand OWNED_BY edges to Manufacturers
    // ========================================================
    console.log('\n2. Querying PostgreSQL for Brand ownership profiles...');
    const brandRes = await pgClient.query(`
      SELECT id, manufacturer_id, manufacturer_name
      FROM brands_search_mv
      WHERE embedding IS NOT NULL
    `);

    const brandIds = new Set<string>();
    const brandOwnedLinks: any[] = [];
    const manufacturerBatch: any[] = [];
    const manufacturerIds = new Set<string>();

    brandRes.rows.forEach(row => {
      const bId = String(row.id);
      brandIds.add(bId);

      if (row.manufacturer_id && row.manufacturer_name) {
        const mId = String(row.manufacturer_id);
        if (!manufacturerIds.has(mId)) {
          manufacturerIds.add(mId);
          manufacturerBatch.push({ id: mId, name: String(row.manufacturer_name) });
        }
        brandOwnedLinks.push({ brandId: bId, mfgId: mId });
      }
    });

    if (manufacturerBatch.length > 0) {
      console.log(`--> Ensuring ${manufacturerBatch.length} Manufacturer nodes exist...`);
      await session.run(`
        UNWIND $batch AS m
        MERGE (mfg:Manufacturer {id: m.id})
        ON CREATE SET mfg.name = m.name
      `, { batch: manufacturerBatch });
    }

    if (brandOwnedLinks.length > 0) {
      console.log(`--> Loading ${brandOwnedLinks.length} Brand OWNED_BY Manufacturer links...`);
      await session.run(`
        UNWIND $links AS link
        MATCH (b:Brand {id: link.brandId})
        MATCH (m:Manufacturer {id: link.mfgId})
        MERGE (b)-[:OWNED_BY]->(m)
      `, { links: brandOwnedLinks });
      console.log('  [SUCCESS] OWNED_BY relationships loaded.');
    }

    // ========================================================
    // 3. Restore Category COMPLEMENTARY_TO & SUBSTITUTE_CATEGORY edges
    // ========================================================
    console.log('\n3. Fetching cached category complements & substitutes from Postgres...');
    const catCacheRes = await pgClient.query(`
      SELECT category1_id, category2_id, relationship_type 
      FROM category_relationships_cache
      WHERE relationship_type IN ('COMPLEMENT', 'SUBSTITUTE')
    `);

    const complementsToLoad: { c1: string, c2: string }[] = [];
    const substitutesToLoad: { c1: string, c2: string }[] = [];
    const involvedCatIdsSet = new Set<string>();

    catCacheRes.rows.forEach(row => {
      const c1 = String(row.category1_id).trim();
      const c2 = String(row.category2_id).trim();
      involvedCatIdsSet.add(c1);
      involvedCatIdsSet.add(c2);

      if (row.relationship_type === 'COMPLEMENT') {
        complementsToLoad.push({ c1, c2 });
      } else {
        substitutesToLoad.push({ c1, c2 });
      }
    });

    console.log(`--> Found ${complementsToLoad.length} complements and ${substitutesToLoad.length} substitutes.`);

    if (involvedCatIdsSet.size > 0) {
      console.log(`--> Fetching category embeddings for ${involvedCatIdsSet.size} involved categories...`);
      const catEmbRes = await pgClient.query(`
        SELECT id, embedding FROM product_categories_search_mv 
        WHERE id = ANY($1) AND embedding IS NOT NULL
      `, [Array.from(involvedCatIdsSet)]);

      const catEmbeddingsMap = new Map<string, number[]>();
      catEmbRes.rows.forEach(row => {
        const parsed = parseEmbedding(row.embedding);
        if (parsed) {
          catEmbeddingsMap.set(String(row.id).trim(), parsed);
        }
      });

      const complementsWithSimilarity = complementsToLoad.map(item => {
        const emb1 = catEmbeddingsMap.get(item.c1);
        const emb2 = catEmbeddingsMap.get(item.c2);
        const similarity = (emb1 && emb2) ? cosineSimilarity(emb1, emb2) : 0.85;
        return { ...item, similarity };
      });

      const substitutesWithSimilarity = substitutesToLoad.map(item => {
        const emb1 = catEmbeddingsMap.get(item.c1);
        const emb2 = catEmbeddingsMap.get(item.c2);
        const similarity = (emb1 && emb2) ? cosineSimilarity(emb1, emb2) : 0.85;
        return { ...item, similarity };
      });

      if (complementsWithSimilarity.length > 0) {
        console.log(`--> Writing Category COMPLEMENTARY_TO edges (${complementsWithSimilarity.length} relationships)...`);
        const compBatchSize = 1000;
        for (let i = 0; i < complementsWithSimilarity.length; i += compBatchSize) {
          const chunk = complementsWithSimilarity.slice(i, i + compBatchSize);
          await session.run(`
            UNWIND $links AS link
            MATCH (c1:Category {id: link.c1})
            MATCH (c2:Category {id: link.c2})
            MERGE (c1)-[r1:COMPLEMENTARY_TO]->(c2)
            SET r1.similarity = toFloat(link.similarity)
            MERGE (c2)-[r2:COMPLEMENTARY_TO]->(c1)
            SET r2.similarity = toFloat(link.similarity)
          `, { links: chunk });
        }
      }

      if (substitutesWithSimilarity.length > 0) {
        console.log(`--> Writing Category SUBSTITUTE_CATEGORY edges (${substitutesWithSimilarity.length} relationships)...`);
        const compBatchSize = 1000;
        for (let i = 0; i < substitutesWithSimilarity.length; i += compBatchSize) {
          const chunk = substitutesWithSimilarity.slice(i, i + compBatchSize);
          await session.run(`
            UNWIND $links AS link
            MATCH (c1:Category {id: link.c1})
            MATCH (c2:Category {id: link.c2})
            MERGE (c1)-[r1:SUBSTITUTE_CATEGORY]->(c2)
            SET r1.similarity = toFloat(link.similarity)
            MERGE (c2)-[r2:SUBSTITUTE_CATEGORY]->(c1)
            SET r2.similarity = toFloat(link.similarity)
          `, { links: chunk });
        }
      }
      console.log('  [SUCCESS] Category similarity relationships loaded.');
    }

    // ========================================================
    // 4. Restore Brand COMPETES_WITH edges
    // ========================================================
    console.log('\n4. Fetching cached Brand competitor judgments from Postgres...');
    const brandCacheRes = await pgClient.query(`
      SELECT brand1_id, brand2_id 
      FROM brand_competitor_judgments
      WHERE competes = true
    `);

    const competitorsToLoad: { b1: string, b2: string }[] = [];
    const involvedBrandIdsSet = new Set<string>();

    brandCacheRes.rows.forEach(row => {
      const b1 = String(row.brand1_id).trim();
      const b2 = String(row.brand2_id).trim();
      involvedBrandIdsSet.add(b1);
      involvedBrandIdsSet.add(b2);
      competitorsToLoad.push({ b1, b2 });
    });

    console.log(`--> Found ${competitorsToLoad.length} competitive Brand pairs.`);

    if (involvedBrandIdsSet.size > 0) {
      console.log(`--> Fetching Brand embeddings for ${involvedBrandIdsSet.size} involved brands...`);
      const brandEmbRes = await pgClient.query(`
        SELECT id, embedding FROM brands_search_mv 
        WHERE id = ANY($1) AND embedding IS NOT NULL
      `, [Array.from(involvedBrandIdsSet)]);

      const brandEmbeddingsMap = new Map<string, number[]>();
      brandEmbRes.rows.forEach(row => {
        const parsed = parseEmbedding(row.embedding);
        if (parsed) {
          brandEmbeddingsMap.set(String(row.id).trim(), parsed);
        }
      });

      const competitorsWithSimilarity = competitorsToLoad.map(item => {
        const emb1 = brandEmbeddingsMap.get(item.b1);
        const emb2 = brandEmbeddingsMap.get(item.b2);
        const similarity = (emb1 && emb2) ? cosineSimilarity(emb1, emb2) : 0.90;
        return { ...item, similarity };
      });

      if (competitorsWithSimilarity.length > 0) {
        console.log(`--> Writing Brand COMPETES_WITH edges (${competitorsWithSimilarity.length} relationships)...`);
        const overlapBatch = 5000;
        for (let i = 0; i < competitorsWithSimilarity.length; i += overlapBatch) {
          const chunk = competitorsWithSimilarity.slice(i, i + overlapBatch);
          await session.run(`
            UNWIND $links AS link
            MATCH (b1:Brand {id: link.b1})
            MATCH (b2:Brand {id: link.b2})
            MERGE (b1)-[r1:COMPETES_WITH]->(b2)
            SET r1.similarity = toFloat(link.similarity)
            MERGE (b2)-[r2:COMPETES_WITH]->(b1)
            SET r2.similarity = toFloat(link.similarity)
          `, { links: chunk });
        }
      }
      console.log('  [SUCCESS] Brand COMPETES_WITH relationships loaded.');
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log('\n======================================================');
    console.log(`  ALL RELATIONSHIPS SAFELY RESTORED IN ${duration}s!`);
    console.log('======================================================\n');

  } catch (err: any) {
    console.error('\n[CRITICAL ERROR DURING RESTORATION]:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
    await session.close();
    await neoDriver.close();
  }
}

restore();
