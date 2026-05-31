import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function run() {
  const session = neoDriver.session();
  // We'll test with the Raw Sugar shampoo ID ("6116746") and GE Light Bulb ("1417896")
  const productIds = ["6116746", "1417896"];

  try {
    for (const id of productIds) {
      console.log(`\nTesting ultra-fast related query for ID: "${id}"...`);
      const start = Date.now();

      const cypher = `
        MATCH (p1:Product {id: $id})
        
        // A. Rivals (Same Category or Linked Substitute Categories, Competing Brands)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)
        OPTIONAL MATCH (c1)-[:SUBSTITUTE_CATEGORY]-(c2:Category)
        WITH p1, c1, collect(DISTINCT c2) + c1 AS allowedRivalCategories
        
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b1:Brand)-[compEdge:COMPETES_WITH]-(b2:Brand)
        WITH p1, allowedRivalCategories, collect(DISTINCT b2) AS allowedBrands, collect({ id: b2.id, similarity: compEdge.similarity }) AS brandSimilarities
        
        // Match rivals starting from allowed competing brands (which is very small!)
        UNWIND allowedBrands AS rivalBrand
        OPTIONAL MATCH (rival:Product)-[:MANUFACTURED_BY]->(rivalBrand)
        OPTIONAL MATCH (rival)-[:BELONGS_TO]->(rc:Category)
        WHERE rc IN allowedRivalCategories AND rival <> p1
        
        // Find the similarity for this rival's brand
        WITH p1, rival, [item IN brandSimilarities WHERE item.id = rivalBrand.id][0] AS compInfo
        WITH p1, collect({ node: rival, similarity: compInfo.similarity })[..15] AS competitors
        
        // B. Companion Accessories (Same Brand, Complementary Categories via Parent Departments)
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})-[:COMPLEMENTARY_TO]-(dept2:Category {level: 2})
        OPTIONAL MATCH (c2:Category)-[:PARENT_CATEGORY*0..2]->(dept2)
        WITH competitors, p1, b, collect(DISTINCT c2) AS allowedComplementCategories
        
        // Traversal starting from the brand "b" (which is just 1 node!) to find accessories
        OPTIONAL MATCH (comp:Product)-[:MANUFACTURED_BY]->(b)
        OPTIONAL MATCH (comp)-[:BELONGS_TO]->(cComp:Category)
        WHERE cComp IN allowedComplementCategories AND comp <> p1
        WITH competitors, collect(DISTINCT comp)[..15] AS complements, p1
        
        // C. Packaging/Flavor Siblings (Same Brand, Same Category)
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c:Category)
        OPTIONAL MATCH (sib:Product)-[:BELONGS_TO]->(c)
        WHERE (sib)-[:MANUFACTURED_BY]->(b) AND sib <> p1
        WITH competitors, complements, collect(DISTINCT sib)[..15] AS siblings
        
        RETURN competitors, complements, siblings
      `;

      const result = await session.run(cypher, { id });
      const duration = Date.now() - start;
      console.log(`--> Query completed in ${duration}ms`);

      if (result.records.length > 0) {
        const rec = result.records[0];
        const comps = rec.get('competitors') || [];
        const compls = rec.get('complements') || [];
        const sibs = rec.get('siblings') || [];
        console.log(`--> Competitors: ${comps.length}, Complements: ${compls.length}, Siblings: ${sibs.length}`);
      }
    }
  } catch (err: any) {
    console.error("Query Error:", err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

run();
