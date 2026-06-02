import { Pool } from 'pg';
import QueryStream from 'pg-query-stream';
import neo4j, { Driver } from 'neo4j-driver';
import { appConfig } from '../configs/app.config';
import { LlmService } from './llm.service';

// Blueprint for complementary category accessories
const complementaryCategories: Record<string, string[]> = {
  'smartphones': ['headphones', 'chargers', 'cases', 'smartwatches', 'audio'],
  'headphones': ['smartphones', 'laptops', 'audio'],
  'consoles': ['controllers', 'headphones', 'gaming accessories'],
  'laptops': ['chargers', 'mice', 'keyboards', 'monitors', 'bags'],
  'baking': ['baking mixes', 'coatings', 'baking ingredients'],
  'sodas': ['chips', 'snacks', 'pretzels']
};

export interface IngestionStats {
  products: number;
  brands: number;
  manufacturers: number;
  sources: number;
  categories: number;
  relationships: number;
  durationSeconds: number;
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

export class EtlService {
  constructor(
    private pgPool: Pool, 
    private neoDriver: Driver,
    private llmService: LlmService
  ) {}

  // =========================================================================
  // STAGE A: Admin & Database Maintenance
  // =========================================================================

  async truncateDatabase(): Promise<{ deletedRels: number; deletedNodes: number }> {
    console.log('Truncating old Neo4j graph state using failsafe two-phase batch deletion...');
    const session = this.neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
    const truncateStart = Date.now();
    let deletedRelsCount = 0;
    let deletedNodesCount = 0;
    
    try {
      // Phase A: Delete all relationships in chunks of 50k (prevents huge transactional locks)
      while (true) {
        const loopRes = await session.run(`
          MATCH ()-[r]->() WITH r LIMIT 50000 DELETE r RETURN count(r) as count
        `);
        const count = loopRes.records[0].get('count').toNumber();
        deletedRelsCount += count;
        if (count === 0) break;
      }
      
      // Phase B: Delete all nodes in chunks of 50k (extremely fast since 0 relationships exist!)
      while (true) {
        const loopRes = await session.run(`
          MATCH (n) WITH n LIMIT 50000 DELETE n RETURN count(n) as count
        `);
        const count = loopRes.records[0].get('count').toNumber();
        deletedNodesCount += count;
        if (count === 0) break;
      }
      console.log(`Neo4j database truncated successfully! Deleted ${deletedRelsCount.toLocaleString()} relationships and ${deletedNodesCount.toLocaleString()} nodes in ${Math.round((Date.now() - truncateStart) / 1000)}s.`);
      return { deletedRels: deletedRelsCount, deletedNodes: deletedNodesCount };
    } catch (err: any) {
      console.error('Failsafe truncation failed, trying emergency fallback DETACH DELETE:', err.message);
      await session.run('MATCH (n) DETACH DELETE n');
      return { deletedRels: 0, deletedNodes: 0 };
    } finally {
      await session.close();
    }
  }

  async verifySchemaConstraints(): Promise<void> {
    console.log('Verifying and establishing schema constraints...');
    const session = this.neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Product) REQUIRE p.id IS UNIQUE');
      await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (b:Brand) REQUIRE b.id IS UNIQUE');
      await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (m:Manufacturer) REQUIRE m.id IS UNIQUE');
      await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (c:Category) REQUIRE c.id IS UNIQUE');
      console.log('Neo4j unique constraints successfully verified.');
    } finally {
      await session.close();
    }
  }

  // =========================================================================
  // STAGE B: Category Topology Loader
  // =========================================================================

  async ingestCategoryTopology(): Promise<{ categories: number; parentLinksCount: number }> {
    console.log('\nExtracting active categories from product_categories_search_mv...');
    const pgClient = await this.pgPool.connect();
    const session = this.neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });

    try {
      const catRes = await pgClient.query(`
        SELECT id, name, parent_category_id, category_taxonomy, category_level 
        FROM ${appConfig.pgViews.categories}
        WHERE embedding IS NOT NULL
      `);
      console.log(`Loaded ${catRes.rows.length} categories from PostgreSQL.`);

      const categoryIds = new Set<string>();
      const categoryBatch: any[] = [];

      catRes.rows.forEach(row => {
        categoryIds.add(String(row.id));
        categoryBatch.push({
          id: String(row.id),
          name: String(row.name),
          taxonomy: row.category_taxonomy || 'GENERAL_TAXONOMY',
          level: row.category_level ? parseInt(row.category_level) : 1
        });
      });

      console.log('Loading Category nodes into Neo4j...');
      await session.run(`
        UNWIND $batch AS cat
        MERGE (c:Category {id: cat.id})
        ON CREATE SET c.name = cat.name, c.taxonomy = cat.taxonomy, c.level = cat.level
      `, { batch: categoryBatch });

      console.log('Mapping Category PARENT_CATEGORY edges in Neo4j...');
      const parentLinks: any[] = [];
      catRes.rows.forEach(row => {
        if (row.parent_category_id && categoryIds.has(String(row.parent_category_id))) {
          parentLinks.push({ childId: String(row.id), parentId: String(row.parent_category_id) });
        }
      });

      if (parentLinks.length > 0) {
        await session.run(`
          UNWIND $links AS link
          MATCH (child:Category {id: link.childId})
          MATCH (parent:Category {id: link.parentId})
          MERGE (child)-[:PARENT_CATEGORY]->(parent)
        `, { links: parentLinks });
      }
      console.log(`Successfully mapped ${parentLinks.length} PARENT_CATEGORY relationships.`);
      return { categories: categoryBatch.length, parentLinksCount: parentLinks.length };
    } finally {
      pgClient.release();
      await session.close();
    }
  }

  async ingestCategoryRelationships(): Promise<{ complements: number; substitutes: number }> {
    console.log('\nMapping category-level complements and substitutes...');
    const pgClient = await this.pgPool.connect();
    const session = this.neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
    const provider = appConfig.llm.activeProvider;
    const apiKey = provider === 'openai' ? appConfig.openAiApiKey
      : provider === 'anthropic' ? appConfig.anthropicApiKey
      : appConfig.geminiApiKey;

    try {
      // 1. Initialize table
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS category_relationships_cache (
          category1_id VARCHAR(50),
          category2_id VARCHAR(50),
          relationship_type VARCHAR(20) NOT NULL,
          evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (category1_id, category2_id)
        )
      `);
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_cat_relationships_lookup ON category_relationships_cache(category1_id, category2_id)
      `);

      // 2. Fetch existing cached relationships
      const catCacheRes = await pgClient.query(`SELECT category1_id, category2_id, relationship_type FROM category_relationships_cache`);
      const catCacheMap = new Map<string, string>();
      catCacheRes.rows.forEach(r => {
        const c1 = String(r.category1_id).trim();
        const c2 = String(r.category2_id).trim();
        const key = c1 < c2 ? `${c1}_${c2}` : `${c2}_${c1}`;
        catCacheMap.set(key, String(r.relationship_type).trim().toUpperCase());
      });
      console.log(`Loaded ${catCacheMap.size} cached category relationships.`);

      // 3. Query pgvector for semantic candidates (top 6 closest)
      const catCandidateQuery = `
        WITH dept_categories AS (
          SELECT id, name, embedding 
          FROM ${appConfig.pgViews.categories}
          WHERE embedding IS NOT NULL 
            AND (category_level = 2 OR category_level = 1)
        ),
        candidate_pairs AS (
          SELECT DISTINCT ON (c1.id, c2.id)
            c1.id AS cat1_id,
            c1.name AS cat1_name,
            c2.id AS cat2_id,
            c2.name AS cat2_name,
            (c1.embedding <=> c2.embedding) AS distance
          FROM dept_categories c1
          JOIN dept_categories c2 ON c1.id <> c2.id
        ),
        ranked_candidates AS (
          SELECT 
            cat1_id, cat1_name, cat2_id, cat2_name, distance,
            ROW_NUMBER() OVER(PARTITION BY cat1_id ORDER BY distance ASC) as rank
          FROM candidate_pairs
        )
        SELECT cat1_id, cat1_name, cat2_id, cat2_name, distance
        FROM ranked_candidates
        WHERE rank <= 6
      `;
      const catCandidateRes = await pgClient.query(catCandidateQuery);
      
      const uncachedCatCandidates: any[] = [];
      const complementsToLoad: { c1: string; c2: string }[] = [];
      const substitutesToLoad: { c1: string; c2: string }[] = [];

      catCandidateRes.rows.forEach(row => {
        const c1 = String(row.cat1_id).trim();
        const c2 = String(row.cat2_id).trim();
        const key = c1 < c2 ? `${c1}_${c2}` : `${c2}_${c1}`;

        if (catCacheMap.has(key)) {
          const type = catCacheMap.get(key);
          if (type === 'COMPLEMENT') {
            complementsToLoad.push({ c1, c2 });
          } else if (type === 'SUBSTITUTE') {
            substitutesToLoad.push({ c1, c2 });
          }
        } else {
          uncachedCatCandidates.push({
            key,
            cat1_id: c1,
            cat1_name: String(row.cat1_name).trim(),
            cat2_id: c2,
            cat2_name: String(row.cat2_name).trim()
          });
        }
      });
      console.log(`${complementsToLoad.length} complement and ${substitutesToLoad.length} substitute category pairs loaded directly from cache.`);

      // 4. Evaluate uncached ones using LLM with Self-Healing Queue Monitor
      if (uncachedCatCandidates.length > 0) {
        if (!apiKey || !appConfig.llm.ingestEnabled) {
          console.warn('API Key missing or explicitly disabled for ingestion, skipping category evaluation to preserve cache purity.');
        } else {
          console.log(`Starting batched LLM category evaluations for ${uncachedCatCandidates.length} pairs (Batch Size: 50)...`);
          const batchSize = 50;

          const processCategoryBatch = async (batch: any[]): Promise<boolean> => {
            const promptPayload = batch.map((item, idx) => ({
              id: `pair_${idx}`,
              catA: item.cat1_name,
              catB: item.cat2_name
            }));

            const prompt = `You are a retail category management expert.
Given a list of department-level category pairings, evaluate and classify their retail market relationship into one of three types:

1. 'COMPLEMENT': Products in these categories are frequently bought together or serve as companion accessories (e.g., Shampoo & Conditioner, Dog Care & Dog Toys).
2. 'SUBSTITUTE': Products in these categories represent alternative choices (e.g., White Bread & Sandwich Bread).
3. 'NONE': Unrelated categories or no direct complement/substitution (e.g., Seafood & Milk).

You must return a JSON object mapping each "id" to one of these three strings ('COMPLEMENT', 'SUBSTITUTE', or 'NONE'). No markdown wrapping, no explanation.

Input:
${JSON.stringify(promptPayload, null, 2)}
`;

            try {
              const rawText = await this.llmService.generateContent(prompt, 'ingest', true);
              const cleanedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
              const judgments = JSON.parse(cleanedText);

              const cacheQueries: Promise<any>[] = [];
              batch.forEach((item, idx) => {
                const id = `pair_${idx}`;
                const type = String(judgments[id] || 'NONE').toUpperCase().trim();
                const relationshipType = ['COMPLEMENT', 'SUBSTITUTE', 'NONE'].includes(type) ? type : 'NONE';
                
                cacheQueries.push(pgClient.query(
                  `INSERT INTO category_relationships_cache (category1_id, category2_id, relationship_type) 
                   VALUES ($1, $2, $3) ON CONFLICT (category1_id, category2_id) DO NOTHING`,
                  [item.cat1_id, item.cat2_id, relationshipType]
                ));

                if (relationshipType === 'COMPLEMENT') {
                  complementsToLoad.push({ c1: item.cat1_id, c2: item.cat2_id });
                } else if (relationshipType === 'SUBSTITUTE') {
                  substitutesToLoad.push({ c1: item.cat1_id, c2: item.cat2_id });
                }
              });
              await Promise.all(cacheQueries);
              return true;
            } catch (err: any) {
              console.error(`  ❌ [Category LLM Judge] Failed to process batch of size ${batch.length} (Skipping insert):`, err.message);
              return false;
            }
          };

          const totalBatches = Math.ceil(uncachedCatCandidates.length / batchSize);
          const pendingQueue: any[][] = [];
          for (let i = 0; i < totalBatches; i++) {
            const start = i * batchSize;
            pendingQueue.push(uncachedCatCandidates.slice(start, start + batchSize));
          }

          const concurrencyLimit = 2;
          let completedCount = 0;

          const runWorker = async (): Promise<void> => {
            while (true) {
              const chunk = pendingQueue.shift();
              if (!chunk) break;

              const success = await processCategoryBatch(chunk);
              if (success) {
                completedCount++;
                await new Promise(r => setTimeout(r, 2000));
              } else {
                console.warn(`  ⚠️ [Queue Monitor] Re-queueing failed category batch to the back of the queue...`);
                pendingQueue.push(chunk);
                await new Promise(r => setTimeout(r, 15000));
              }
            }
          };

          const workers: Promise<void>[] = [];
          for (let i = 0; i < Math.min(concurrencyLimit, totalBatches); i++) {
            workers.push(runWorker());
          }
          await Promise.all(workers);
        }
      }

      // 5. Query involved category embeddings to compute exact similarities
      const involvedCatIdsSet = new Set<string>();
      complementsToLoad.forEach(item => { involvedCatIdsSet.add(item.c1); involvedCatIdsSet.add(item.c2); });
      substitutesToLoad.forEach(item => { involvedCatIdsSet.add(item.c1); involvedCatIdsSet.add(item.c2); });
      
      const catEmbeddingsMap = new Map<string, number[]>();
      if (involvedCatIdsSet.size > 0) {
        const catEmbRes = await pgClient.query(`
          SELECT id, embedding FROM ${appConfig.pgViews.categories} 
          WHERE id = ANY($1) AND embedding IS NOT NULL
        `, [Array.from(involvedCatIdsSet)]);
        catEmbRes.rows.forEach(row => {
          const parsed = parseEmbedding(row.embedding);
          if (parsed) {
            catEmbeddingsMap.set(String(row.id).trim(), parsed);
          }
        });
      }

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

      console.log(`Writing Category COMPLEMENTARY_TO edges (${complementsWithSimilarity.length} relations)...`);
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

      console.log(`Writing Category SUBSTITUTE_CATEGORY edges (${substitutesWithSimilarity.length} relations)...`);
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

      return { complements: complementsToLoad.length, substitutes: substitutesToLoad.length };
    } finally {
      pgClient.release();
      await session.close();
    }
  }

  // =========================================================================
  // STAGE C: Brand & Corporate Alignment Loader
  // =========================================================================

  async ingestBrandTopology(): Promise<{ brands: number; manufacturers: number; ownedLinksCount: number }> {
    console.log('\nExtracting active brand profiles from brands_search_mv...');
    const pgClient = await this.pgPool.connect();
    const session = this.neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });

    try {
      const brandRes = await pgClient.query(`
        SELECT id, name, private_label, source, manufacturer_id, manufacturer_name
        FROM ${appConfig.pgViews.brands}
        WHERE embedding IS NOT NULL
      `);
      console.log(`Loaded ${brandRes.rows.length} active brands.`);

      const brandIds = new Set<string>();
      const brandBatch: any[] = [];
      const manufacturerBatch: any[] = [];
      const manufacturerIds = new Set<string>();
      const brandOwnedLinks: any[] = [];

      brandRes.rows.forEach(row => {
        const bId = String(row.id);
        brandIds.add(bId);
        brandBatch.push({
          id: bId,
          name: String(row.name),
          privateLabel: row.private_label === true,
          source: row.source || 'GENERAL'
        });

        if (row.manufacturer_id && row.manufacturer_name) {
          const mId = String(row.manufacturer_id);
          if (!manufacturerIds.has(mId)) {
            manufacturerIds.add(mId);
            manufacturerBatch.push({ id: mId, name: String(row.manufacturer_name) });
          }
          brandOwnedLinks.push({ brandId: bId, mfgId: mId });
        }
      });

      console.log('Loading Brand and Manufacturer nodes in Neo4j...');
      await session.run(`
        UNWIND $batch AS b
        MERGE (brand:Brand {id: b.id})
        ON CREATE SET brand.name = b.name, brand.privateLabel = b.privateLabel, brand.source = b.source
      `, { batch: brandBatch });

      if (manufacturerBatch.length > 0) {
        await session.run(`
          UNWIND $batch AS m
          MERGE (mfg:Manufacturer {id: m.id})
          ON CREATE SET mfg.name = m.name
        `, { batch: manufacturerBatch });
      }

      if (brandOwnedLinks.length > 0) {
        await session.run(`
          UNWIND $links AS link
          MATCH (b:Brand {id: link.brandId})
          MATCH (m:Manufacturer {id: link.mfgId})
          MERGE (b)-[:OWNED_BY]->(m)
        `, { links: brandOwnedLinks });
      }

      return { brands: brandBatch.length, manufacturers: manufacturerBatch.length, ownedLinksCount: brandOwnedLinks.length };
    } finally {
      pgClient.release();
      await session.close();
    }
  }

  async ingestBrandRelationships(): Promise<{ competitors: number }> {
    console.log('\nAnalyzing Brand-to-Brand competitive overlaps...');
    const pgClient = await this.pgPool.connect();
    const session = this.neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
    const provider = appConfig.llm.activeProvider;
    const apiKey = provider === 'openai' ? appConfig.openAiApiKey
      : provider === 'anthropic' ? appConfig.anthropicApiKey
      : appConfig.geminiApiKey;

    try {
      // 1. Initialize Table
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS brand_competitor_judgments (
          brand1_id VARCHAR(50),
          brand2_id VARCHAR(50),
          competes BOOLEAN NOT NULL,
          evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (brand1_id, brand2_id)
        )
      `);
      await pgClient.query(`
        CREATE INDEX IF NOT EXISTS idx_brand_judgments_lookup ON brand_competitor_judgments(brand1_id, brand2_id)
      `);

      // 2. Fetch existing cached judgments
      const cacheRes = await pgClient.query(`SELECT brand1_id, brand2_id, competes FROM brand_competitor_judgments`);
      const cacheMap = new Map<string, boolean>();
      cacheRes.rows.forEach(r => {
        const b1 = String(r.brand1_id).trim();
        const b2 = String(r.brand2_id).trim();
        const key = b1 < b2 ? `${b1}_${b2}` : `${b2}_${b1}`;
        cacheMap.set(key, r.competes === true);
      });
      console.log(`Loaded ${cacheMap.size} cached brand judgments.`);

      // 3. Query pgvector for semantic brand candidates overlapping in category space
      const candidateQuery = `
        SELECT 
          b1.id AS brand1_id,
          b1.name AS brand1_name,
          b2.id AS brand2_id,
          b2.name AS brand2_name,
          cat.name AS shared_category_name,
          b2.distance
        FROM ${appConfig.pgViews.brands} b1
        CROSS JOIN LATERAL (
          SELECT 
            b2_inner.id,
            b2_inner.name,
            (b1.embedding <=> b2_inner.embedding) AS distance
          FROM ${appConfig.pgViews.brands} b2_inner
          WHERE b2_inner.id <> b1.id AND b2_inner.embedding IS NOT NULL
          ORDER BY b1.embedding <=> b2_inner.embedding ASC
          LIMIT 15
        ) b2
        JOIN ${appConfig.pgViews.brandCategory} m1 ON m1.brand_id = b1.id
        JOIN ${appConfig.pgViews.brandCategory} m2 ON m2.brand_id = b2.id AND m2.category_id = m1.category_id
        JOIN ${appConfig.pgViews.categories} cat ON cat.id = m2.category_id
        WHERE b1.embedding IS NOT NULL
      `;
      const candidateRes = await pgClient.query(candidateQuery);
      
      const uncachedCandidates: any[] = [];
      const competitorsToLoad: { b1: string; b2: string; similarity?: number }[] = [];

      candidateRes.rows.forEach(row => {
        const b1 = String(row.brand1_id).trim();
        const b2 = String(row.brand2_id).trim();
        const key = b1 < b2 ? `${b1}_${b2}` : `${b2}_${b1}`;

        if (cacheMap.has(key)) {
          if (cacheMap.get(key) === true) {
            competitorsToLoad.push({ b1, b2, similarity: 1 - parseFloat(row.distance || '0.10') });
          }
        } else {
          uncachedCandidates.push({
            key,
            brand1_id: b1,
            brand1_name: String(row.brand1_name).trim(),
            brand2_id: b2,
            brand2_name: String(row.brand2_name).trim(),
            category: String(row.shared_category_name).trim()
          });
        }
      });
      console.log(`${competitorsToLoad.length} competitor pairs loaded directly from cache.`);

      // 4. Evaluate uncached candidate pairs using asynchronous self-healing queue monitor
      const uniqueUncached = Array.from(new Map(uncachedCandidates.map(item => [item.key, item])).values());
      if (uniqueUncached.length > 0) {
        if (!apiKey || !appConfig.llm.ingestEnabled) {
          console.warn('API Key missing or explicitly disabled for ingestion, skipping brand competitor evaluation to preserve cache purity.');
        } else {
          console.log(`Starting batched LLM evaluations for ${uniqueUncached.length} pairs (Batch Size: 50)...`);
          
          const batchSize = 50;
          const processBatch = async (batch: any[]): Promise<boolean> => {
            const promptPayload = batch.map((item, idx) => ({
              id: `pair_${idx}`,
              brandA: item.brand1_name,
              brandB: item.brand2_name,
              category: item.category
            }));

            const prompt = `You are a retail market intelligence expert.
Given a list of brand pairings and their shared product categories, evaluate whether they are direct competitors in the market.

Definition of Direct Competitors:
- They target the same general consumer demographic.
- They operate in comparable price tiers (e.g., both premium, both mainstream, or both budget).
- They offer highly overlapping product selections.

Instruction for Unknown Brands:
- If a brand name is local or private-label and you do not recognize it, analyze the semantic naming style (e.g. "Organic Greens" vs "Super Value") and default to YES if their naming style and shared category align closely, otherwise answer NO.

You must return a JSON object mapping each "id" to a boolean (true if competitors, false otherwise). No markdown wrapping, no explanation.

Input:
${JSON.stringify(promptPayload, null, 2)}
`;

            try {
              const rawText = await this.llmService.generateContent(prompt, 'ingest', true);
              const cleanedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
              const judgments = JSON.parse(cleanedText);

              const values: any[] = [];
              const valuePlaceholders: string[] = [];
              batch.forEach((item, idx) => {
                const id = `pair_${idx}`;
                const competes = judgments[id] === true;
                const offset = idx * 3;
                valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
                values.push(item.brand1_id, item.brand2_id, competes);

                if (competes) {
                  competitorsToLoad.push({ b1: item.brand1_id, b2: item.brand2_id, similarity: 0.90 });
                }
              });

              await pgClient.query(
                `INSERT INTO brand_competitor_judgments (brand1_id, brand2_id, competes) 
                 VALUES ${valuePlaceholders.join(', ')} 
                 ON CONFLICT (brand1_id, brand2_id) DO NOTHING`,
                values
              );
              return true;
            } catch (err: any) {
              console.error(`  ❌ [LLM Judge] Failed to process batch of size ${batch.length} (Skipping insert):`, err.message);
              return false;
            }
          };

          const totalBatches = Math.ceil(uniqueUncached.length / batchSize);
          const pendingQueue: any[][] = [];
          for (let i = 0; i < totalBatches; i++) {
            const start = i * batchSize;
            pendingQueue.push(uniqueUncached.slice(start, start + batchSize));
          }

          const concurrencyLimit = 2;
          let completedCount = 0;

          const runWorker = async (): Promise<void> => {
            while (true) {
              const chunk = pendingQueue.shift();
              if (!chunk) break;

              const success = await processBatch(chunk);
              if (success) {
                completedCount++;
                await new Promise(r => setTimeout(r, 2000));
              } else {
                console.warn(`  ⚠️ [Queue Monitor] Re-queueing failed batch to the back of the queue...`);
                pendingQueue.push(chunk);
                await new Promise(r => setTimeout(r, 15000));
              }
            }
          };

          const workers: Promise<void>[] = [];
          for (let i = 0; i < Math.min(concurrencyLimit, totalBatches); i++) {
            workers.push(runWorker());
          }
          await Promise.all(workers);
        }
      }

      // 5. Query brand embeddings to compute exact similarities
      console.log(`Fetching brand embeddings to compute similarities for brand competitor pairs...`);
      const involvedBrandIdsSet = new Set<string>();
      competitorsToLoad.forEach(item => { involvedBrandIdsSet.add(item.b1); involvedBrandIdsSet.add(item.b2); });
      
      const brandEmbeddingsMap = new Map<string, number[]>();
      if (involvedBrandIdsSet.size > 0) {
        const brandEmbRes = await pgClient.query(`
          SELECT id, embedding FROM ${appConfig.pgViews.brands} 
          WHERE id = ANY($1) AND embedding IS NOT NULL
        `, [Array.from(involvedBrandIdsSet)]);
        brandEmbRes.rows.forEach(row => {
          const parsed = parseEmbedding(row.embedding);
          if (parsed) {
            brandEmbeddingsMap.set(String(row.id).trim(), parsed);
          }
        });
      }

      const competitorsWithSimilarity = competitorsToLoad.map(item => {
        const emb1 = brandEmbeddingsMap.get(item.b1);
        const emb2 = brandEmbeddingsMap.get(item.b2);
        const similarity = (emb1 && emb2) ? cosineSimilarity(emb1, emb2) : (item.similarity || 0.90);
        return { ...item, similarity };
      });

      console.log(`Writing Brand COMPETES_WITH edges (LLM-pruned list)...`);
      const overlapBatch = 15000;
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
      console.log(`Mapped ${competitorsWithSimilarity.length * 2} COMPETES_WITH brand-level edges.`);
      return { competitors: competitorsWithSimilarity.length };
    } finally {
      pgClient.release();
      await session.close();
    }
  }

  // =========================================================================
  // STAGE D: High-Performance Product Streamer
  // =========================================================================

  async streamProductCatalog(options?: { appendOnly?: boolean; batchSize?: number }): Promise<{ products: number; relationships: number }> {
    console.log('\nStreaming High-Fidelity products from PostgreSQL...');
    const pgClient = await this.pgPool.connect();
    const startTime = Date.now();
    const batchSize = options?.batchSize || 15000;

    try {
      // 1. Establish Schema index / constraints checks
      await this.verifySchemaConstraints();

      // 2. Fetch list of active Category and Brand IDs to prevent orphan nodes
      const activeCategoryIds = new Set<string>();
      const activeBrandIds = new Set<string>();

      const catIdsRes = await pgClient.query(`SELECT id FROM ${appConfig.pgViews.categories} WHERE embedding IS NOT NULL`);
      catIdsRes.rows.forEach(r => activeCategoryIds.add(String(r.id)));

      const brandIdsRes = await pgClient.query(`SELECT id FROM ${appConfig.pgViews.brands} WHERE embedding IS NOT NULL`);
      brandIdsRes.rows.forEach(r => activeBrandIds.add(String(r.id)));

      // 3. Load Unit of Measure Synonyms Normalization table
      const measureMap = new Map<string, string>();
      try {
        const measureRes = await pgClient.query('SELECT key, canonical_form FROM measure_synonym');
        measureRes.rows.forEach(row => {
          if (row.key && row.canonical_form) {
            measureMap.set(row.key.trim().toLowerCase(), row.canonical_form.trim());
          }
        });
      } catch (err: any) {
        console.warn('Bypassing measure_synonym mapping:', err.message);
      }

      // 4. Stream products from PG using backpressure-aware QueryStream
      const sql = `
        SELECT id, name, msrp, brand_id, brand_name, product_id_value, validation_state, direct_category_ids, source, item_size, item_measure 
        FROM ${appConfig.pgViews.products} 
        WHERE (validation_state IS NULL OR validation_state != 'INVALID')
      `;

      const queryStream = new QueryStream(sql);
      const stream = pgClient.query(queryStream);

      let productCount = 0;
      let relationshipCount = 0;

      let productsBuffer: any[] = [];
      let manufacturedLinksBuffer: any[] = [];
      let categoryLinksBuffer: any[] = [];

      const flushBatchToNeo4j = async (prods: any[], mfg: any[], belongs: any[]): Promise<void> => {
        const writeSession = this.neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
        try {
          await writeSession.executeWrite(async tx => {
            // Merge Product nodes
            await tx.run(`
              UNWIND $batch AS p
              MERGE (prod:Product {id: p.id})
              ON CREATE SET prod.name = p.name, prod.price = p.price, prod.gtin = p.gtin, prod.size = p.size, prod.measure = p.measure, prod.validationState = p.validationState
              ON MATCH SET prod.name = p.name, prod.price = p.price, prod.gtin = p.gtin, prod.size = p.size, prod.measure = p.measure, prod.validationState = p.validationState
            `, { batch: prods });

            // Merge MANUFACTURED_BY edges
            if (mfg.length > 0) {
              await tx.run(`
                UNWIND $links AS link
                MATCH (p:Product {id: link.productId})
                MATCH (b:Brand {id: link.brandId})
                MERGE (p)-[:MANUFACTURED_BY]->(b)
              `, { links: mfg });
            }

            // Merge BELONGS_TO edges
            if (belongs.length > 0) {
              await tx.run(`
                UNWIND $links AS link
                MATCH (p:Product {id: link.productId})
                MATCH (c:Category {id: link.categoryId})
                MERGE (p)-[:BELONGS_TO]->(c)
              `, { links: belongs });
            }
          });
        } finally {
          await writeSession.close();
        }
      };

      await new Promise<void>((resolve, reject) => {
        stream.on('data', async (row: any) => {
          const brandId = row.brand_id ? String(row.brand_id).trim() : null;
          if (!brandId || !activeBrandIds.has(brandId)) return; // Filter out products without vector-embedded brands

          let productCategoryId: string | null = null;
          if (row.direct_category_ids) {
            const ids = Array.isArray(row.direct_category_ids)
              ? row.direct_category_ids
              : String(row.direct_category_ids).replace(/[{}]/g, '').split(',');

            const validId = ids.find(id => activeCategoryIds.has(String(id).trim()));
            if (validId) {
              productCategoryId = String(validId).trim();
            }
          }

          if (!productCategoryId) return; // Filter out products without vector-embedded categories

          const productId = String(row.id);
          const productName = String(row.name || `Product ${productId}`);
          const price = isNaN(parseFloat(row.msrp)) ? 0.00 : parseFloat(row.msrp);
          const size = row.item_size ? parseFloat(row.item_size) : null;
          const rawMeasure = String(row.item_measure || 'N/A').trim().toLowerCase();
          let measure = row.item_measure || 'N/A';
          if (measureMap.has(rawMeasure)) {
            measure = measureMap.get(rawMeasure)!;
          }
          const gtin = row.product_id_value || 'N/A';
          const validationState = row.validation_state || 'VALID';

          productsBuffer.push({ id: productId, name: productName, price, gtin, size, measure, validationState });
          manufacturedLinksBuffer.push({ productId, brandId });
          categoryLinksBuffer.push({ productId, categoryId: productCategoryId });

          productCount++;
          relationshipCount += 2;

          if (productsBuffer.length >= batchSize) {
            stream.pause();
            const pCopy = [...productsBuffer];
            const mCopy = [...manufacturedLinksBuffer];
            const cCopy = [...categoryLinksBuffer];

            productsBuffer = [];
            manufacturedLinksBuffer = [];
            categoryLinksBuffer = [];

            try {
              await flushBatchToNeo4j(pCopy, mCopy, cCopy);
              console.log(`Ingested: ${productCount.toLocaleString()} products...`);
              stream.resume();
            } catch (err: any) {
              stream.destroy(err);
            }
          }
        });

        stream.on('end', async () => {
          if (productsBuffer.length > 0) {
            try {
              await flushBatchToNeo4j(productsBuffer, manufacturedLinksBuffer, categoryLinksBuffer);
              console.log(`Ingested final: ${productCount.toLocaleString()} products.`);
            } catch (err: any) {
              return reject(err);
            }
          }
          resolve();
        });

        stream.on('error', (err: Error) => {
          reject(err);
        });
      });

      return { products: productCount, relationships: relationshipCount };
    } finally {
      pgClient.release();
    }
  }

  // =========================================================================
  // STAGE G: Brand-Category Operational Links Materializer
  // =========================================================================

  async ingestBrandCategoryRelationships(): Promise<{ relationships: number }> {
    console.log('\n======================================================');
    console.log('  STAGE G: MATERIALIZING BRAND-CATEGORY OPERATIONAL LINKS ');
    console.log('======================================================\n');

    const session = this.neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
    const startTime = Date.now();

    try {
      const cypher = `
        MATCH (b:Brand)<-[:MANUFACTURED_BY]-(p:Product)-[:BELONGS_TO]->(c:Category)
        WITH b, c, count(p) AS count
        MERGE (b)-[r:OPERATES_IN]->(c)
        SET r.productCount = count
        RETURN count(r) AS count
      `;

      const result = await session.run(cypher);
      const count = result.records[0].get('count').toNumber();
      console.log(`Successfully materialized ${count.toLocaleString()} (:Brand)-[:OPERATES_IN]->(:Category) links in ${Math.round((Date.now() - startTime) / 1000)}s.`);
      return { relationships: count };
    } finally {
      await session.close();
    }
  }

  // =========================================================================
  // BACKWARD-COMPATIBLE RUNNER
  // =========================================================================

  async runPipeline(): Promise<IngestionStats> {
    const startTime = Date.now();
    console.log('\n======================================================');
    console.log('  STARTING ENTERPRISE-SCALE NEO4J PIPELINE (3.46M GPs)  ');
    console.log('======================================================\n');

    await this.truncateDatabase();
    await this.verifySchemaConstraints();
    
    const catTopology = await this.ingestCategoryTopology();
    const catRels = await this.ingestCategoryRelationships();
    
    const brandTopology = await this.ingestBrandTopology();
    const brandRels = await this.ingestBrandRelationships();
    
    const productStats = await this.streamProductCatalog({ appendOnly: false });
    
    const brandCatRels = await this.ingestBrandCategoryRelationships();
    
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    return {
      products: productStats.products,
      brands: brandTopology.brands,
      manufacturers: brandTopology.manufacturers,
      sources: 0,
      categories: catTopology.categories,
      relationships: productStats.relationships + catTopology.parentLinksCount + brandTopology.ownedLinksCount + catRels.complements * 2 + catRels.substitutes * 2 + brandRels.competitors * 2 + brandCatRels.relationships,
      durationSeconds
    };
  }
}

export async function runPipeline(pgPool: Pool, neoDriver: Driver): Promise<IngestionStats> {
  const llmService = new LlmService();
  const service = new EtlService(pgPool, neoDriver, llmService);
  return service.runPipeline();
}
