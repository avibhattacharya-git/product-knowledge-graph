import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function find() {
  const session = neoDriver.session();
  try {
    const res = await session.run(`
      MATCH (p:Product)
      WHERE toLower(p.name) CONTAINS 'active odor'
      RETURN p.id AS id, p.name AS name, id(p) AS internalId
    `);
    
    console.log("Found Active Odor products in Neo4j:");
    res.records.forEach(r => {
      console.log(`- Name: "${r.get('name')}"`);
      console.log(`  Properties.id: "${r.get('id')}"`);
      console.log(`  Internal ID: ${r.get('internalId')}`);
    });
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}
find();
