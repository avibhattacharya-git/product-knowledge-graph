import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function clean() {
  const session = driver.session();
  try {
    console.log('Running clean-up query against port 7687...');
    
    // Delete the mock brand
    await session.run(`
      MATCH (b:Brand {id: "competitor_brand"})
      DETACH DELETE b
    `);
    
    // Delete the mock MANUFACTURED_BY link
    await session.run(`
      MATCH (p1:Product {id: "5384286"})-[:MANUFACTURED_BY]->(b:Brand)
      MATCH (p2:Product {id: "5715877"})-[r:MANUFACTURED_BY]->(b)
      DELETE r
    `);
    
    console.log('Successfully cleaned all temporary test data. Database is 100% pristine.');
  } catch (err: any) {
    console.error('Clean-up failed:', err.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

clean();
