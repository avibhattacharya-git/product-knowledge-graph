import pg from 'pg';
import neo4j from 'neo4j-driver';
import 'dotenv/config';

// 1. Initialize DB Pools
const pgPool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5445'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData'
});

const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  )
);

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0.90; // fallback default similarity
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

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

async function runSync() {
  console.log('======================================================');
  console.log('  STARTING INTEGRATED RELATIONSHIP SIMILARITY SYNC  ');
  console.log('======================================================\n');

  const pgClient = await pgPool.connect();
  const neoSession = neoDriver.session();
  const startTime = Date.now();

  try {
    // ========================================================
    // A. Brand COMPETES_WITH similarity
    // ========================================================
    console.log('1. Fetching COMPETES_WITH brand pairs from Neo4j...');
    const brandPairsRes = await neoSession.run(`
      MATCH (b1:Brand)-[:COMPETES_WITH]-(b2:Brand)
      RETURN DISTINCT b1.id AS b1, b2.id AS b2
    `);
    console.log(`--> Found ${brandPairsRes.records.length} brand competitor pairs in Neo4j.`);

    if (brandPairsRes.records.length > 0) {
      const brandIdsSet = new Set<string>();
      const pairs: [string, string][] = [];
      brandPairsRes.records.forEach(rec => {
        const b1 = String(rec.get('b1')).trim();
        const b2 = String(rec.get('b2')).trim();
        brandIdsSet.add(b1);
        brandIdsSet.add(b2);
        pairs.push([b1, b2]);
      });

      console.log(`--> Total distinct brands involved: ${brandIdsSet.size}`);

      // Fetch all embeddings for these brands in one go
      const brandIdsArr = Array.from(brandIdsSet);
      console.log('--> Fetching brand embeddings from Postgres...');
      const brandEmbRes = await pgClient.query(`
        SELECT id, embedding FROM brands_search_mv
        WHERE id = ANY($1) AND embedding IS NOT NULL
      `, [brandIdsArr]);

      console.log(`--> Retained ${brandEmbRes.rows.length} brand embeddings from PostgreSQL.`);

      const brandEmbeddingsMap = new Map<string, number[]>();
      brandEmbRes.rows.forEach(row => {
        const parsed = parseEmbedding(row.embedding);
        if (parsed) {
          brandEmbeddingsMap.set(String(row.id).trim(), parsed);
        }
      });

      // Calculate similarities in memory
      console.log('--> Calculating brand similarities in memory...');
      const brandLinksToUpdate: { b1: string; b2: string; similarity: number }[] = [];
      pairs.forEach(([b1, b2]) => {
        const emb1 = brandEmbeddingsMap.get(b1);
        const emb2 = brandEmbeddingsMap.get(b2);
        if (emb1 && emb2) {
          const sim = cosineSimilarity(emb1, emb2);
          brandLinksToUpdate.push({ b1, b2, similarity: sim });
        }
      });
      console.log(`--> Prepared ${brandLinksToUpdate.length} brand similarities to update.`);

      // Batch update in Neo4j
      if (brandLinksToUpdate.length > 0) {
        const batchSize = 2000;
        let brandUpdatedCount = 0;
        for (let i = 0; i < brandLinksToUpdate.length; i += batchSize) {
          const chunk = brandLinksToUpdate.slice(i, i + batchSize);
          const updateRes = await neoSession.run(`
            UNWIND $links AS link
            MATCH (b1:Brand {id: link.b1})-[r:COMPETES_WITH]-(b2:Brand {id: link.b2})
            SET r.similarity = toFloat(link.similarity)
            RETURN count(r) AS count
          `, { links: chunk });
          brandUpdatedCount += updateRes.records[0].get('count').toInt();
        }
        console.log(`--> Successfully updated ${brandUpdatedCount} COMPETES_WITH brand relationships in Neo4j.`);
      }
    }

    // ========================================================
    // B. Category COMPLEMENTARY_TO and SUBSTITUTE_CATEGORY similarity
    // ========================================================
    console.log('\n2. Fetching Category relationships from Neo4j...');
    
    // Complementary category pairs
    const compPairsRes = await neoSession.run(`
      MATCH (c1:Category)-[:COMPLEMENTARY_TO]-(c2:Category)
      RETURN DISTINCT c1.id AS c1, c2.id AS c2
    `);
    console.log(`--> Found ${compPairsRes.records.length} COMPLEMENTARY_TO category pairs in Neo4j.`);

    // Substitute category pairs
    const subPairsRes = await neoSession.run(`
      MATCH (c1:Category)-[:SUBSTITUTE_CATEGORY]-(c2:Category)
      RETURN DISTINCT c1.id AS c1, c2.id AS c2
    `);
    console.log(`--> Found ${subPairsRes.records.length} SUBSTITUTE_CATEGORY category pairs in Neo4j.`);

    const catIdsSet = new Set<string>();
    const compPairs: [string, string][] = [];
    const subPairs: [string, string][] = [];

    compPairsRes.records.forEach(rec => {
      const c1 = String(rec.get('c1')).trim();
      const c2 = String(rec.get('c2')).trim();
      catIdsSet.add(c1);
      catIdsSet.add(c2);
      compPairs.push([c1, c2]);
    });

    subPairsRes.records.forEach(rec => {
      const c1 = String(rec.get('c1')).trim();
      const c2 = String(rec.get('c2')).trim();
      catIdsSet.add(c1);
      catIdsSet.add(c2);
      subPairs.push([c1, c2]);
    });

    console.log(`--> Total distinct categories involved: ${catIdsSet.size}`);

    if (catIdsSet.size > 0) {
      const catIdsArr = Array.from(catIdsSet);
      console.log('--> Fetching category embeddings from Postgres...');
      const catEmbRes = await pgClient.query(`
        SELECT id, embedding FROM product_categories_search_mv
        WHERE id = ANY($1) AND embedding IS NOT NULL
      `, [catIdsArr]);

      console.log(`--> Retained ${catEmbRes.rows.length} category embeddings from PostgreSQL.`);

      const catEmbeddingsMap = new Map<string, number[]>();
      catEmbRes.rows.forEach(row => {
        const parsed = parseEmbedding(row.embedding);
        if (parsed) {
          catEmbeddingsMap.set(String(row.id).trim(), parsed);
        }
      });

      // Calculate category complementary similarities in memory
      console.log('--> Calculating category complementary similarities in memory...');
      const compLinksToUpdate: { c1: string; c2: string; similarity: number }[] = [];
      compPairs.forEach(([c1, c2]) => {
        const emb1 = catEmbeddingsMap.get(c1);
        const emb2 = catEmbeddingsMap.get(c2);
        if (emb1 && emb2) {
          const sim = cosineSimilarity(emb1, emb2);
          compLinksToUpdate.push({ c1, c2, similarity: sim });
        }
      });
      console.log(`--> Prepared ${compLinksToUpdate.length} COMPLEMENTARY_TO similarities to update.`);

      // Calculate category substitute similarities in memory
      console.log('--> Calculating category substitute similarities in memory...');
      const subLinksToUpdate: { c1: string; c2: string; similarity: number }[] = [];
      subPairs.forEach(([c1, c2]) => {
        const emb1 = catEmbeddingsMap.get(c1);
        const emb2 = catEmbeddingsMap.get(c2);
        if (emb1 && emb2) {
          const sim = cosineSimilarity(emb1, emb2);
          subLinksToUpdate.push({ c1, c2, similarity: sim });
        }
      });
      console.log(`--> Prepared ${subLinksToUpdate.length} SUBSTITUTE_CATEGORY similarities to update.`);

      // Batch update COMPLEMENTARY_TO in Neo4j
      if (compLinksToUpdate.length > 0) {
        const batchSize = 1000;
        let compUpdatedCount = 0;
        for (let i = 0; i < compLinksToUpdate.length; i += batchSize) {
          const chunk = compLinksToUpdate.slice(i, i + batchSize);
          const updateRes = await neoSession.run(`
            UNWIND $links AS link
            MATCH (c1:Category {id: link.c1})-[r:COMPLEMENTARY_TO]-(c2:Category {id: link.c2})
            SET r.similarity = toFloat(link.similarity)
            RETURN count(r) AS count
          `, { links: chunk });
          compUpdatedCount += updateRes.records[0].get('count').toInt();
        }
        console.log(`--> Successfully updated ${compUpdatedCount} COMPLEMENTARY_TO relationships in Neo4j.`);
      }

      // Batch update SUBSTITUTE_CATEGORY in Neo4j
      if (subLinksToUpdate.length > 0) {
        const batchSize = 1000;
        let subUpdatedCount = 0;
        for (let i = 0; i < subLinksToUpdate.length; i += batchSize) {
          const chunk = subLinksToUpdate.slice(i, i + batchSize);
          const updateRes = await neoSession.run(`
            UNWIND $links AS link
            MATCH (c1:Category {id: link.c1})-[r:SUBSTITUTE_CATEGORY]-(c2:Category {id: link.c2})
            SET r.similarity = toFloat(link.similarity)
            RETURN count(r) AS count
          `, { links: chunk });
          subUpdatedCount += updateRes.records[0].get('count').toInt();
        }
        console.log(`--> Successfully updated ${subUpdatedCount} SUBSTITUTE_CATEGORY relationships in Neo4j.`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`\n🎉 Integrated relationship similarity synchronization completed!`);
    console.log(`--> Time elapsed: ${(duration / 1000).toFixed(2)} seconds`);

  } catch (err: any) {
    console.error('\n[CRITICAL ERROR DURING SYNCHRONIZATION]:', err.stack || err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
    await neoSession.close();
    await neoDriver.close();
    console.log('\n======================================================');
    console.log('  SYNCHRONIZATION PIPELINE SHUTDOWN');
    console.log('======================================================');
  }
}

runSync();
