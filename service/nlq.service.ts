import { GraphRepository } from '../repository/graph.repository';
import { appConfig } from '../configs/app.config';
import { NLQResultDTO } from '../models/dto/graph.dto';
import { GraphMapper } from '../repository/mappers/graph.mapper';

import { LlmService } from './llm.service';

export function generateFallbackCypher(q: string): { cypher: string, explanation: string } {
  const qLower = q.toLowerCase().trim();
  const keyStopwords = ['show', 'me', 'products', 'for', 'the', 'a', 'an', 'find', 'list', 'get', 'of', 'in', 'with', 'to', 'items', 'i', 'want', 'please', 'any'];
  const words = qLower
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !keyStopwords.includes(w));
  
  if (words.length > 0) {
    const constraints = words.map(w => `toLower(p.name) CONTAINS "${w}"`).join(' AND ');
    return {
      cypher: `MATCH (p:Product) WHERE ${constraints} OPTIONAL MATCH (p)-[r1:BELONGS_TO]->(c:Category) OPTIONAL MATCH (p)-[r2:MANUFACTURED_BY]->(b:Brand) RETURN p, r1, c, r2, b LIMIT 80`,
      explanation: `Keyword fallback matcher generated a query filtering product names containing: ${words.join(', ')}.`
    };
  }
  return {
    cypher: 'MATCH (p:Product)-[r]->(m) RETURN p, r, m LIMIT 80',
    explanation: 'Returned first 80 products in the database as a general search fallback.'
  };
}

export class NlqService {
  constructor(
    private graphRepo: GraphRepository,
    private llmService: LlmService
  ) {}

  async processNLQQuery(question: string, overrideModel?: string): Promise<NLQResultDTO> {
    const provider = overrideModel
      ? (overrideModel.startsWith('gpt') ? 'openai'
        : overrideModel.startsWith('claude') ? 'anthropic'
        : 'gemini')
      : appConfig.llm.activeProvider;

    const apiKey = provider === 'openai' ? appConfig.openAiApiKey
      : provider === 'anthropic' ? appConfig.anthropicApiKey
      : appConfig.geminiApiKey;
    
    let cypher = '';
    let explanation = '';
    let usedFallback = false;

    if (!apiKey || !appConfig.llm.nlqEnabled) {
      // 💡 Graceful fallback keyword-mapping query parser
      console.warn(`LLM API Key missing or explicitly disabled for NLQ (${provider}), executing keyword-mapping parser fallback...`);
      const fallbackRes = generateFallbackCypher(question);
      cypher = fallbackRes.cypher;
      explanation = fallbackRes.explanation;
      usedFallback = true;
    } else {
      // High-performance Unified LlmService Call
      try {
        const activeModel = overrideModel || appConfig.llm[provider].nlqModel;
        console.log(`Sending prompt to ${provider} AI Engine using model ${activeModel}: "${question}"`);
        
        const systemPrompt = `You are a professional Cypher translator for a Retail Product Knowledge Graph.
Given the following database schema:
  - Nodes:
    - Product (id, name, price, gtin, size, measure, validationState)
    - Brand (id, name, privateLabel, source)
    - Category (id, name, taxonomy, level)
  - Relationships:
    - (Product)-[:MANUFACTURED_BY]->(Brand) (Brand owner)
    - (Product)-[:BELONGS_TO]->(Category) (Category taxonomy matching)
    - (Brand)-[:COMPETES_WITH]->(Brand) (Brand-level overlapping competitive rivalry)
    - (Category)-[:SUBSTITUTE_CATEGORY]->(Category) (Fuzzy/vector mapped product substitutes)
    - (Category)-[:COMPLEMENTARY_TO]->(Category) (Ecosystem bundle accessory pairs)
    - (Category)-[:PARENT_CATEGORY]->(Category) (Taxonomy tree parent category links)

  - NATIVE SCHEMA INDEXES (CRITICAL FOR PERFORMANCE):
    - Brand(name) is fully indexed and has instant sub-millisecond lookup.
    - Category(name) is fully indexed and has instant sub-millisecond lookup.
    - Product has NO active schema index on its 'name' property (contains over 3.4 million product nodes).

Translate the user's natural language question into a single, valid, and highly optimized Neo4j Cypher query, and provide a clear, plain-English explanation of how you structured the query and what assumptions you made.

Your output MUST be a JSON object with EXACTLY the following structure. Do NOT include any markdown code wraps (like \`\`\`json or \`\`\`), do NOT include any surrounding text. Just return the JSON object:
{
  "cypher": "The valid Neo4j Cypher query",
  "explanation": "A concise, plain-English explanation (1-2 sentences) of what the query is doing, including any spelling matching or synonyms used to map the entities."
}

Strict Translation Rules:
1. Multi-Word Search Terms: When the user searches for a product phrase containing multiple words (e.g., "wet dog food" or "baking mix"), you MUST query them case-insensitively using AND operators for each word to avoid loose matches, OR search for the exact combined phrase.
   - Good: toLower(p.name) CONTAINS "wet" AND toLower(p.name) CONTAINS "dog" AND toLower(p.name) CONTAINS "food"
   - Bad: toLower(p.name) CONTAINS "wet" OR toLower(p.name) CONTAINS "dog" OR toLower(p.name) CONTAINS "food" (NEVER do this, as it matches irrelevant items!)
2. Category Mapping & Taxonomy Hierarchy (CRITICAL RULES FOR PRODUCTS & COMPLEMENTS): Products in our database ONLY belong to leaf Category nodes via BELONGS_TO. They NEVER belong directly to broad high-level department or parent categories (like "Snacks, Cookies, & Chips" or "Beverages"). High-level department categories are linked via child-to-parent hierarchies: (childCategory)-[:PARENT_CATEGORY]->(parentCategory).
   - Therefore, to find products under any matched category (like chips, snacks, soft drinks, pet care), or when traversing category-level relationships (like COMPLEMENTARY_TO or SUBSTITUTE_CATEGORY), you MUST ALWAYS traverse the category tree hierarchically using variable-length parent paths to find leaf products. Naive direct joins like 'MATCH (p:Product)-[:BELONGS_TO]->(c:Category)' will return 0 results and fail for all high-level department categories!
   - Example (Products under a category): MATCH (sub:Category)-[:PARENT_CATEGORY*0..2]->(c:Category) WHERE toLower(c.name) CONTAINS "pet food" MATCH (p:Product)-[r:BELONGS_TO]->(sub)
   - Example (Complements / Bundles): MATCH (c1:Category) WHERE toLower(c1.name) CONTAINS "chips" MATCH (sub1:Category)-[:PARENT_CATEGORY*0..2]->(c1) MATCH (p1:Product)-[r1:BELONGS_TO]->(sub1) MATCH (c1)-[r2:COMPLEMENTARY_TO]->(c2:Category) MATCH (sub2:Category)-[:PARENT_CATEGORY*0..2]->(c2) MATCH (p2:Product)-[r3:BELONGS_TO]->(sub2) RETURN p1, r1, sub1, c1, r2, c2, sub2, r3, p2 LIMIT 50
3. Colloquial Entity Normalization & Synonyms:
   - If the user queries a colloquial brand name or abbreviation (e.g., "Coke", "Pepsi", "Gillette"), write case-insensitive matching logic to capture the full name in the database (e.g., toLower(b.name) CONTAINS "coca" for Coke).
   - If a category is queried colloquially (e.g., "soda", "detergent"), map it to the corresponding category name (e.g., toLower(c.name) CONTAINS "carbonated" or toLower(c.name) CONTAINS "laundry").
4. Relationships: Use the correct relationships from the schema.
   - Category-to-Category: SUBSTITUTE_CATEGORY, COMPLEMENTARY_TO, PARENT_CATEGORY.
   - Brand-to-Brand: COMPETES_WITH.
   - Product-to-Brand: MANUFACTURED_BY.
   - Product-to-Category: BELONGS_TO.
5. Untrustworthy Properties & Purity Guardrails (Critical): Do NOT filter or sort using the 'privateLabel' property on Brand nodes or the 'price' property on Product nodes. The 'privateLabel' indicator is untrustworthy, and 'price' data is questionable. If a user asks for 'cheap', 'premium', 'under $X', or 'budget' items, ignore those price/label filters. Instead, translate the request structurally, or filter semantically by brand/product names, or simply map the active Category tree nodes without using price or privateLabel properties.
6. Return Format: Return the complete paths so they render visually: e.g., MATCH (p:Product)-[r1:BELONGS_TO]->(c:Category), (p)-[r2:MANUFACTURED_BY]->(b:Brand) RETURN p, r1, c, r2, b LIMIT 50. Always name your relationship variables (e.g., -[r:COMPETES_WITH]-> rather than -[:COMPETES_WITH]->) so that the visual DTO mapper has access to connection IDs.
7. Valid JSON: Ensure the Cypher query and the explanation are properly escaped so that the JSON parser does not fail (e.g., escape double quotes in the Cypher query).
8. PERFORMANCE INDEX PURITY & TUNING (CRITICAL):
   - The Product label has over 3.4 MILLION nodes! NEVER write a query that starts by scanning the Product label and performing wildcards on product names.
   - ALWAYS start your traversal from indexed properties: Brand(name) or Category(name) first (e.g., MATCH (b:Brand) WHERE b.name STARTS WITH "Poppi" MATCH (p:Product)-[r:MANUFACTURED_BY]->(b) ...).
   - Prefer exact equality (e.g., b.name = "Poppi" OR b.name = "poppi Prebiotic Soda") or prefix matches (e.g., b.name STARTS WITH "Poppi") over slow case-insensitive contains lookups (toLower(b.name) CONTAINS "poppi") whenever possible. This allows Neo4j to hit native B-Tree indexes in under 0.1ms rather than executing string scan evaluations on thousands of nodes.
9. Flavor/Theme vs. Category separation (CRITICAL FOR COLLOQUIAL SEARCH): If a user query specifies a flavor, ingredient, or theme that shares a name with a category but acts as an adjective describing another product (e.g., 'soda-flavored lip balms', 'cherry cookies', 'apple shampoo'), do NOT attempt to link the product to the beverage or fruit category. The flavor/theme (soda, cherry, apple) is a product description and must be mapped as a case-insensitive product name filter (toLower(p.name) CONTAINS "soda"), while the product's actual category remains cosmetic, bakery, or personal care.
10. Flexible Multi-Entity Disjoint Mapping (CRITICAL FOR MULTI-CATEGORY QUESTIONS): When a user queries relationships or items spanning multiple distinct entities, brands, or categories (e.g., 'complements between Baking, Produce, and Meat'):
    - Do NOT force a strict, closed-loop intersection pattern (e.g., matching a closed triangle of COMPLEMENTARY_TO links between c1, c2, and c3). Doing so is extremely restrictive and will yield 0 results. Instead, use OPTIONAL MATCH statements for all relationship paths (e.g., MATCH (c1:Category) ... MATCH (c2:Category) ... OPTIONAL MATCH (c1)-[r1:COMPLEMENTARY_TO]-(c2)) so that the category nodes themselves are successfully matched and returned even if no relationship exists yet.
    - If a single category description contains multiple words representing alternative departments (e.g., 'Meat, Seafood, & Poultry'), do NOT combine them with AND on a single node name (e.g., c3.name CONTAINS 'meat' AND c3.name CONTAINS 'seafood' is impossible). ALWAYS join them with OR (e.g., toLower(c3.name) CONTAINS 'meat' OR toLower(c3.name) CONTAINS 'seafood' OR toLower(c3.name) CONTAINS 'poultry') to match any corresponding department.


User Question: "${question}"
Output JSON:`;

        const rawText = await this.llmService.generateContent(systemPrompt, 'nlq', true, activeModel, provider);
        
        // Strip any markdown code wraps
        const cleanedText = rawText
          .replace(/```json/gi, '')
          .replace(/```cypher/gi, '')
          .replace(/```/g, '')
          .trim();

        try {
          const parsed = JSON.parse(cleanedText);
          cypher = parsed.cypher;
          explanation = parsed.explanation;
        } catch (jsonErr) {
          console.warn('Failed to parse response as JSON. Attempting regex extraction...', jsonErr);
          const cypherMatch = cleanedText.match(/"cypher"\s*:\s*"([^"]+)"/);
          const explanationMatch = cleanedText.match(/"explanation"\s*:\s*"([^"]+)"/);
          
          if (cypherMatch && cypherMatch[1]) {
            cypher = cypherMatch[1].replace(/\\"/g, '"');
          } else {
            cypher = cleanedText;
          }
          
          if (explanationMatch && explanationMatch[1]) {
            explanation = explanationMatch[1].replace(/\\"/g, '"');
          } else {
            explanation = `Translated query for: "${question}"`;
          }
        }

        console.log(`${provider} successfully generated Cypher: ${cypher}`);
        console.log(`${provider} Reasoning: ${explanation}`);

      } catch (err: any) {
        console.error(`${provider} translation failed, executing intelligent fallback parser:`, err.message);
        const fallbackRes = generateFallbackCypher(question);
        cypher = fallbackRes.cypher;
        explanation = fallbackRes.explanation;
        usedFallback = true;
      }
    }

    // Execute the generated Cypher query using Graph Repository
    try {
      const result = await this.graphRepo.runRawCypher(cypher);
      const mappedResult = GraphMapper.toNLQResultDTO(result, cypher, explanation, usedFallback);

      // Apply LLM-as-a-judge semantic post-filtering to remove string-matching false positive noise
      return await this.filterIrrelevantResults(question, mappedResult, overrideModel);
    } catch (err: any) {
      throw new Error(`Neo4j execution of generated Cypher failed: ${err.message}. Query was: ${cypher}`);
    }
  }

  /**
   * Post-processes query results using the active LLM model as a judge to evaluate node semantic relevance
   * and filter out wildcard/substring noise.
   */
  private async filterIrrelevantResults(
    question: string,
    mappedResult: NLQResultDTO,
    overrideModel?: string
  ): Promise<NLQResultDTO> {
    if (!mappedResult.nodes || mappedResult.nodes.length <= 1) {
      return mappedResult; // No need to filter empty or single-node graphs
    }

    // 1. Build relation lookup maps in memory from graph links (for backup fallback)
    const brandMap = new Map<string, string>();         // ProductId -> BrandName
    const categoryMap = new Map<string, string>();      // ProductId -> CategoryName
    const parentCategoryMap = new Map<string, string>(); // CategoryId -> ParentCategoryId
    const brandOwnerMap = new Map<string, string>();     // BrandId -> Manufacturer/Owner Name

    mappedResult.links.forEach(link => {
      if (link.type === 'BELONGS_TO') {
        categoryMap.set(link.source, link.targetName || '');
      } else if (link.type === 'MANUFACTURED_BY') {
        brandMap.set(link.source, link.targetName || '');
      } else if (link.type === 'PARENT_CATEGORY') {
        parentCategoryMap.set(link.source, link.target || '');
      } else if (link.type === 'OWNED_BY') {
        brandOwnerMap.set(link.source, link.targetName || '');
      }
    });

    // 2. Recursive helper to trace the complete parent category lineage hierarchy (for backup fallback)
    const getCategoryLineage = (catId: string, visited = new Set<string>()): string => {
      if (visited.has(catId)) return '';
      visited.add(catId);
      const catNode = mappedResult.nodes.find(n => n.id === catId);
      if (!catNode) return '';
      
      const parentId = parentCategoryMap.get(catId);
      if (parentId) {
        const parentLineage = getCategoryLineage(parentId, visited);
        return parentLineage ? `${catNode.properties.name} ➜ ${parentLineage}` : catNode.properties.name;
      }
      return catNode.properties.name;
    };

    // 3. Score and rank all candidate nodes by their graph-degree centrality and text relevance to ensure the most important top 50 are evaluated
    const candidateLimit = 50;
    const originalNodeCount = mappedResult.nodes.length;
    let nodesToJudge = mappedResult.nodes;

    if (originalNodeCount > candidateLimit) {
      console.log(`Analyzing and ranking ${originalNodeCount} candidate nodes to extract the top ${candidateLimit} most relevant...`);
      
      // A. Compile search words from user's question for text matching
      const stopWords = new Set(['show', 'me', 'find', 'get', 'list', 'brand', 'brands', 'product', 'products', 'category', 'categories', 'item', 'items', 'with', 'for', 'the', 'and', 'or', 'of', 'in', 'under']);
      const searchWords = question.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

      // B. Compute degrees (connection density) per node in memory from links
      const nodeDegrees = new Map<string, number>();
      mappedResult.links.forEach(link => {
        nodeDegrees.set(link.source, (nodeDegrees.get(link.source) || 0) + 1);
        nodeDegrees.set(link.target, (nodeDegrees.get(link.target) || 0) + 1);
      });

      // C. Score each node using unified degree density, type anchors, and keyword match boost
      const scoredNodes = mappedResult.nodes.map(node => {
        let score = 0;
        const type = node.labels[0] || '';
        const name = (node.properties.name || '').toLowerCase();
        
        // 1. Connection Density (centrality) in returned network
        const degree = nodeDegrees.get(node.id) || 0;
        score += degree * 2; // Central hubs get strong priority

        // 2. Type Anchors: Brand & Category nodes are structural, so boost them to preserve D3 canvas integrity
        if (type === 'Brand' || type === 'Category') {
          score += 15;
        }

        // 3. Keyword Match Boost
        searchWords.forEach(word => {
          if (name.startsWith(word)) {
            score += 10; // Exact prefix match gets high boost
          } else if (name.includes(word)) {
            score += 5;  // Substring match gets moderate boost
          }
        });

        return { node, score };
      });

      // D. Sort nodes by relevance score descending and slice the top 50
      scoredNodes.sort((a, b) => b.score - a.score);
      nodesToJudge = scoredNodes.slice(0, candidateLimit).map(item => item.node);
      
      console.log(`Successfully selected the top ${candidateLimit} relevant candidate nodes. Highest score: ${scoredNodes[0]?.score || 0}, Capped limit score: ${scoredNodes[candidateLimit-1]?.score || 0}.`);
    }

    // 4. Compile the candidate internal node IDs and fetch their complete deep graph lineages in a single fast, indexed query
    const internalIds = nodesToJudge
      .map(n => parseInt(n.id, 10))
      .filter(id => !isNaN(id));

    const enrichmentMap = new Map<string, {
      prodCategoryLineage?: string[];
      prodBrandName?: string;
      prodBrandOwner?: string;
      catParentLineage?: string[];
      brandOwnerName?: string;
      brandCategories?: string[];
    }>();

    if (internalIds.length > 0) {
      try {
        const enrichmentCypher = `
          MATCH (n)
          WHERE id(n) IN $internalIds

          // A. Product Node Enrichment:
          OPTIONAL MATCH (n)-[:BELONGS_TO]->(c:Category)
          OPTIONAL MATCH (n)-[:MANUFACTURED_BY]->(b:Brand)
          OPTIONAL MATCH (b)-[:OWNED_BY]->(bo)
          OPTIONAL MATCH path = (c)-[:PARENT_CATEGORY*0..5]->(parent:Category)
          WITH n, b, bo, path ORDER BY length(path) DESC
          WITH n, b, bo, collect(path)[0] AS longestPath
          WITH n, b, bo, [node IN nodes(longestPath) | node.name] AS prodCategoryLineage

          // B. Category Node Enrichment:
          OPTIONAL MATCH catPath = (n)-[:PARENT_CATEGORY*0..5]->(catParent:Category)
          WITH n, b, bo, prodCategoryLineage, catPath ORDER BY length(catPath) DESC
          WITH n, b, bo, prodCategoryLineage, collect(catPath)[0] AS longestCatPath
          WITH n, b, bo, prodCategoryLineage, [node IN nodes(longestCatPath) | node.name] AS catParentLineage

          // C. Brand Node Enrichment:
          OPTIONAL MATCH (n)-[:OWNED_BY]->(brandOwner)
          OPTIONAL MATCH (pGen:Product)-[:MANUFACTURED_BY]->(n)
          OPTIONAL MATCH (pGen)-[:BELONGS_TO]->(bCat:Category)
          WITH n, b, bo, prodCategoryLineage, catParentLineage, brandOwner, collect(DISTINCT bCat.name) AS brandCategories

          RETURN id(n) AS internalId,
                 prodCategoryLineage AS prodCategoryLineage,
                 b.name AS prodBrandName,
                 bo.name AS prodBrandOwner,
                 catParentLineage AS catParentLineage,
                 brandOwner.name AS brandOwnerName,
                 brandCategories AS brandCategories
        `;

        const dbStart = Date.now();
        const enrichmentResult = await this.graphRepo.runRawCypher(enrichmentCypher, { internalIds });
        const dbDuration = Date.now() - dbStart;
        console.log(`Neo4j candidate enrichment completed in ${dbDuration}ms.`);

        enrichmentResult.records.forEach((rec: any) => {
          const idVal = rec.get('internalId');
          const id = idVal ? idVal.toString() : '';
          if (id) {
            enrichmentMap.set(id, {
              prodCategoryLineage: rec.get('prodCategoryLineage'),
              prodBrandName: rec.get('prodBrandName'),
              prodBrandOwner: rec.get('prodBrandOwner'),
              catParentLineage: rec.get('catParentLineage'),
              brandOwnerName: rec.get('brandOwnerName'),
              brandCategories: rec.get('brandCategories')
            });
          }
        });
      } catch (dbErr: any) {
        console.warn("Graph database candidate enrichment failed, falling back to visual graph links:", dbErr.message);
      }
    }

    // 5. Serialize nodes dynamically, leveraging enriched context with robust backup fallbacks
    const candidatesString = nodesToJudge.map(n => {
      const type = n.labels[0];
      const props = n.properties;
      const enrich = enrichmentMap.get(n.id);
      
      if (type === 'Product') {
        const brandName = enrich?.prodBrandName || brandMap.get(n.id) || 'Unknown Brand';
        const brandOwner = enrich?.prodBrandOwner ? ` (Mfg: ${enrich.prodBrandOwner})` : '';
        
        let lineage = 'Unknown Category';
        if (enrich?.prodCategoryLineage && enrich.prodCategoryLineage.length > 0) {
          lineage = [...enrich.prodCategoryLineage].reverse().join(' ➜ ');
        } else {
          const catId = mappedResult.links.find(l => l.source === n.id && l.type === 'BELONGS_TO')?.target;
          if (catId) {
            lineage = getCategoryLineage(catId);
          }
        }
        
        return `[Product] ID: ${n.id} | Name: ${props.name} | Brand: ${brandName}${brandOwner} | Category Lineage: [${lineage}] | Pack: ${props.size || ''} ${props.measure || ''}`;
      } 
      
      else if (type === 'Category') {
        let lineage = '';
        if (enrich?.catParentLineage && enrich.catParentLineage.length > 0) {
          lineage = [...enrich.catParentLineage].reverse().join(' ➜ ');
        } else {
          lineage = getCategoryLineage(n.id);
        }
        return `[Category] ID: ${n.id} | Name: ${props.name} | Level: ${props.level} | Taxonomy: ${props.taxonomy} | Parent Tree: [${lineage}]`;
      } 
      
      else if (type === 'Brand') {
        const ownerName = enrich?.brandOwnerName || brandOwnerMap.get(n.id) || 'Independent/Unknown';
        
        let brandCatNames = enrich?.brandCategories || [];
        if (brandCatNames.length === 0) {
          brandCatNames = mappedResult.links
            .filter(l => l.target === n.id && l.type === 'MANUFACTURED_BY')
            .map(l => categoryMap.get(l.source))
            .filter((v, i, a): v is string => !!v && a.indexOf(v) === i); // Deduplicate
        }
        
        return `[Brand] ID: ${n.id} | Name: ${props.name} | Manufacturer/Owner: ${ownerName} | Categories Sold In: [${brandCatNames.join(', ') || 'Unknown'}]`;
      }
      
      return `[${type}] ID: ${n.id} | Name: ${props.name || n.id}`;
    }).join('\n');

    const judgePrompt = `You are a professional semantic judge for a Retail Product Knowledge Graph.
Your task is to identify and retain only the Graph nodes that are truly, semantically relevant to the user's natural language question, filtering out any search noise (such as unrelated brands or categories that were returned due to loose case-insensitive wildcard/substring matches).

User Question: "${question}"

Candidate Nodes in Graph (Compiled with Neighborhood and Lineage Context):
${candidatesString}

Strict Judging Rules:
1. Identify the core subject, category, or industry of the user's query (e.g., if they ask about "Poppi", they are asking about prebiotic sodas/beverages).
2. For each candidate node, determine if it belongs to or is highly relevant to that core subject or segment.
3. Filter out nodes that are unrelated segments (e.g., if the user asked about a soda brand, "Poppies" cookie brand or "Just Poppin" popcorn brand should be rejected as search noise/false positives).
4. Do NOT filter out legitimate competitors, complements, or categories that are related to the core subject.
5. If you are unsure about a node's relevance, include it to be safe.
6. If all nodes seem relevant, retain all of them.

Return EXACTLY a raw JSON array of the string IDs of the RELEVANT nodes. Do NOT include any key-value wrappers, do NOT include any markdown wraps or extra text. Output only the array.
Example Output Format: ["node_id_1", "node_id_2"]`;

    const provider = overrideModel
      ? (overrideModel.startsWith('gpt') ? 'openai'
        : overrideModel.startsWith('claude') ? 'anthropic'
        : 'gemini')
      : appConfig.llm.activeProvider;

    const apiKey = provider === 'openai' ? appConfig.openAiApiKey
      : provider === 'anthropic' ? appConfig.anthropicApiKey
      : appConfig.geminiApiKey;

    if (!apiKey || !appConfig.llm.nlqEnabled) {
      return mappedResult; // Degradation: skip filtering if LLM is unavailable
    }

    try {
      console.log(`Sending graph-aware contextual payload containing ${mappedResult.nodes.length} candidates to LLM judge (${provider})...`);
      const judgeStart = Date.now();
      const responseText = await this.llmService.generateContent(judgePrompt, 'nlq', true, overrideModel);
      const judgeDuration = Date.now() - judgeStart;
      console.log(`LLM judge request completed in ${judgeDuration}ms.`);
      
      const cleanedText = responseText
        .replace(/```json/gi, '')
        .replace(/```/gi, '')
        .trim();

      const parsed = JSON.parse(cleanedText);
      const relevantNodeIds = new Set<string>(Array.isArray(parsed) ? parsed : (parsed.relevantNodeIds || []));

      if (relevantNodeIds.size === 0) {
        console.warn('LLM judge returned an empty relevant nodes list. Skipping filtering to avoid empty graph.');
        return mappedResult;
      }

      // Filter nodes (only keep relevant nodes from the capped set of judged nodes)
      const filteredNodes = nodesToJudge.filter(node => relevantNodeIds.has(node.id));

      // Filter links: retain a link only if BOTH its source and target exist in the filtered node set
      const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
      const filteredLinks = mappedResult.links.filter(link =>
        filteredNodeIds.has(link.source) && filteredNodeIds.has(link.target)
      );

      console.log(`LLM judge successfully filtered nodes. Kept ${filteredNodes.length}/${mappedResult.nodes.length} nodes, ${filteredLinks.length}/${mappedResult.links.length} links.`);

      return {
        ...mappedResult,
        nodes: filteredNodes,
        links: filteredLinks
      };
    } catch (err: any) {
      console.error('LLM judge reranking failed, falling back to unfiltered results:', err.message);
      return mappedResult;
    }
  }
}
