import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function link() {
  const session = driver.session();
  try {
    console.log('Linking real product "1413162" to AEROSOL AIR FRESHENER category to populate size siblings...');
    await session.run(`
      MATCH (p:Product {id: "1413162"})
      MATCH (c:Category {id: "073fc1cb-5f50-536c-9ac4-0369ec1a4b8d"})
      MERGE (p)-[:BELONGS_TO]->(c)
    `);
    console.log('Successfully linked sibling product.');
  } catch (err: any) {
    console.error('Linking failed:', err.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

link();
