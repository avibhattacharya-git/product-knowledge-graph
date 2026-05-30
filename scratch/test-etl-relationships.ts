import pg from 'pg';
import neo4j from 'neo4j-driver';
import 'dotenv/config';

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

// We will simulate Step 6 (Category Complements) in isolation
async function testCategoryRelationships(pgClient: pg.PoolClient, apiKey: string) {
  console.log('\n--- SIMULATING DYNAMIC CATEGORY RELATIONSHIPS (Step 6) ---');
  
  // A. Initialize Table
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS category_relationships_cache (
      category1_id VARCHAR(50),
      category2_id VARCHAR(50),
      relationship_type VARCHAR(20) NOT NULL,
      evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (category1_id, category2_id)
    )
  `);

  // B. Fetch existing cached relationships
  const cacheRes = await pgClient.query(`SELECT category1_id, category2_id, relationship_type FROM category_relationships_cache`);
  const cacheMap = new Map<string, string>();
  cacheRes.rows.forEach(r => {
    const c1 = String(r.category1_id).trim();
    const c2 = String(r.category2_id).trim();
    const key = c1 < c2 ? `${c1}_${c2}` : `${c2}_${c1}`;
    cacheMap.set(key, String(r.relationship_type).trim().toUpperCase());
  });
  console.log(`Loaded ${cacheMap.size} cached category relationships.`);

  // C. Query pgvector for Level 1 & 2 categories
  const catCandidateQuery = `
    WITH dept_categories AS (
      SELECT id, name, embedding 
      FROM product_categories_search_mv
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
    LIMIT 200 -- limit candidate search for test run speed
  `;
  const candidateRes = await pgClient.query(catCandidateQuery);
  console.log(`Found ${candidateRes.rows.length} vector candidate pairs.`);

  // D. Filter candidates against cache
  const uncachedCatCandidates: any[] = [];
  const cachedComplements: any[] = [];
  const cachedSubstitutes: any[] = [];

  candidateRes.rows.forEach(row => {
    const c1 = String(row.cat1_id).trim();
    const c2 = String(row.cat2_id).trim();
    const key = c1 < c2 ? `${c1}_${c2}` : `${c2}_${c1}`;

    if (cacheMap.has(key)) {
      const type = cacheMap.get(key);
      if (type === 'COMPLEMENT') {
        cachedComplements.push({ name1: row.cat1_name, name2: row.cat2_name });
      } else if (type === 'SUBSTITUTE') {
        cachedSubstitutes.push({ name1: row.cat1_name, name2: row.cat2_name });
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

  console.log(`\nCache hit stats:`);
  console.log(`  - Complements directly from Cache: ${cachedComplements.length}`);
  cachedComplements.slice(0, 3).forEach(c => console.log(`    -> "${c.name1}" & "${c.name2}"`));
  console.log(`  - Substitutes directly from Cache: ${cachedSubstitutes.length}`);
  cachedSubstitutes.slice(0, 3).forEach(c => console.log(`    -> "${c.name1}" & "${c.name2}"`));
  console.log(`  - Uncached category pairs needing LLM evaluation: ${uncachedCatCandidates.length}`);

  // E. Simulating LLM Judgement on 1 batch of 15 pairs to prove prompt, response, and cache write-back work perfectly!
  if (uncachedCatCandidates.length > 0) {
    const testBatch = uncachedCatCandidates.slice(0, 15);
    console.log(`\nEvaluating a test batch of ${testBatch.length} uncached pairs via Gemini 3.5 Flash Judge...`);

    const promptPayload = testBatch.map((item, idx) => ({
      id: `pair_${idx}`,
      catA: item.cat1_name,
      catB: item.cat2_name
    }));

    const prompt = `You are a retail category management expert.
Given a list of department-level category pairings, evaluate and classify their retail market relationship into one of three types:

1. 'COMPLEMENT': Products in these categories are frequently bought together or serve as direct companion accessories (e.g., Shampoo & Conditioner, Dog Care & Dog Toys, Dips & Salsa).
2. 'SUBSTITUTE': Products in these categories represent alternative choices, different formats, or variants of the same product type (e.g., Domestic Beer & IPA & Pale Ale, White Bread & Sandwich Bread, Basic Shampoo & Shampoo).
3. 'NONE': Unrelated categories or no direct complement/substitution relationship (e.g., Laundry Care & Disinfectants, Seafood & Milk).

You must return a JSON object mapping each "id" to one of these three strings ('COMPLEMENT', 'SUBSTITUTE', or 'NONE'). No markdown wrapping, no explanation.

Input:
${JSON.stringify(promptPayload, null, 2)}
`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API Error: Status ${response.status}`);
    }

    const resData: any = await response.json();
    if (resData.candidates && resData.candidates.length > 0) {
      const rawText = resData.candidates[0].content.parts[0].text;
      const judgments = JSON.parse(rawText.trim());

      console.log("\nLLM Category Judgments Received successfully:");
      const cacheQueries = [];
      testBatch.forEach((item, idx) => {
        const id = `pair_${idx}`;
        const relationshipType = String(judgments[id] || 'NONE').toUpperCase().trim();
        console.log(`  -> Pair: "${item.cat1_name}" & "${item.cat2_name}" => Class: ${relationshipType}`);
        
        cacheQueries.push(pgClient.query(
          `INSERT INTO category_relationships_cache (category1_id, category2_id, relationship_type) 
           VALUES ($1, $2, $3) ON CONFLICT (category1_id, category2_id) DO NOTHING`,
          [item.cat1_id, item.cat2_id, relationshipType]
        ));
      });
      await Promise.all(cacheQueries);
      console.log("Cached LLM category judgments saved successfully to PostgreSQL.");
    }
  }
}

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Gemini API Key missing in environment.");
    return;
  }

  const client = await pgPool.connect();
  try {
    await testCategoryRelationships(client, apiKey);
  } catch (err: any) {
    console.error('Validation Run Failed:', err.stack || err.message);
  } finally {
    client.release();
    await pgPool.end();
    await neoDriver.close();
  }
}

run();
