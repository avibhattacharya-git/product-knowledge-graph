import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function run() {
  const session = neoDriver.session();
  const productIds = ["6116746", "1417896"];

  try {
    for (const id of productIds) {
      console.log(`\nTesting optimized related query with Category Complements similarities for ID: "${id}"...`);
      const start = Date.now();

      const cypher = `
        MATCH (p1:Product {id: $id})
        
        // A. Rivals (Same Category or Linked Substitute Categories, Competing Brands)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)
        OPTIONAL MATCH (c1)-[:SUBSTITUTE_CATEGORY]-(c2:Category)
        WITH p1, c1, collect(DISTINCT c2) + c1 AS allowedRivalCategories
        
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b1:Brand)-[compEdge:COMPETES_WITH]-(b2:Brand)
        WITH p1, allowedRivalCategories, collect(DISTINCT b2) AS allowedBrands, collect({ id: b2.id, similarity: compEdge.similarity }) AS brandSimilarities
        
        UNWIND allowedBrands AS rivalBrand
        OPTIONAL MATCH (rival:Product)-[:MANUFACTURED_BY]->(rivalBrand)
        OPTIONAL MATCH (rival)-[:BELONGS_TO]->(rc:Category)
        WHERE rc IN allowedRivalCategories AND rival <> p1
        
        WITH p1, rival, [item IN brandSimilarities WHERE item.id = rivalBrand.id][0] AS compInfo
        WITH p1, collect({ node: rival, similarity: compInfo.similarity })[..15] AS competitors
        
        // B. Companion Accessories (Same Brand, Complementary Categories via Parent Departments)
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})-[compToEdge:COMPLEMENTARY_TO]-(dept2:Category {level: 2})
        OPTIONAL MATCH (c2:Category)-[:PARENT_CATEGORY*0..2]->(dept2)
        WITH competitors, p1, b, collect(DISTINCT c2) AS allowedComplementCategories, collect({ id: dept2.id, similarity: compToEdge.similarity }) AS deptSimilarities
        
        UNWIND allowedComplementCategories AS cComp
        OPTIONAL MATCH (comp:Product)-[:BELONGS_TO]->(cComp)
        OPTIONAL MATCH (comp)-[:MANUFACTURED_BY]->(b)
        OPTIONAL MATCH (cComp)-[:PARENT_CATEGORY*0..2]->(deptComp:Category {level: 2})
        WHERE comp <> p1
        
        WITH competitors, p1, comp, [item IN deptSimilarities WHERE item.id = deptComp.id][0] AS compDeptInfo
        WITH competitors, collect({ node: comp, similarity: compDeptInfo.similarity })[..15] AS complements, p1
        
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
        console.log(`--> Competitors: ${comps.length}`);
        if (comps.length > 0) {
          console.log(`    - Sample Competitor Score: ${comps[0].similarity}`);
        }
        console.log(`--> Complements: ${compls.length}`);
        if (compls.length > 0) {
          console.log(`    - Sample Complement Score: ${compls[0].similarity}`);
          for (let i = 0; i < Math.min(3, compls.length); i++) {
            console.log(`      * [${i}] Name: "${compls[i].node.properties.name}", Similarity: ${compls[i].similarity}`);
          }
        }
        console.log(`--> Siblings: ${sibs.length}`);
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
