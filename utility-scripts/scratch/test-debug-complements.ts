import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function run() {
  const session = neoDriver.session();
  const id = "5384286";
  try {
    console.log(`Debugging complements for product ${id}...`);
    
    // 1. Get product category and brand
    const res1 = await session.run(`
      MATCH (p1:Product {id: $id})
      OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)
      OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)
      RETURN c1.id AS catId, c1.name AS catName, b.id AS brandId, b.name AS brandName
    `, { id });
    
    if (res1.records.length > 0) {
      const r = res1.records[0];
      console.log(`Product Brand: ${r.get('brandName')} (${r.get('brandId')})`);
      console.log(`Product Category: ${r.get('catName')} (${r.get('catId')})`);
    }

    // 2. Get department level 2 of the product category
    const res2 = await session.run(`
      MATCH (p1:Product {id: $id})-[:BELONGS_TO]->(c1:Category)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})
      RETURN dept1.id AS deptId, dept1.name AS deptName
    `, { id });
    console.log("Departments at level 2:");
    res2.records.forEach(r => {
      console.log(`- ${r.get('deptName')} (${r.get('deptId')})`);
    });

    // Find some categories that have COMPLEMENTARY_TO relationships
    const resComps = await session.run(`
      MATCH (c1:Category)-[r:COMPLEMENTARY_TO]-(c2:Category)
      RETURN c1.name AS c1Name, c1.level AS c1Level, r.similarity AS similarity, c2.name AS c2Name, c2.level AS c2Level
      LIMIT 10
    `);
    console.log("Sample Category Complements in DB:");
    resComps.records.forEach(r => {
      console.log(`- ${r.get('c1Name')} (L${r.get('c1Level')}) -[similarity: ${r.get('similarity')}]-> ${r.get('c2Name')} (L${r.get('c2Level')})`);
    });

  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}
run();
