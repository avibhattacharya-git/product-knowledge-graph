import pg from 'pg';
import 'dotenv/config';

const pgPool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5445'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData'
});

async function runFullBrandCompetitorEval() {
  const pgClient = await pgPool.connect();
  const apiKey = process.env.GEMINI_API_KEY;
  
  try {
    console.log('======================================================');
    console.log('  STARTING FULL DATABASE BRAND COMPETITOR EVALUATION  ');
    console.log('  (Pruning: pgvector LIMIT 15 | Batch Size: 100)      ');
    console.log('======================================================\n');
    console.log(`Using API Key: ${apiKey ? 'PRESENT' : 'MISSING'}`);

    // 1. Fetch existing cached judgments
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

    // 2. Query pgvector for semantic brand candidates with our new LIMIT 15
    console.log('Querying pgvector for semantic brand candidates (LIMIT 15)...');
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
          (b1.embedding <=> b2_inner.embedding) AS distance
        FROM brands_search_mv b2_inner
        WHERE b2_inner.id <> b1.id AND b2_inner.embedding IS NOT NULL
        ORDER BY b1.embedding <=> b2_inner.embedding ASC
        LIMIT 15
      ) b2
      JOIN brand_category_map_mv m1 ON m1.brand_id = b1.id
      JOIN brand_category_map_mv m2 ON m2.brand_id = b2.id AND m2.category_id = m1.category_id
      JOIN product_categories_search_mv cat ON cat.id = m2.category_id
      WHERE b1.embedding IS NOT NULL
    `;
    const candidateRes = await pgClient.query(candidateQuery);
    console.log(`Found ${candidateRes.rows.length} vector brand candidate pairs in pgvector.`);

    // 3. Filter candidates against cache
    const uncachedCandidates: any[] = [];

    candidateRes.rows.forEach(row => {
      const b1 = String(row.brand1_id).trim();
      const b2 = String(row.brand2_id).trim();
      const key = b1 < b2 ? `${b1}_${b2}` : `${b2}_${b1}`;

      if (!cacheMap.has(key)) {
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

    // Remove duplicates from uncached candidates by key
    const uniqueUncached = Array.from(new Map(uncachedCandidates.map(item => [item.key, item])).values());
    
    // Sort uniqueUncached to prioritize critical soda and beverage brands first!
    const sodaKeywords = ['coke', 'coca', 'pepsi', 'sprite', 'soda', 'beverage'];
    const matchesSoda = (name: string) => {
      const lower = name.toLowerCase();
      return sodaKeywords.some(kw => lower.includes(kw));
    };

    uniqueUncached.sort((a, b) => {
      const aIsSoda = matchesSoda(a.brand1_name) || matchesSoda(a.brand2_name);
      const bIsSoda = matchesSoda(b.brand1_name) || matchesSoda(b.brand2_name);
      if (aIsSoda && !bIsSoda) return -1;
      if (!aIsSoda && bIsSoda) return 1;
      return 0;
    });

    console.log(`${uniqueUncached.length} new unique candidate pairs need LLM evaluation (Soda/beverage pairs prioritized first!).`);

    // 4. Evaluate uncached candidate pairs using batched Gemini API Judge with rate limiting & exponential backoff
    if (uniqueUncached.length > 0) {
      if (!apiKey) {
        console.warn('Gemini API Key missing, defaulting all uncached candidate pairs to COMPETES = TRUE...');
        // Batched insert fallback
        const chunk = uniqueUncached;
        const values: any[] = [];
        const valuePlaceholders: string[] = [];
        chunk.forEach((pair, idx) => {
          const offset = idx * 3;
          valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
          values.push(pair.brand1_id, pair.brand2_id, true);
        });
        await pgClient.query(
          `INSERT INTO brand_competitor_judgments (brand1_id, brand2_id, competes) 
           VALUES ${valuePlaceholders.join(', ')} ON CONFLICT (brand1_id, brand2_id) DO NOTHING`,
          values
        );
        console.log('Successfully written fallback judgments.');
      } else {
        console.log(`Starting batched LLM evaluations for ${uniqueUncached.length} pairs (Batch Size: 100)...`);
        
        // Helper to perform API call with retry and exponential backoff
        const fetchWithBackoff = async (url: string, options: any, maxRetries = 5, baseDelay = 2000): Promise<any> => {
          let attempt = 0;
          while (attempt < maxRetries) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60-second request timeout
            try {
              const res = await fetch(url, { ...options, signal: controller.signal });
              clearTimeout(timeoutId);
              if (res.status === 429) {
                attempt++;
                const delay = Math.min(60000, baseDelay * Math.pow(2, attempt));
                console.warn(`[LLM Judge] Rate limited (429). Retrying in ${Math.round(delay/1000)}s... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
              }
              if (!res.ok) {
                throw new Error(`Gemini API Error: Status ${res.status} ${res.statusText}`);
              }
              return await res.json();
            } catch (err: any) {
              clearTimeout(timeoutId);
              attempt++;
              if (attempt >= maxRetries) throw err;
              const delay = Math.min(60000, baseDelay * Math.pow(2, attempt));
              console.warn(`[LLM Judge] Error: ${err.message}. Retrying in ${Math.round(delay/1000)}s...`);
              await new Promise(r => setTimeout(r, delay));
            }
          }
          throw new Error(`Gemini API call failed after ${maxRetries} attempts due to rate-limiting or network issues.`);
        };

        const batchSize = 100;
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
- They operate in comparable price tiers (e.g., both premium, both mainstream, or both budget).
- They offer highly overlapping product selections in the category.
- Coca-Cola (Coke) and Pepsi are direct competitors in Soft Drinks.

You must return a JSON object mapping each "id" to a boolean (true if competitors, false otherwise). No markdown wrapping, no explanation.

Input:
${JSON.stringify(promptPayload, null, 2)}
`;

          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
          
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

            if (resData && resData.candidates && resData.candidates.length > 0) {
              const rawText = resData.candidates[0].content.parts[0].text;
              const judgments = JSON.parse(rawText.trim());

              // Build a single batched insert statement
              const values: any[] = [];
              const valuePlaceholders: string[] = [];
              batch.forEach((item, idx) => {
                const id = `pair_${idx}`;
                const competes = judgments[id] === true;
                const offset = idx * 3;
                valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
                values.push(item.brand1_id, item.brand2_id, competes);
              });
              
              await pgClient.query(
                `INSERT INTO brand_competitor_judgments (brand1_id, brand2_id, competes) 
                 VALUES ${valuePlaceholders.join(', ')} 
                 ON CONFLICT (brand1_id, brand2_id) DO NOTHING`,
                values
              );
              return true;
            } else {
              throw new Error('Malformed API response: no candidates returned');
            }
          } catch (err: any) {
            console.error(`[LLM Judge] Failed to process batch of size ${batch.length}: ${err.message}. Skipping database insert for this batch.`);
            return false;
          }
        };

        const totalBatches = Math.ceil(uniqueUncached.length / batchSize);
        const concurrencyLimit = 12;

        // Populate our robust in-memory work queue
        const pendingQueue: any[][] = [];
        for (let i = 0; i < totalBatches; i++) {
          const start = i * batchSize;
          pendingQueue.push(uniqueUncached.slice(start, start + batchSize));
        }

        console.log(`Divided into ${totalBatches} batches of size ${batchSize}. Executing with concurrency limit ${concurrencyLimit} and self-healing queue retry...`);

        let completedCount = 0;

        const runWorker = async (): Promise<void> => {
          while (true) {
            // Pull the next batch from the queue
            const chunk = pendingQueue.shift();
            if (!chunk) break; // Queue is fully empty, worker can gracefully exit

            const success = await processBatch(chunk);
            if (success) {
              completedCount++;
              console.log(`  [PROGRESS] Evaluated batch ${completedCount}/${totalBatches} (${Math.round((completedCount/totalBatches)*100)}% complete)...`);
              
              // Add a tiny rate limit spacing of 1.5 seconds before starting next request
              await new Promise(r => setTimeout(r, 1500));
            } else {
              // If it failed, RE-QUEUE IT to the back of the queue!
              console.warn(`[Queue Monitor] Re-queueing failed batch to the back of the queue. Remaining queue size: ${pendingQueue.length + 1}...`);
              pendingQueue.push(chunk);
              
              // Sleep for 30 seconds to let transient network / rate-limiting clear up
              await new Promise(r => setTimeout(r, 30000));
            }
          }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrencyLimit, totalBatches); i++) {
          workers.push(runWorker());
        }
        await Promise.all(workers);
        console.log('\n=== PostgreSQL Brand Judgments Updated Database-Wide! ===');
      }
    } else {
      console.log('All candidates are already cached! No new brand pairings need evaluation.');
    }

  } catch (err: any) {
    console.error('Error during Brand Competitor Evaluation:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
  }
}

runFullBrandCompetitorEval();
