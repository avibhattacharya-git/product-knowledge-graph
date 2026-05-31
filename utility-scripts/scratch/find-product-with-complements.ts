import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function find() {
  const session = neoDriver.session();
  try {
    console.log("Searching for a product with brand companion complements...");
    const res = await session.run(`
      MATCH (p1:Product)-[:BELONGS_TO]->(c1:Category)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})-[compToEdge:COMPLEMENTARY_TO]-(dept2:Category {level: 2})
      MATCH (c2:Category)-[:PARENT_CATEGORY*0..2]->(dept2)
      MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)<-[:MANUFACTURED_BY]-(comp:Product)
      MATCH (comp)-[:BELONGS_TO]->(c2)
      WHERE p1 <> comp
      RETURN p1.id AS id, p1.name AS name, b.name AS brandName, comp.name AS compName, dept1.name AS d1, dept2.name AS d2
      LIMIT 5
    `);
    
    if (res.records.length === 0) {
      console.log("No products with both category complement and same-brand items found!");
    } else {
      res.records.forEach(r => {
        console.log(`- Product ID: "${r.get('id')}", Name: "${r.get('name')}"`);
        console.log(`  Brand: ${r.get('brandName')}`);
        console.log(`  Real Companion Complement: "${r.get('compName')}"`);
        console.log(`  Complement Categories: ${r.get('d1')} <-> ${r.get('d2')}`);
      });
    }
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}
find();
