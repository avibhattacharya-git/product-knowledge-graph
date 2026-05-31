import pg from 'pg';
import 'dotenv/config';

const pgPool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5445'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData'
});

async function runSodaCompetitorEval() {
  const pgClient = await pgPool.connect();
  const apiKey = process.env.GEMINI_API_KEY;
  
  try {
    console.log('=== Running Focused Soda Brand Competitor Evaluation ===');
    console.log(`Using API Key: ${apiKey ? 'PRESENT' : 'MISSING'}`);

    const sodaBrandIds = [
      '677',   // Coca-Cola
      '681',   // Cherry Coke
      '708',   // Diet Coke
      '710',   // Diet Coke Plus
      '758',   // 2012 Diet Coke Heart Truth
      '3290',  // Pepsi
      '38312', // Pepsi Variety Pack
      '38980', // Diet Pepsi
      '42965', // Pepsi Splash
      '43509', // Pepsi Zero Sugar
      '43553', // Sprite Zero Sugar
      '44258', // Diet Pepsi Wild Cherry
      '44259', // Pepsi Wild Cherry
      '44260', // Pepsi Zero Sugar Wild Cherry
      '44261', // Diet Cherry Coke
      '44262', // Cherry Coke Zero
      '44443', // Coca-Cola Zero Sugar
      '44552', // Pepsi Soda Shop
      '46471'  // Coca-Cola Dreamworld
    ];

    // B. Fetch existing cached judgments
    console.log('Fetching cached brand competitor judgments from PostgreSQL...');
    const cacheRes = await pgClient.query(`SELECT brand1_id, brand2_id, competes FROM brand_competitor_judgments`);
    const cacheMap = new Map<string, boolean>();
    cacheRes.rows.forEach(r => {
      const b1 = String(r.brand1_id).trim();
      const b2 = String(r.brand2_id).trim();
      const key = b1 < b2 ? `${b1}_${b2}` : `${b2}_${b1}`;
      cacheMap.set(key, r.competes === true);
    });
    console.log(`Loaded ${cacheMap.size} cached brand judgments.`);

    // C. Query pgvector for candidates specifically involving soda brands (LIMIT 15 neighbors each)
    console.log('Querying pgvector for soda brand candidate pairs (LIMIT 15)...');
    const candidateQuery = `
      SELECT 
        b1.id AS brand1_id,
        b1.name AS brand1_name,
        b2.id AS brand2_id,
        b2.name AS brand2_name,
        cat.name AS shared_category_name,
        b2.distance
      FROM brands_search_mv b1
      CROSS JOIN LATERAL (
        SELECT 
          b2_inner.id,
          b2_inner.name,
          m2.category_id,
          (b1.embedding <=> b2_inner.embedding) AS distance
        FROM brands_search_mv b2_inner
        JOIN brand_category_map_mv m1 ON m1.brand_id = b1.id
        JOIN brand_category_map_mv m2 ON m2.brand_id = b2_inner.id AND m2.category_id = m1.category_id
        WHERE b2_inner.id <> b1.id AND b2_inner.embedding IS NOT NULL
        ORDER BY b1.embedding <=> b2_inner.embedding ASC
        LIMIT 15
      ) b2
      JOIN product_categories_search_mv cat ON cat.id = b2.category_id
      WHERE b1.id = ANY($1) OR b2.id = ANY($1)
    `;
    const candidateRes = await pgClient.query(candidateQuery, [sodaBrandIds]);
    console.log(`Found ${candidateRes.rows.length} brand candidate pairs involving soda brands.`);

    // D. Filter candidates against cache
    const uncachedCandidates: any[] = [];
    const competitorsToLoad: { b1: string, b2: string, brand1: string, brand2: string }[] = [];

    candidateRes.rows.forEach(row => {
      const b1 = String(row.brand1_id).trim();
      const b2 = String(row.brand2_id).trim();
      const name1 = String(row.brand1_name).trim();
      const name2 = String(row.brand2_name).trim();
      const key = b1 < b2 ? `${b1}_${b2}` : `${b2}_${b1}`;

      if (cacheMap.has(key)) {
        if (cacheMap.get(key) === true) {
          competitorsToLoad.push({ b1, b2, brand1: name1, brand2: name2 });
        }
      } else {
        uncachedCandidates.push({
          key,
          brand1_id: b1,
          brand1_name: name1,
          brand2_id: b2,
          brand2_name: name2,
          category: String(row.shared_category_name).trim()
        });
      }
    });

    // Remove duplicates from uncached candidates by key
    const uniqueUncached = Array.from(new Map(uncachedCandidates.map(item => [item.key, item])).values());
    
    console.log(`${competitorsToLoad.length} competitor pairs involving sodas already in cache.`);
    console.log(`${uniqueUncached.length} new unique candidate pairs involving sodas need LLM evaluation.`);

    // E. Evaluate uncached soda candidate pairs using Gemini API Judge
    if (uniqueUncached.length > 0) {
      if (!apiKey) {
        console.warn('Gemini API Key missing, defaulting all to competes = true...');
        const insertQueries: Promise<any>[] = [];
        for (const pair of uniqueUncached) {
          insertQueries.push(pgClient.query(
            `INSERT INTO brand_competitor_judgments (brand1_id, brand2_id, competes) 
             VALUES ($1, $2, $3) ON CONFLICT (brand1_id, brand2_id) DO NOTHING`,
            [pair.brand1_id, pair.brand2_id, true]
          ));
        }
        await Promise.all(insertQueries);
        console.log('Successfully wrote fallback competitor entries.');
      } else {
        console.log(`Starting batched LLM evaluations for ${uniqueUncached.length} soda brand pairs via Gemini...`);
        
        const fetchWithBackoff = async (url: string, options: any, maxRetries = 5, baseDelay = 1000): Promise<any> => {
          let attempt = 0;
          while (attempt < maxRetries) {
            try {
              const res = await fetch(url, options);
              if (res.status === 429) {
                attempt++;
                const delay = Math.min(30000, baseDelay * Math.pow(2, attempt));
                console.warn(`[LLM Judge] Rate limited (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
              }
              if (!res.ok) {
                throw new Error(`Gemini API Error: Status ${res.status} ${res.statusText}`);
              }
              return await res.json();
            } catch (err: any) {
              attempt++;
              if (attempt >= maxRetries) throw err;
              const delay = Math.min(30000, baseDelay * Math.pow(2, attempt));
              console.warn(`[LLM Judge] Error: ${err.message}. Retrying in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
            }
          }
        };

        const batchSize = 30;
        const processBatch = async (batch: any[]) => {
          const promptPayload = batch.map((item, idx) => ({
            id: `pair_${idx}`,
            brandA: item.brand1_name,
            brandB: item.brand2_name,
            category: item.category
          }));

          const prompt = `You are a retail market intelligence expert.
Given a list of brand pairings and their shared product categories, evaluate whether they are direct competitors in the market.

Definition of Direct Competitors:
- They target the same consumer demographics.
- They operate in comparable price tiers (e.g., both premium, both mainstream, or both budget).
- They offer highly overlapping product selections in the category.
- Coca-Cola (Coke) and Pepsi are direct competitors in Soft Drinks.

You must return a JSON object mapping each "id" to a boolean (true if competitors, false otherwise). No markdown wrapping, no explanation.

Input:
${JSON.stringify(promptPayload, null, 2)}
`;

          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
          
          try {
            const resData = await fetchWithBackoff(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  responseMimeType: "application/json"
                }
              })
            });

            if (resData.candidates && resData.candidates.length > 0) {
              const rawText = resData.candidates[0].content.parts[0].text;
              const judgments = JSON.parse(rawText.trim());

              const cacheQueries: Promise<any>[] = [];
              batch.forEach((item, idx) => {
                const id = `pair_${idx}`;
                const competes = judgments[id] === true;
                
                cacheQueries.push(pgClient.query(
                  `INSERT INTO brand_competitor_judgments (brand1_id, brand2_id, competes) 
                   VALUES ($1, $2, $3) ON CONFLICT (brand1_id, brand2_id) DO NOTHING`,
                  [item.brand1_id, item.brand2_id, competes]
                ));
                console.log(`- Evaluated: "${item.brand1_name}" vs "${item.brand2_name}" in Category "${item.category}" -> Competitors: ${competes}`);
              });

              await Promise.all(cacheQueries);
            }
          } catch (err: any) {
            console.error(`[LLM Judge] Failed to process batch:`, err.message);
            // Default to true on error
            const cacheQueries: Promise<any>[] = [];
            batch.forEach(item => {
              cacheQueries.push(pgClient.query(
                `INSERT INTO brand_competitor_judgments (brand1_id, brand2_id, competes) 
                 VALUES ($1, $2, $3) ON CONFLICT (brand1_id, brand2_id) DO NOTHING`,
                [item.brand1_id, item.brand2_id, true]
              ));
            });
            await Promise.all(cacheQueries);
          }
        };

        for (let i = 0; i < uniqueUncached.length; i += batchSize) {
          const chunk = uniqueUncached.slice(i, i + batchSize);
          await processBatch(chunk);
        }
        console.log('\n=== Evaluation Completed and Saved to PostgreSQL ===');
      }
    } else {
      console.log('No new soda candidate pairs need evaluation.');
    }

  } catch (err: any) {
    console.error('Error during Soda Brand Competitor Evaluation:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
  }
}

runSodaCompetitorEval();
