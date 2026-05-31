import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function run() {
  const session = neoDriver.session();
  // We'll test with a few product IDs, including the General Electric Light Bulb ("1417896")
  const productIds = ["6116746", "c4f4a0f6-e7a1-5842-bf8d-b08562193a2d", "1417896", "961398"];

  try {
    for (const id of productIds) {
      console.log(`\nTesting optimized related query for ID: "${id}"...`);
      const start = Date.now();

      const cypher = `
        MATCH (p1:Product {id: $id})
        
        // A. Rivals (Same Category or Linked Substitute Categories, Competing Brands)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)
        OPTIONAL MATCH (c1)-[:SUBSTITUTE_CATEGORY]-(c2:Category)
        WITH p1, c1, collect(DISTINCT c2) + c1 AS allowedRivalCategories
        
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b1:Brand)-[:COMPETES_WITH]-(b2:Brand)
        WITH p1, allowedRivalCategories, collect(DISTINCT b2) AS allowedBrands
        
        OPTIONAL MATCH (rival:Product)-[:BELONGS_TO]->(rc:Category)
        OPTIONAL MATCH (rival)-[:MANUFACTURED_BY]->(rivalBrand:Brand)
        WHERE rc IN allowedRivalCategories AND rivalBrand IN allowedBrands AND rival <> p1
        WITH p1, collect(DISTINCT rival)[..15] AS competitors
        
        // B. Companion Accessories (Same Brand, Complementary Categories via Parent Departments)
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})-[:COMPLEMENTARY_TO]-(dept2:Category {level: 2})
        OPTIONAL MATCH (c2:Category)-[:PARENT_CATEGORY*0..2]->(dept2)
        WITH competitors, p1, b, collect(DISTINCT c2) AS allowedComplementCategories
        
        OPTIONAL MATCH (comp:Product)-[:BELONGS_TO]->(cComp:Category)
        OPTIONAL MATCH (comp)-[:MANUFACTURED_BY]->(compBrand:Brand)
        WHERE cComp IN allowedComplementCategories AND compBrand = b AND comp <> p1
        WITH competitors, collect(DISTINCT comp)[..15] AS complements, p1
        
        // C. Packaging/Flavor Siblings (Same Brand, Same Category)
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c:Category)
        OPTIONAL MATCH (sib:Product)-[:BELONGS_TO]->(c)
        OPTIONAL MATCH (sib)-[:MANUFACTURED_BY]->(sibBrand:Brand)
        WHERE sibBrand = b AND sib <> p1
        WITH competitors, complements, collect(DISTINCT sib)[..15] AS siblings
        
        RETURN competitors, complements, siblings
      `;

      const result = await session.run(cypher, { id });
      const duration = Date.now() - start;
      console.log(`--> Query took ${duration}ms`);

      if (result.records.length > 0) {
        const rec = result.records[0];
        const comps = rec.get('competitors') || [];
        const compls = rec.get('complements') || [];
        const sibs = rec.get('siblings') || [];
        console.log(`--> Results found - Competitors: ${comps.length}, Complements: ${compls.length}, Siblings: ${sibs.length}`);
      } else {
        console.log(`--> No record returned`);
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
