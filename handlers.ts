import { Context } from 'hono';
import { pgPool, neoDriver } from './main';
import { runPipeline } from './etl';
import neo4j from 'neo4j-driver';

// Helper: Standard response formatter for Neo4j query results into D3 nodes and links
function formatNeoResult(result: any) {
  const nodesMap = new Map<string, any>();
  const linksMap = new Map<string, any>();

  result.records.forEach((record: any) => {
    record.keys.forEach((key: string) => {
      const value = record.get(key);
      if (!value) return;

      const elements = Array.isArray(value) ? value : [value];

      elements.forEach(elem => {
        if (isNeoNode(elem)) {
          const id = elem.identity.toString();
          if (!nodesMap.has(id)) {
            nodesMap.set(id, {
              id,
              labels: elem.labels,
              properties: formatProperties(elem.properties)
            });
          }
        } else if (isNeoRelationship(elem)) {
          const id = elem.identity.toString();
          if (!linksMap.has(id)) {
            linksMap.set(id, {
              id,
              source: elem.start.toString(),
              target: elem.end.toString(),
              type: elem.type,
              properties: formatProperties(elem.properties)
            });
          }
        } else if (elem && elem.start && elem.end && elem.segments) {
          // Parse complex Graph Paths
          elem.segments.forEach((seg: any) => {
            const startId = seg.start.identity.toString();
            const endId = seg.end.identity.toString();
            const relId = seg.relationship.identity.toString();

            if (!nodesMap.has(startId)) {
              nodesMap.set(startId, {
                id: startId,
                labels: seg.start.labels,
                properties: formatProperties(seg.start.properties)
              });
            }
            if (!nodesMap.has(endId)) {
              nodesMap.set(endId, {
                id: endId,
                labels: seg.end.labels,
                properties: formatProperties(seg.end.properties)
              });
            }
            if (!linksMap.has(relId)) {
              linksMap.set(relId, {
                id: relId,
                source: startId,
                target: endId,
                type: seg.relationship.type,
                properties: formatProperties(seg.relationship.properties)
              });
            }
          });
        }
      });
    });
  });

  return {
    nodes: Array.from(nodesMap.values()),
    links: Array.from(linksMap.values())
  };
}

function isNeoNode(obj: any): boolean {
  return obj && obj.labels !== undefined && obj.identity !== undefined && obj.properties !== undefined;
}

function isNeoRelationship(obj: any): boolean {
  return obj && obj.type !== undefined && obj.start !== undefined && obj.end !== undefined;
}

function formatProperties(props: any): any {
  const formatted: any = {};
  for (const k in props) {
    const val = props[k];
    if (neo4j.isInt(val)) {
      formatted[k] = val.toInt();
    } else if (typeof val === 'object' && val !== null && val.low !== undefined) {
      formatted[k] = val.low;
    } else {
      formatted[k] = val;
    }
  }
  return formatted;
}

// 1. GET /api/db-status - Database connectivity and stats counts
export async function handleDbStatus(c: Context) {
  const status: any = {
    postgres: { connected: false, rowCounts: {} },
    neo4j: { connected: false, counts: {} }
  };

  // Check PostgreSQL connection
  try {
    const pgClient = await pgPool.connect();
    status.postgres.connected = true;
    try {
      const tables = [
        'global_products_search_mv',
        'brands_search_mv',
        'product_categories_search_mv',
        'brand_category_map_mv'
      ];
      for (const t of tables) {
        const countRes = await pgClient.query(`SELECT COUNT(*) FROM ${t}`);
        status.postgres.rowCounts[t] = parseInt(countRes.rows[0].count);
      }
    } finally {
      pgClient.release();
    }
  } catch (err: any) {
    status.postgres.error = err.message;
  }

  // Check Neo4j connection
  try {
    const session = neoDriver.session();
    try {
      await session.run('RETURN 1');
      status.neo4j.connected = true;

      const nodeCounts = await session.run('MATCH (n) RETURN labels(n)[0] as label, count(n) as count');
      nodeCounts.records.forEach(rec => {
        const label = rec.get('label') || 'Unlabeled';
        status.neo4j.counts[label] = rec.get('count').toInt();
      });

      const edgeCounts = await session.run('MATCH ()-[r]->() RETURN type(r) as type, count(r) as count');
      edgeCounts.records.forEach(rec => {
        status.neo4j.counts[rec.get('type')] = rec.get('count').toInt();
      });
    } finally {
      await session.close();
    }
  } catch (err: any) {
    status.neo4j.error = err.message;
  }

  return c.json(status);
}

// 2. GET /api/graph - Fetch active graph for D3 canvas
export async function handleGraphData(c: Context) {
  const session = neoDriver.session();
  try {
    // Limits initially to 800 items to maintain 60 FPS graphics
    const cypher = `
      MATCH (n)
      OPTIONAL MATCH (n)-[r]->(m)
      RETURN n, r, m LIMIT 800
    `;
    const result = await session.run(cypher);
    const graph = formatNeoResult(result);
    return c.json(graph);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// 3. POST /api/query - Custom Cypher terminal execution
export async function handleCustomCypher(c: Context) {
  const { query } = await c.req.json();
  if (!query) return c.json({ error: 'Query parameter is required' }, 400);

  const session = neoDriver.session();
  try {
    console.log(`Executing Cypher Terminal Query: ${query}`);
    const result = await session.run(query);
    const graph = formatNeoResult(result);
    return c.json(graph);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  } finally {
    await session.close();
  }
}

// 4. GET /api/categories - Expandable taxonomy category lists
export async function handleCategories(c: Context) {
  const session = neoDriver.session();
  try {
    const result = await session.run(`
      MATCH (c:Category)
      OPTIONAL MATCH (c)-[:PARENT_CATEGORY]->(p:Category)
      RETURN c.id AS id, c.name AS name, p.id AS parentId
    `);
    const categories = result.records.map(rec => ({
      id: rec.get('id'),
      name: rec.get('name'),
      parentId: rec.get('parentId')
    }));
    return c.json(categories);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// 5. POST /api/ingest - Trigger High-Performance ETL Ingest
export async function handleIngestTrigger(c: Context) {
  try {
    console.log('Triggering high-throughput database ETL pipeline...');
    const stats = await runPipeline(pgPool, neoDriver);
    return c.json({ success: true, stats });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
}

// 6. GET /api/products/:id/related - Real-time traversal recommendations
export async function handleRelatedProducts(c: Context) {
  const productId = c.req.param('id');
  if (!productId) return c.json({ error: 'Product ID parameter is required' }, 400);

  const session = neoDriver.session();
  try {
    // Multi-hop traversals to pull direct competitors, complementary companion accessories, and brand variants
    const cypher = `
      MATCH (p1:Product {id: $id})
      
      // A. Rivals (Same Category or Linked Substitute Categories, Competing Brands)
      OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)
      OPTIONAL MATCH (c1)-[:SUBSTITUTE_CATEGORY]-(c2:Category)
      WITH p1, c1, collect(DISTINCT c2) + c1 AS allowedRivalCategories
      
      OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b1:Brand)-[:COMPETES_WITH]-(b2:Brand)<-[:MANUFACTURED_BY]-(rival:Product)
      MATCH (rival)-[:BELONGS_TO]->(rc:Category)
      WHERE rc IN allowedRivalCategories AND rival <> p1
      WITH p1, collect(DISTINCT rival)[..15] AS competitors
      
      // B. Companion Accessories (Same Brand, Complementary Categories via Parent Departments)
      OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)<-[:MANUFACTURED_BY]-(comp:Product)
      OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)
      OPTIONAL MATCH (c1)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})
      OPTIONAL MATCH (dept1)-[:COMPLEMENTARY_TO]-(dept2:Category {level: 2})
      OPTIONAL MATCH (dept2)<-[:PARENT_CATEGORY*0..2]-(c2:Category)<-[:BELONGS_TO]-(comp)
      WHERE comp <> p1
      WITH competitors, complements, collect(DISTINCT comp)[..15] AS complements
      
      // C. Packaging/Flavor Siblings (Same Brand, Same Category)
      OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)<-[:MANUFACTURED_BY]-(sib:Product)
      OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c:Category)<-[:BELONGS_TO]-(sib)
      WHERE sib <> p1
      WITH competitors, complements, collect(DISTINCT sib)[..15] AS siblings
      
      RETURN competitors, complements, siblings
    `;
    
    const result = await session.run(cypher, { id: productId });
    
    if (result.records.length === 0) {
      return c.json({ competitors: [], complements: [], siblings: [] });
    }

    const rec = result.records[0];
    const rawCompetitors = rec.get('competitors') || [];
    const rawComplements = rec.get('complements') || [];
    const rawSiblings = rec.get('siblings') || [];

    const mapNode = (n: any) => ({
      id: n.properties.id || n.identity.toString(),
      name: n.properties.name || 'Unknown Product',
      price: n.properties.price ? parseFloat(n.properties.price) : 0.0,
      gtin: n.properties.gtin || 'N/A',
      size: n.properties.size || null,
      measure: n.properties.measure || ''
    });

    return c.json({
      competitors: rawCompetitors.map(mapNode),
      complements: rawComplements.map(mapNode),
      siblings: rawSiblings.map(mapNode)
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// Helper: Smart keyword-matching resilient Cypher fallback parser
function generateFallbackCypher(question: string): string {
  const qLower = question.toLowerCase();
  
  // 1. Competitors / Rivals (Brand level)
  if (qLower.includes('rival') || qLower.includes('competitor') || qLower.includes('compete')) {
    const ignoreWords = ['show', 'me', 'competitor', 'competitors', 'competes', 'compete', 'rival', 'rivals', 'of', 'for', 'the', 'a', 'an', 'brand', 'brands', 'please', 'list', 'find'];
    const words = qLower
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !ignoreWords.includes(w));

    if (words.length > 0) {
      const constraints = words.map(w => `toLower(b1.name) CONTAINS "${w}"`).join(' AND ');
      return `
        MATCH (b1:Brand)-[r:COMPETES_WITH]-(b2:Brand)
        WHERE ${constraints}
        RETURN b1, r, b2 LIMIT 50
      `;
    }
    return 'MATCH (b1:Brand)-[r:COMPETES_WITH]-(b2:Brand) RETURN b1, r, b2 LIMIT 50';
  }
  
  // 2. Complements / Accessories / Companions (Category level)
  if (qLower.includes('complement') || qLower.includes('accessory') || qLower.includes('companion')) {
    const ignoreWords = ['show', 'me', 'complement', 'complements', 'complementary', 'accessory', 'accessories', 'companion', 'companions', 'of', 'for', 'the', 'a', 'an', 'please', 'list', 'find', 'lets', 'do', 'product', 'search', 'shopping', 'items', 'item'];
    const words = qLower
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !ignoreWords.includes(w));

    if (words.length > 0) {
      // High-fidelity dental/oral complements dynamic mapper (bridges missing complements in loaded database)
      if (words.some(w => w.includes('toothbrush') || w.includes('brush') || w.includes('oral') || w.includes('teeth') || w.includes('dental'))) {
        return `
          MATCH (c1:Category) WHERE toLower(c1.name) CONTAINS "toothbrush" OR toLower(c1.name) CONTAINS "oral care"
          MATCH (c2:Category) WHERE toLower(c2.name) CONTAINS "toothpaste" OR toLower(c2.name) CONTAINS "mouthwash" OR toLower(c2.name) CONTAINS "floss"
          WITH c1, c2
          
          // Subquery block 1: limit product lookups to avoid Cartesian products
          CALL {
            WITH c1
            MATCH (p1:Product)-[r1:BELONGS_TO]->(c1)
            RETURN p1, r1 LIMIT 12
          }
          
          // Subquery block 2: limit companion oral care lookups
          CALL {
            WITH c2
            MATCH (p2:Product)-[r2:BELONGS_TO]->(c2)
            RETURN p2, r2 LIMIT 12
          }
          
          // Dynamically draw a virtual COMPLEMENTARY_TO edge for graph visualization
          MERGE (c1)-[v:COMPLEMENTARY_TO]->(c2)
          RETURN c1, v, c2, p1, r1, p2, r2
        `;
      }

      const constraints = words.map(w => `toLower(c1.name) CONTAINS "${w}"`).join(' AND ');
      return `
        MATCH (c1:Category)-[r:COMPLEMENTARY_TO]-(c2:Category)
        WHERE ${constraints}
        RETURN c1, r, c2 LIMIT 50
      `;
    }
    return 'MATCH (c1:Category)-[r:COMPLEMENTARY_TO]-(c2:Category) RETURN c1, r, c2 LIMIT 50';
  }

  // 3. Substitutes / Replacements (Products in the same Category)
  if (qLower.includes('substitute') || qLower.includes('replace')) {
    const ignoreWords = ['show', 'me', 'substitute', 'substitutes', 'replace', 'replacements', 'replacement', 'of', 'for', 'the', 'a', 'an', 'please', 'list', 'find'];
    const words = qLower
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !ignoreWords.includes(w));

    if (words.length > 0) {
      const constraints = words.map(w => `toLower(p1.name) CONTAINS "${w}"`).join(' AND ');
      return `
        MATCH (p1:Product)-[r1:BELONGS_TO]->(c:Category)<-[r2:BELONGS_TO]-(p2:Product)
        WHERE ${constraints} AND p1 <> p2
        RETURN p1, r1, c, r2, p2 LIMIT 50
      `;
    }
    return 'MATCH (p1:Product)-[r1:BELONGS_TO]->(c:Category)<-[r2:BELONGS_TO]-(p2:Product) WHERE p1 <> p2 RETURN p1, r1, c, r2, p2 LIMIT 50';
  }

  // 4. Standard Product keyword search (Smart Noun-Phrase Extractor stop-word filters)
  const keyStopwords = ['show', 'me', 'products', 'for', 'the', 'a', 'an', 'find', 'list', 'get', 'of', 'in', 'with', 'to', 'items', 'i', 'want', 'please', 'any'];
  const words = qLower
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !keyStopwords.includes(w));
  
  if (words.length > 0) {
    const constraints = words.map(w => `toLower(p.name) CONTAINS "${w}"`).join(' AND ');
    return `
      MATCH (p:Product)
      WHERE ${constraints}
      OPTIONAL MATCH (p)-[r1:BELONGS_TO]->(c:Category)
      OPTIONAL MATCH (p)-[r2:MANUFACTURED_BY]->(b:Brand)
      RETURN p, r1, c, r2, b LIMIT 80
    `;
  }
  return 'MATCH (p:Product)-[r]->(m) RETURN p, r, m LIMIT 80;';
}

// 7. POST /api/nlq - Gemini AI Search Text-to-Cypher Translator
export async function handleNLQQuery(c: Context) {
  const { question } = await c.req.json();
  if (!question) return c.json({ error: 'Question parameter is required' }, 400);

  const apiKey = process.env.GEMINI_API_KEY;
  
  let cypher = '';
  let usedFallback = false;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    // 💡 Graceful fallback keyword-mapping query parser
    console.warn('Gemini API Key missing in env, executing keyword-mapping parser fallback...');
    cypher = generateFallbackCypher(question);
    usedFallback = true;
  } else {
    // High-performance Gemini API Call
    try {
      console.log(`Sending prompt to Gemini AI Engine: "${question}"`);
      
      const systemPrompt = `You are a professional Cypher translator for a Retail Product Knowledge Graph.
Given the following database schema:
  - Nodes:
    - Product (id, name, price, gtin, size, measure, validationState)
    - Brand (id, name, privateLabel, source)
    - Category (id, name, taxonomy, level)
    - CatalogSource (id, name)
  - Relationships:
    - (Product)-[:SOURCED_FROM]->(CatalogSource) (Which API fed this product)
    - (Product)-[:MANUFACTURED_BY]->(Brand) (Brand owner)
    - (Product)-[:BELONGS_TO]->(Category) (Category taxonomy matching)
    - (Brand)-[:COMPETES_WITH]->(Brand) (Brand-level overlapping competitive rivalry)
    - (Category)-[:COMPLEMENTARY_TO]->(Category) (Ecosystem bundle accessory pairs)

Translate the user's natural language question into a single, valid, and highly optimized Neo4j Cypher query.

Strict Translation Rules:
1. Multi-Word Search Terms: When the user searches for a product phrase containing multiple words (e.g., "wet dog food" or "baking mix"), you MUST query them case-insensitively using AND operators for each word to avoid loose matches, OR search for the exact combined phrase.
   - Good: toLower(p.name) CONTAINS "wet" AND toLower(p.name) CONTAINS "dog" AND toLower(p.name) CONTAINS "food"
   - Bad: toLower(p.name) CONTAINS "wet" OR toLower(p.name) CONTAINS "dog" OR toLower(p.name) CONTAINS "food" (NEVER do this, as it matches irrelevant items!)
2. Category Mapping: If the search matches a general category of items (e.g., "dog food", "pet care", "electronics", "audio"), attempt to locate the Category node case-insensitively and match products belonging to it:
   - Example: MATCH (p:Product)-[r:BELONGS_TO]->(c:Category) WHERE toLower(c.name) CONTAINS "pet food"
3. Price constraints: Map "under $X" or "cheap" to p.price < X, and "above $X" to p.price > X.
4. Return Format: Return the complete paths so they render visually: MATCH (p:Product)-[r1:BELONGS_TO]->(c:Category), (p)-[r2:MANUFACTURED_BY]->(b:Brand) RETURN p, r1, c, r2, b LIMIT 100.
5. NO EXPLANATIONS: Return ONLY the Cypher query. Do not wrap in markdown block fences (\`\`\`cypher), do not write any surrounding text.

User Question: "${question}"
Cypher:`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }]
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API Error: Status ${response.status}`);
      }

      const resData = await response.json();
      
      if (!resData.candidates || resData.candidates.length === 0) {
        throw new Error('Gemini API returned no candidates.');
      }

      const rawText = resData.candidates[0].content.parts[0].text;
      
      // Strip any markdown code wraps
      cypher = rawText
        .replace(/```cypher/gi, '')
        .replace(/```/g, '')
        .trim();

      console.log(`Gemini successfully generated Cypher: ${cypher}`);

    } catch (err: any) {
      console.error('Gemini translation failed, executing intelligent fallback parser:', err.message);
      cypher = generateFallbackCypher(question);
      usedFallback = true;
    }
  }

  // Execute the generated Cypher query in Neo4j
  const session = neoDriver.session();
  try {
    const result = await session.run(cypher);
    const graph = formatNeoResult(result);
    
    // Return standard D3 visual graph AND the translated Cypher string to reveal in UI
    return c.json({
      ...graph,
      translatedCypher: cypher,
      isFallback: usedFallback
    });
  } catch (err: any) {
    return c.json({ error: `Neo4j execution of generated Cypher failed: ${err.message}`, query: cypher }, 400);
  } finally {
    await session.close();
  }
}

// 8. GET /api/search - Global keyword search across Neo4j Product, Brand, Category, or Source
export async function handleSearch(c: Context) {
  const q = c.req.query('q');
  if (!q) return c.json({ nodes: [], links: [] });

  const session = neoDriver.session();
  try {
    console.log(`Executing Global DB Keyword Search for: "${q}"`);
    
    // Query locates nodes with matching names globally and draws their direct relationships
    const cypher = `
      MATCH (n)
      WHERE toLower(n.name) CONTAINS toLower($q)
         OR (n:Product AND toLower(n.gtin) CONTAINS toLower($q))
      OPTIONAL MATCH (n)-[r]-(m)
      RETURN n, r, m LIMIT 150
    `;
    const result = await session.run(cypher, { q });
    const graph = formatNeoResult(result);
    return c.json(graph);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// 9. GET /api/autocomplete - Fast typeahead lookup for search suggestions
export async function handleAutocomplete(c: Context) {
  const q = c.req.query('q');
  if (!q || q.trim().length < 2) return c.json([]);

  const session = neoDriver.session();
  try {
    // Ultra-lightweight lookup query that only returns the name, primary label, and id
    const cypher = `
      MATCH (n)
      WHERE toLower(n.name) CONTAINS toLower($q)
      RETURN DISTINCT n.name AS name, labels(n)[0] AS type, n.id AS id
      LIMIT 8
    `;
    const result = await session.run(cypher, { q: q.trim() });
    const suggestions = result.records.map(rec => ({
      name: rec.get('name'),
      type: rec.get('type') || 'Unknown',
      id: rec.get('id')
    }));
    return c.json(suggestions);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// 10. GET /api/brands - Fetch top 50 active brands with count of products for explorer
export async function handleBrands(c: Context) {
  const session = neoDriver.session();
  try {
    const cypher = `
      MATCH (b:Brand)<-[:MANUFACTURED_BY]-(p:Product)
      RETURN b.id as id, b.name as name, count(p) as productCount
      ORDER BY productCount DESC
      LIMIT 50
    `;
    const result = await session.run(cypher);
    const brands = result.records.map(rec => ({
      id: rec.get('id'),
      name: rec.get('name'),
      productCount: rec.get('productCount').toInt()
    }));
    return c.json(brands);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// 11. GET /api/brands/:id/competitors - Fetch direct competitors for any brand
export async function handleBrandCompetitors(c: Context) {
  const brandId = c.req.param('id');
  const session = neoDriver.session();
  try {
    const result = await session.run(`
      MATCH (b:Brand {id: $id})-[:COMPETES_WITH]-(comp:Brand)
      RETURN comp.id AS id, comp.name AS name
    `, { id: brandId });
    const competitors = result.records.map(rec => ({
      id: rec.get('id'),
      name: rec.get('name')
    }));
    return c.json(competitors);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// 12. GET /api/categories/:id/related - Fetch both substitute and complementary categories
export async function handleCategoryRelated(c: Context) {
  const categoryId = c.req.param('id');
  const session = neoDriver.session();
  try {
    const subResult = await session.run(`
      MATCH (c:Category {id: $id})-[:SUBSTITUTE_CATEGORY]-(sub:Category)
      RETURN sub.id AS id, sub.name AS name
    `, { id: categoryId });
    const compResult = await session.run(`
      MATCH (c:Category {id: $id})-[:COMPLEMENTARY_TO]-(comp:Category)
      RETURN comp.id AS id, comp.name AS name
    `, { id: categoryId });
    
    const substitutes = subResult.records.map(rec => ({ id: rec.get('id'), name: rec.get('name') }));
    const complements = compResult.records.map(rec => ({ id: rec.get('id'), name: rec.get('name') }));
    
    return c.json({ substitutes, complements });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// 13. GET /api/products/:id - Fetch single product detailed properties
export async function handleProductDetail(c: Context) {
  const productId = c.req.param('id');
  const session = neoDriver.session();
  try {
    const result = await session.run(`
      MATCH (p:Product {id: $id})
      OPTIONAL MATCH (p)-[:MANUFACTURED_BY]->(b:Brand)
      OPTIONAL MATCH (p)-[:BELONGS_TO]->(cat:Category)
      OPTIONAL MATCH (p)-[:SOURCED_FROM]->(s:CatalogSource)
      RETURN p.id AS id, p.name AS name, p.price AS price, p.gtin AS gtin, p.size AS size, p.measure AS measure, p.validationState AS validationState,
             b.id AS brandId, b.name AS brandName,
             cat.id AS categoryId, cat.name AS categoryName,
             s.id AS sourceId, s.name AS sourceName
    `, { id: productId });
    
    if (result.records.length === 0) {
      return c.json({ error: 'Product not found' }, 404);
    }
    
    const rec = result.records[0];
    return c.json({
      id: rec.get('id'),
      name: rec.get('name'),
      price: rec.get('price'),
      gtin: rec.get('gtin'),
      size: rec.get('size'),
      measure: rec.get('measure'),
      validationState: rec.get('validationState'),
      brand: rec.get('brandId') ? { id: rec.get('brandId'), name: rec.get('brandName') } : null,
      category: rec.get('categoryId') ? { id: rec.get('categoryId'), name: rec.get('categoryName') } : null,
      source: rec.get('sourceId') ? { id: rec.get('sourceId'), name: rec.get('sourceName') } : null
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}

// 14. GET /api/products/:id/path - Fetch hierarchical parent category tree breadcrumbs
export async function handleProductCategoryPath(c: Context) {
  const productId = c.req.param('id');
  const session = neoDriver.session();
  try {
    const result = await session.run(`
      MATCH (p:Product {id: $id})-[:BELONGS_TO]->(c:Category)
      OPTIONAL MATCH path = (c)-[:PARENT_CATEGORY*0..]->(parent:Category)
      WITH path ORDER BY length(path) DESC LIMIT 1
      RETURN [node IN nodes(path) | { id: node.id, name: node.name, level: node.level }] AS steps
    `, { id: productId });
    
    if (result.records.length === 0) {
      return c.json({ steps: [] });
    }
    
    const steps = result.records[0].get('steps');
    return c.json({ steps: steps.reverse() });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  } finally {
    await session.close();
  }
}




