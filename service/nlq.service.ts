import { GraphRepository } from '../repository/graph.repository';
import { appConfig } from '../configs/app.config';
import { NLQResultDTO } from '../models/dto/graph.dto';
import { GraphMapper } from '../repository/mappers/graph.mapper';

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
  constructor(private graphRepo: GraphRepository) {}

  async processNLQQuery(question: string): Promise<NLQResultDTO> {
    const apiKey = appConfig.geminiApiKey;
    
    let cypher = '';
    let explanation = '';
    let usedFallback = false;

    if (!apiKey) {
      // 💡 Graceful fallback keyword-mapping query parser
      console.warn('Gemini API Key missing in env, executing keyword-mapping parser fallback...');
      const fallbackRes = generateFallbackCypher(question);
      cypher = fallbackRes.cypher;
      explanation = fallbackRes.explanation;
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
  - Relationships:
    - (Product)-[:MANUFACTURED_BY]->(Brand) (Brand owner)
    - (Product)-[:BELONGS_TO]->(Category) (Category taxonomy matching)
    - (Brand)-[:COMPETES_WITH]->(Brand) (Brand-level overlapping competitive rivalry)
    - (Category)-[:SUBSTITUTE_CATEGORY]->(Category) (Fuzzy/vector mapped product substitutes)
    - (Category)-[:COMPLEMENTARY_TO]->(Category) (Ecosystem bundle accessory pairs)
    - (Category)-[:PARENT_CATEGORY]->(Category) (Taxonomy tree parent category links)

Translate the user's natural language question into a single, valid, and highly optimized Neo4j Cypher query, and provide a clear, plain-English explanation of how you structured the query and what assumptions you made.

Your output MUST be a JSON object with EXACTLY the following structure. Do NOT include any markdown code wraps (like \`\`\`json or \`\`\`), do NOT include any surrounding text. Just return the JSON object:
{
  "cypher": "The valid Neo4j Cypher query",
  "explanation": "A concise, plain-English explanation (1-2 sentences) of what the query is doing, including any fuzzy/spelling matching or synonyms used to map the entities."
}

Strict Translation Rules:
1. Multi-Word Search Terms: When the user searches for a product phrase containing multiple words (e.g., "wet dog food" or "baking mix"), you MUST query them case-insensitively using AND operators for each word to avoid loose matches, OR search for the exact combined phrase.
   - Good: toLower(p.name) CONTAINS "wet" AND toLower(p.name) CONTAINS "dog" AND toLower(p.name) CONTAINS "food"
   - Bad: toLower(p.name) CONTAINS "wet" OR toLower(p.name) CONTAINS "dog" OR toLower(p.name) CONTAINS "food" (NEVER do this, as it matches irrelevant items!)
2. Category Mapping: If the search matches a general category of items (e.g., "dog food", "pet care", "electronics", "audio"), attempt to locate the Category node case-insensitively and match products belonging to it:
   - Example: MATCH (p:Product)-[r:BELONGS_TO]->(c:Category) WHERE toLower(c.name) CONTAINS "pet food"
3. Colloquial Entity Normalization & Synonyms:
   - If the user queries a colloquial brand name or abbreviation (e.g., "Coke", "Pepsi", "Gillette"), write case-insensitive matching logic to capture the full name in the database (e.g., toLower(b.name) CONTAINS "coca" for Coke).
   - If a category is queried colloquially (e.g., "soda", "detergent"), map it to the corresponding category name (e.g., toLower(c.name) CONTAINS "carbonated" or toLower(c.name) CONTAINS "laundry").
4. Relationships: Use the correct relationships from the schema.
   - Category-to-Category: SUBSTITUTE_CATEGORY, COMPLEMENTARY_TO, PARENT_CATEGORY.
   - Brand-to-Brand: COMPETES_WITH.
   - Product-to-Brand: MANUFACTURED_BY.
   - Product-to-Category: BELONGS_TO.
5. Price constraints: Map "under $X" or "cheap" to p.price < X, and "above $X" to p.price > X.
6. Return Format: Return the complete paths so they render visually: e.g., MATCH (p:Product)-[r1:BELONGS_TO]->(c:Category), (p)-[r2:MANUFACTURED_BY]->(b:Brand) RETURN p, r1, c, r2, b LIMIT 100.
7. Valid JSON: Ensure the Cypher query and the explanation are properly escaped so that the JSON parser does not fail (e.g., escape double quotes in the Cypher query).

User Question: "${question}"
Output JSON:`;

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
          console.warn('Failed to parse Gemini response as JSON. Attempting regex extraction...', jsonErr);
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

        console.log(`Gemini successfully generated Cypher: ${cypher}`);
        console.log(`Gemini Reasoning: ${explanation}`);

      } catch (err: any) {
        console.error('Gemini translation failed, executing intelligent fallback parser:', err.message);
        const fallbackRes = generateFallbackCypher(question);
        cypher = fallbackRes.cypher;
        explanation = fallbackRes.explanation;
        usedFallback = true;
      }
    }

    // Execute the generated Cypher query using Graph Repository
    try {
      const result = await this.graphRepo.runRawCypher(cypher);
      return GraphMapper.toNLQResultDTO(result, cypher, explanation, usedFallback);
    } catch (err: any) {
      throw new Error(`Neo4j execution of generated Cypher failed: ${err.message}. Query was: ${cypher}`);
    }
  }
}
