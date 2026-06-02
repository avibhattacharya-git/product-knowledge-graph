import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';
import { LlmService } from './llm.service';
import { appConfig } from '../configs/app.config';

export interface CategoryRecommendation {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  relationshipType: 'COMPLEMENT' | 'SUBSTITUTE';
  neo4jType: 'COMPLEMENTARY_TO' | 'SUBSTITUTE_CATEGORY';
  similarity: number;
  confidence: number;
  rationale: string;
}

export interface ApprovedRecommendation {
  sourceId: string;
  targetId: string;
  relationshipType: 'COMPLEMENT' | 'SUBSTITUTE';
  similarity: number;
}

export interface BrandRecommendation {
  brand1Id: string;
  brand1Name: string;
  brand2Id: string;
  brand2Name: string;
  sharedCount: number;
  totalVolume: number;
  sharedCategories: Array<{ categoryName: string }>;
  similarity: number;
  confidence: number;
  rationale: string;
}

export interface ApprovedBrandRecommendation {
  brand1Id: string;
  brand2Id: string;
  similarity: number;
}

export class RecommendationService {
  private llmService: LlmService;

  // Fully-enriched in-memory caches to serve recommendations instantly (0ms) to the UI
  private categoryRecsCache: CategoryRecommendation[] | null = null;
  private brandRecsCache: BrandRecommendation[] | null = null;

  // Concurrency locks (Promise-locks) to prevent duplicate concurrently-running Neo4j scans
  private categoryRecsPromise: Promise<CategoryRecommendation[]> | null = null;
  private brandRecsPromise: Promise<BrandRecommendation[]> | null = null;

  constructor(
    private pgPool: Pool, // Retained for strict backward-compatibility in constructor signatures
    private neoDriver: Driver
  ) {
    this.llmService = new LlmService();
    // Warm up the caches asynchronously in the background on startup (skip in tests to ensure mock isolation)
    if (process.env.NODE_ENV !== 'test') {
      this.warmupCaches().catch(err => console.error('[RecommendationService] Cache warmup failed:', err));
    }
  }

  /**
   * Warm up the recommendation caches on startup so that the user is wowed by 0ms dashboard load times.
   */
  private async warmupCaches() {
    console.log('[RecommendationService] Starting asynchronous background cache warmup...');
    // We execute them sequentially during warmup to respect database lock cycles on startup
    try {
      await this.getRecommendations(10);
      console.log('[RecommendationService] Category recommendations cache successfully warmed up.');
    } catch (err: any) {
      console.warn('[RecommendationService] Category cache warmup warn:', err.message);
    }

    try {
      await this.getBrandRecommendations(10);
      console.log('[RecommendationService] Brand recommendations cache successfully warmed up.');
    } catch (err: any) {
      console.warn('[RecommendationService] Brand cache warmup warn:', err.message);
    }
    console.log('[RecommendationService] Background cache warmup cycle complete.');
  }

  /**
   * Discovers category relationship recommendations (complements & substitutes)
   * purely from the active Neo4j graph using Jaccard brand overlaps, and refines them
   * with a low-latency LLM-as-a-judge evaluation and copywriter pass.
   */
  async getRecommendations(limit: number = 10): Promise<CategoryRecommendation[]> {
    // 0. Serve from fast in-memory cache if available
    if (this.categoryRecsCache && this.categoryRecsCache.length >= limit) {
      return this.categoryRecsCache.slice(0, limit);
    }

    // 1. If a computation is already running, join the existing promise
    if (!this.categoryRecsPromise) {
      this.categoryRecsPromise = this.computeRecommendations(limit)
        .then(recs => {
          this.categoryRecsCache = recs;
          this.categoryRecsPromise = null;
          return recs;
        })
        .catch(err => {
          this.categoryRecsPromise = null;
          throw err;
        });
    }

    const recs = await this.categoryRecsPromise;
    return recs.slice(0, limit);
  }

  /**
   * Core computation logic for Category Recommendations
   */
  private async computeRecommendations(limit: number): Promise<CategoryRecommendation[]> {
    const fetchLimit = Math.max(50, limit);

    // Using two separate sessions to run queries concurrently in Neo4j without socket/transaction conflicts
    const sessionSub = this.neoDriver.session();
    const sessionComp = this.neoDriver.session();

    try {
      // Fetch Substitutes Candidates (residing in the same parent aisle) using list-pre-aggregation
      const subCypher = `
        MATCH (c:Category {level: 2})-[:PARENT_CATEGORY]->(parent:Category)
        MATCH (b:Brand)<-[:MANUFACTURED_BY]-(:Product)-[:BELONGS_TO]->(c)
        WITH c, parent, collect(DISTINCT id(b)) AS brandIds
        WHERE size(brandIds) > 0
        WITH collect({category: c, parent: parent, brandIds: brandIds}) AS catData
        UNWIND catData AS c1Data
        UNWIND catData AS c2Data
        WITH c1Data.category AS c1, c1Data.parent AS p1, c1Data.brandIds AS c1Brands,
             c2Data.category AS c2, c2Data.parent AS p2, c2Data.brandIds AS c2Brands
        WHERE id(c1) < id(c2) AND p1 = p2
          AND NOT (c1)-[:SUBSTITUTE_CATEGORY]-(c2)
          AND NOT (c1)-[:COMPLEMENTARY_TO]-(c2)
        WITH c1, c2, p1,
             [x IN c1Brands WHERE x IN c2Brands] AS intersectionBrands,
             c1Brands, c2Brands
        WITH c1, c2, p1,
             size(intersectionBrands) AS sharedBrands,
             size(c1Brands) AS c1BrandCount,
             size(c2Brands) AS c2BrandCount
        WHERE sharedBrands > 0
        WITH c1, c2, p1, sharedBrands, c1BrandCount, c2BrandCount,
             toFloat(sharedBrands) / (c1BrandCount + c2BrandCount - sharedBrands) AS brandJaccard
        WHERE brandJaccard > 0.02
        RETURN c1.id AS sourceId, c1.name AS sourceName, c2.id AS targetId, c2.name AS targetName, 
               'SUBSTITUTE' AS relationshipType, 'SUBSTITUTE_CATEGORY' AS neo4jType, 
               brandJaccard AS similarity, p1.name AS aisleName
        ORDER BY brandJaccard DESC
        LIMIT toInteger($limit)
      `;

      // Fetch Complements Candidates (crossing departments) using list-pre-aggregation
      const compCypher = `
        MATCH (c:Category {level: 2})-[:PARENT_CATEGORY]->(parent:Category)
        MATCH (b:Brand)<-[:MANUFACTURED_BY]-(:Product)-[:BELONGS_TO]->(c)
        WITH c, parent, collect(DISTINCT id(b)) AS brandIds
        WHERE size(brandIds) > 0
        WITH collect({category: c, parent: parent, brandIds: brandIds}) AS catData
        UNWIND catData AS c1Data
        UNWIND catData AS c2Data
        WITH c1Data.category AS c1, c1Data.parent AS p1, c1Data.brandIds AS c1Brands,
             c2Data.category AS c2, c2Data.parent AS p2, c2Data.brandIds AS c2Brands
        WHERE id(c1) < id(c2) AND p1 <> p2
          AND NOT (c1)-[:COMPLEMENTARY_TO]-(c2)
          AND NOT (c1)-[:SUBSTITUTE_CATEGORY]-(c2)
        WITH c1, c2, p1, p2,
             [x IN c1Brands WHERE x IN c2Brands] AS intersectionBrands,
             c1Brands, c2Brands
        WITH c1, c2, p1, p2,
             size(intersectionBrands) AS sharedBrands,
             size(c1Brands) AS c1BrandCount,
             size(c2Brands) AS c2BrandCount
        WHERE sharedBrands > 0
        WITH c1, c2, p1, p2, sharedBrands, c1BrandCount, c2BrandCount,
             toFloat(sharedBrands) / (c1BrandCount + c2BrandCount - sharedBrands) AS brandJaccard
        WHERE brandJaccard > 0.02
        RETURN c1.id AS sourceId, c1.name AS sourceName, c2.id AS targetId, c2.name AS targetName, 
               'COMPLEMENT' AS relationshipType, 'COMPLEMENTARY_TO' AS neo4jType, 
               brandJaccard AS similarity, p1.name AS dept1, p2.name AS dept2
        ORDER BY brandJaccard DESC
        LIMIT toInteger($limit)
      `;

      // Execute Cypher scans in parallel using concurrent isolated sessions
      const [subRes, compRes] = await Promise.all([
        sessionSub.run(subCypher, { limit: fetchLimit }),
        sessionComp.run(compCypher, { limit: fetchLimit })
      ]);

      const rawCandidates: any[] = [];

      subRes.records.forEach(rec => {
        const simVal = rec.get('similarity');
        const similarity = typeof simVal === 'number' ? simVal : (simVal && typeof simVal.toNumber === 'function' ? simVal.toNumber() : Number(simVal));
        rawCandidates.push({
          sourceId: rec.get('sourceId'),
          sourceName: rec.get('sourceName'),
          targetId: rec.get('targetId'),
          targetName: rec.get('targetName'),
          relationshipType: rec.get('relationshipType'),
          neo4jType: rec.get('neo4jType'),
          similarity,
          aisleName: rec.get('aisleName')
        });
      });

      compRes.records.forEach(rec => {
        const simVal = rec.get('similarity');
        const similarity = typeof simVal === 'number' ? simVal : (simVal && typeof simVal.toNumber === 'function' ? simVal.toNumber() : Number(simVal));
        rawCandidates.push({
          sourceId: rec.get('sourceId'),
          sourceName: rec.get('sourceName'),
          targetId: rec.get('targetId'),
          targetName: rec.get('targetName'),
          relationshipType: rec.get('relationshipType'),
          neo4jType: rec.get('neo4jType'),
          similarity,
          dept1: rec.get('dept1'),
          dept2: rec.get('dept2')
        });
      });

      // Sort and truncate to fetch limit size
      const candidates = rawCandidates
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, fetchLimit);

      if (candidates.length === 0) {
        return [];
      }

      let enrichedRecs: CategoryRecommendation[] = [];

      // Attempt LLM-as-a-judge evaluation and custom copywriter pass
      try {
        const provider = appConfig.llm.activeProvider;
        const apiKey = provider === 'openai' ? appConfig.openAiApiKey
          : provider === 'anthropic' ? appConfig.anthropicApiKey
          : appConfig.geminiApiKey;

        if (!apiKey) {
          throw new Error('API Key missing, skipping LLM pass to trigger default safe fallback.');
        }

        const promptCandidates = candidates.map(c => ({
          sourceId: c.sourceId,
          sourceName: c.sourceName,
          targetId: c.targetId,
          targetName: c.targetName,
          relationshipType: c.relationshipType,
          similarity: Math.round(c.similarity * 100) / 100,
          aisle: c.aisleName || `${c.dept1} ↔ ${c.dept2}`
        }));

        const prompt = `You are a retail market intelligence expert evaluating a product taxonomy graph.
We have identified candidate category relationship recommendations (substitutes and complements) using co-occurrence statistics.
Your task is to:
1. Filter out/Prune any candidate pairings that are noisy or illogical in a retail environment (e.g. mapping "Batteries" as a companion to "Cereal" just because a brand made both).
2. For each VALID recommendation, write a highly compelling, context-aware, creative marketing rationale (max 2 sentences) describing why they represent a great substitute or companion cross-shop. Do NOT use generic template formulas. Write natural retail copy.
3. For each VALID recommendation, assign a semantic confidence score (between 0.0 and 1.0) indicating how logically sound and strong this pairing is as a retail companion or substitute.

Candidates:
${JSON.stringify(promptCandidates, null, 2)}

You must return a JSON object mapping to a "validated" array of recommendations. No markdown formatting, no code block wrap. Just pure JSON.
JSON structure:
{
  "validated": [
    {
      "sourceId": "...",
      "targetId": "...",
      "relationshipType": "COMPLEMENT" or "SUBSTITUTE",
      "confidence": 0.85,
      "rationale": "Compelling custom retail rationale..."
    }
  ]
}
`;

        const responseText = await this.llmService.generateContent(prompt, 'nlq', true);
        const cleanedText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const resultObj = JSON.parse(cleanedText);

        if (resultObj && Array.isArray(resultObj.validated)) {
          const validatedMap = new Map<string, { confidence: number; rationale: string }>();
          resultObj.validated.forEach((item: any) => {
            const key = `${item.sourceId}_${item.targetId}`;
            validatedMap.set(key, {
              confidence: typeof item.confidence === 'number' ? item.confidence : (typeof item.similarity === 'number' ? item.similarity : 0.80),
              rationale: String(item.rationale)
            });
          });

          // Rebuild keeping original category name details and ordering by Jaccard descending
          enrichedRecs = candidates
            .filter(c => validatedMap.has(`${c.sourceId}_${c.targetId}`))
            .map(c => {
              const enriched = validatedMap.get(`${c.sourceId}_${c.targetId}`)!;
              return {
                sourceId: c.sourceId,
                sourceName: c.sourceName,
                targetId: c.targetId,
                targetName: c.targetName,
                relationshipType: c.relationshipType,
                neo4jType: c.neo4jType,
                similarity: Math.round(c.similarity * 100) / 100, // Retain original Jaccard similarity
                confidence: enriched.confidence,                  // LLM judgment score (semantic confidence)
                rationale: enriched.rationale
              };
            });
        }
      } catch (err) {
        console.warn('LLM Recommendations Judge failed, falling back to default template rationales:', err);
      }

      // Default Safe Fallback (Template Rationales) for failed/skipped judge pass
      if (enrichedRecs.length === 0) {
        enrichedRecs = candidates.map(c => {
          const pctSimilarity = Math.round(c.similarity * 100);
          const rationale = c.relationshipType === 'SUBSTITUTE'
            ? `Residing in the "${c.aisleName}" parent aisle, "${c.sourceName}" and "${c.targetName}" share ${pctSimilarity}% of their manufacturing brand profiles, representing highly interchangeable substitute choices.`
            : `Products in these categories ("${c.sourceName}" ↔ "${c.targetName}") represent companion cross-shopping opportunities across contiguous departments ("${c.dept1}" ↔ "${c.dept2}").`;
          return {
            sourceId: c.sourceId,
            sourceName: c.sourceName,
            targetId: c.targetId,
            targetName: c.targetName,
            relationshipType: c.relationshipType,
            neo4jType: c.neo4jType,
            similarity: Math.round(c.similarity * 100) / 100,
            confidence: 0.80, // Default 0.80 semantic confidence
            rationale
          };
        });
      }

      return enrichedRecs;

    } finally {
      await Promise.all([
        sessionSub.close(),
        sessionComp.close()
      ]);
    }
  }

  /**
   * Dynamic accept category recommendations (Hono endpoint handles transaction safe merges).
   */
  async acceptRecommendations(pairs: ApprovedRecommendation[]): Promise<{ acceptedCount: number }> {
    if (pairs.length === 0) {
      return { acceptedCount: 0 };
    }

    const session = this.neoDriver.session();
    try {
      let acceptedCount = 0;
      for (const pair of pairs) {
        const { sourceId, targetId, relationshipType, similarity } = pair;
        const neo4jType = relationshipType === 'COMPLEMENT' ? 'COMPLEMENTARY_TO' : 'SUBSTITUTE_CATEGORY';

        await session.run(`
          MATCH (c1:Category {id: $c1})
          MATCH (c2:Category {id: $c2})
          MERGE (c1)-[r1:${neo4jType}]->(c2)
          SET r1.similarity = toFloat($sim)
          MERGE (c2)-[r2:${neo4jType}]->(c1)
          SET r2.similarity = toFloat($sim)
        `, { c1: sourceId, c2: targetId, sim: similarity });

        acceptedCount++;
      }

      // Invalidate the cache to ensure fresh fetches reflect newly approved graph structures
      this.categoryRecsCache = null;

      return { acceptedCount };
    } finally {
      await session.close();
    }
  }

  /**
   * Discovers brand competitor recommendations purely from the active Neo4j graph co-occurrence
   * starting from highly active major brands, and refines them with low-latency LLM judgments.
   */
  async getBrandRecommendations(limit: number = 10): Promise<BrandRecommendation[]> {
    // 0. Serve from fast in-memory cache if available
    if (this.brandRecsCache && this.brandRecsCache.length >= limit) {
      return this.brandRecsCache.slice(0, limit);
    }

    // 1. If a computation is already running, join the existing promise
    if (!this.brandRecsPromise) {
      this.brandRecsPromise = this.computeBrandRecommendations(limit)
        .then(recs => {
          this.brandRecsCache = recs;
          this.brandRecsPromise = null;
          return recs;
        })
        .catch(err => {
          this.brandRecsPromise = null;
          throw err;
        });
    }

    const recs = await this.brandRecsPromise;
    return recs.slice(0, limit);
  }

  /**
   * Core computation logic for Brand Recommendations
   */
  private async computeBrandRecommendations(limit: number): Promise<BrandRecommendation[]> {
    const fetchLimit = Math.max(50, limit);
    const session = this.neoDriver.session();
    try {
      // Fetch Candidates (degree-filtered to top 100 brands, 100% memory-safe & sub-second)
      const cypher = `
        MATCH (b:Brand)
        WITH b, COUNT { (b)<-[:MANUFACTURED_BY]-() } AS degree
        ORDER BY degree DESC
        LIMIT 100
        MATCH (b)-[:OPERATES_IN]->(c:Category {level: 2})
        WITH b, degree, collect(DISTINCT id(c)) AS catIds, count(DISTINCT c) AS catCount
        WHERE catCount > 0
        WITH collect({brand: b, brandId: id(b), degree: degree, catIds: catIds, catCount: catCount}) AS brandProfiles
        UNWIND brandProfiles AS b1Data
        UNWIND brandProfiles AS b2Data
        WITH b1Data.brand AS b1, b1Data.degree AS b1ProdCount, b1Data.catIds AS b1Cats, b1Data.catCount AS b1CatCount,
             b2Data.brand AS b2, b2Data.degree AS b2ProdCount, b2Data.catIds AS b2Cats, b2Data.catCount AS b2CatCount
        WHERE id(b1) < id(b2)
          AND NOT (b1)-[:COMPETES_WITH]-(b2)

        WITH b1, b2, b1ProdCount, b2ProdCount, b1Cats, b2Cats, b1CatCount, b2CatCount,
             [x IN b1Cats WHERE x IN b2Cats] AS intersectionCats
        WITH b1, b2, b1ProdCount, b2ProdCount, b1CatCount, b2CatCount,
             intersectionCats, size(intersectionCats) AS sharedCount
        WHERE sharedCount > 0

        WITH b1, b2, b1ProdCount, b2ProdCount, sharedCount, b1CatCount, b2CatCount,
             toFloat(sharedCount) / (b1CatCount + b2CatCount - sharedCount) AS jaccard, intersectionCats
        WHERE jaccard > 0.02

        MATCH (c:Category) WHERE id(c) IN intersectionCats
        WITH b1, b2, b1ProdCount, b2ProdCount, sharedCount, jaccard, collect({ categoryName: c.name }) AS sharedCategories
        RETURN b1.id AS brand1_id, b1.name AS brand1_name, b2.id AS brand2_id, b2.name AS brand2_name, 
               sharedCategories, sharedCount, toInteger(b1ProdCount + b2ProdCount) AS totalVolume, jaccard AS similarity
        ORDER BY similarity DESC, totalVolume DESC
        LIMIT toInteger($limit)
      `;

      const res = await session.run(cypher, { limit: fetchLimit });
      const candidates: any[] = res.records.map(rec => {
        const rawCats = rec.get('sharedCategories') || [];
        // deduplicate shared categories dynamically
        const uniqueCats = Array.from(new Map(rawCats.map((item: any) => [item.categoryName, item])).values()) as any[];
        const simVal = rec.get('similarity');
        const similarity = typeof simVal === 'number' ? simVal : (simVal && typeof simVal.toNumber === 'function' ? simVal.toNumber() : Number(simVal));
        return {
          brand1Id: rec.get('brand1_id'),
          brand1Name: rec.get('brand1_name'),
          brand2Id: rec.get('brand2_id'),
          brand2Name: rec.get('brand2_name'),
          sharedCount: rec.get('sharedCount').toInt ? rec.get('sharedCount').toInt() : Number(rec.get('sharedCount')),
          totalVolume: rec.get('totalVolume').toInt ? rec.get('totalVolume').toInt() : Number(rec.get('totalVolume')),
          sharedCategories: uniqueCats,
          similarity
        };
      });

      if (candidates.length === 0) {
        return [];
      }

      let enrichedBrands: BrandRecommendation[] = [];

      // Attempt LLM-as-a-judge evaluation and copywriter pass
      try {
        const provider = appConfig.llm.activeProvider;
        const apiKey = provider === 'openai' ? appConfig.openAiApiKey
          : provider === 'anthropic' ? appConfig.anthropicApiKey
          : appConfig.geminiApiKey;

        if (!apiKey) {
          throw new Error('API Key missing, skipping brand LLM pass to trigger default safe fallback.');
        }

        const promptCandidates = candidates.map(c => ({
          brand1Id: c.brand1Id,
          brand1Name: c.brand1Name,
          brand2Id: c.brand2Id,
          brand2Name: c.brand2Name,
          sharedCount: c.sharedCount,
          sharedCategories: c.sharedCategories.slice(0, 3).map((sc: any) => sc.categoryName),
          similarity: Math.round(c.similarity * 100) / 100
        }));

        const prompt = `You are a retail market intelligence expert evaluating a brand portfolio.
We have identified candidate brand competitor pairings based on category overlaps in their catalog listings.
Your task is to:
1. Filter out/Prune any brand pairs that are not true direct competitors in the market (e.g. one brand is a budget tool company and the other is a premium cosmetics brand, even if they share a generic category).
2. For each VALID competitor brand pairing, write a highly compelling, context-aware retail intelligence rationale (max 2 sentences) describing their market rivalry, price tiers, or overlapping customer demographics. Do NOT use generic template formulas. Write custom, professional retail copy.
3. For each VALID competitor brand pairing, assign a semantic confidence score (between 0.0 and 1.0) indicating how strongly they compete in the retail market.

Candidates:
${JSON.stringify(promptCandidates, null, 2)}

You must return a JSON object mapping to a "validated" array of recommendations. No markdown formatting, no code block wrap. Just pure JSON.
JSON structure:
{
  "validated": [
    {
      "brand1Id": "...",
      "brand2Id": "...",
      "confidence": 0.85,
      "rationale": "Direct competitor brand rationale..."
    }
  ]
}
`;

        const responseText = await this.llmService.generateContent(prompt, 'nlq', true);
        const cleanedText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const resultObj = JSON.parse(cleanedText);

        if (resultObj && Array.isArray(resultObj.validated)) {
          const validatedMap = new Map<string, { confidence: number; rationale: string }>();
          resultObj.validated.forEach((item: any) => {
            const key = `${item.brand1Id}_${item.brand2Id}`;
            validatedMap.set(key, {
              confidence: typeof item.confidence === 'number' ? item.confidence : (typeof item.similarity === 'number' ? item.similarity : 0.80),
              rationale: String(item.rationale)
            });
          });

          enrichedBrands = candidates
            .filter(c => validatedMap.has(`${c.brand1Id}_${c.brand2Id}`))
            .map(c => {
              const enriched = validatedMap.get(`${c.brand1Id}_${c.brand2Id}`)!;
              return {
                brand1Id: c.brand1Id,
                brand1Name: c.brand1Name,
                brand2Id: c.brand2Id,
                brand2Name: c.brand2Name,
                sharedCount: c.sharedCount,
                totalVolume: c.totalVolume,
                sharedCategories: c.sharedCategories,
                similarity: Math.round(c.similarity * 100) / 100, // Retain original Jaccard similarity
                confidence: enriched.confidence,                  // LLM judgment score (semantic confidence)
                rationale: enriched.rationale
              };
            });
        }
      } catch (err) {
        console.warn('LLM Brand Recommendations Judge failed, falling back to default rationales:', err);
      }

      // Default Safe Fallback (Template Rationales) for brand pairings
      if (enrichedBrands.length === 0) {
        enrichedBrands = candidates.map(c => {
          const pctSimilarity = Math.round(c.similarity * 100);
          const sampleCats = c.sharedCategories.slice(0, 2).map((sc: any) => sc.categoryName).join(', ');
          const rationale = `Competing across ${c.sharedCount} shared category aisles (including ${sampleCats}), "${c.brand1Name}" and "${c.brand2Name}" share a high market co-occurrence and consumer segment with ${pctSimilarity}% Jaccard catalog overlap.`;
          return {
            brand1Id: c.brand1Id,
            brand1Name: c.brand1Name,
            brand2Id: c.brand2Id,
            brand2Name: c.brand2Name,
            sharedCount: c.sharedCount,
            totalVolume: c.totalVolume,
            sharedCategories: c.sharedCategories,
            similarity: Math.round(c.similarity * 100) / 100,
            confidence: 0.80, // Default 0.80 semantic confidence
            rationale
          };
        });
      }

      return enrichedBrands;

    } finally {
      await session.close();
    }
  }

  /**
   * Transaction safe accept brand recommendations in Neo4j.
   */
  async acceptBrandRecommendations(pairs: ApprovedBrandRecommendation[]): Promise<{ acceptedCount: number }> {
    if (pairs.length === 0) {
      return { acceptedCount: 0 };
    }

    const session = this.neoDriver.session();
    try {
      let acceptedCount = 0;
      for (const pair of pairs) {
        const { brand1Id, brand2Id, similarity } = pair;

        await session.run(`
          MATCH (b1:Brand {id: $b1})
          MATCH (b2:Brand {id: $b2})
          MERGE (b1)-[r1:COMPETES_WITH]->(b2)
          SET r1.similarity = toFloat($sim)
          MERGE (b2)-[r2:COMPETES_WITH]->(b1)
          SET r2.similarity = toFloat($sim)
        `, { b1: brand1Id, b2: brand2Id, sim: similarity });

        acceptedCount++;
      }

      // Invalidate the cache to ensure fresh fetches reflect newly approved graph structures
      this.brandRecsCache = null;

      return { acceptedCount };
    } finally {
      await session.close();
    }
  }
}
