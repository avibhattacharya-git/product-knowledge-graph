import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function run() {
  const session = neoDriver.session();
  try {
    const cypher = `
      MATCH (c1:Category) WHERE toLower(c1.name) CONTAINS "toothbrush" OR toLower(c1.name) CONTAINS "oral care"
      MATCH (c2:Category) WHERE toLower(c2.name) CONTAINS "toothpaste" OR toLower(c2.name) CONTAINS "mouthwash" OR toLower(c2.name) CONTAINS "floss"
      WITH c1, c2
      
      // Fetch limited toothbrushes per category node
      CALL {
        WITH c1
        MATCH (p1:Product)-[r1:BELONGS_TO]->(c1)
        RETURN p1, r1 LIMIT 10
      }
      
      // Fetch limited oral complements per category node
      CALL {
        WITH c2
        MATCH (p2:Product)-[r2:BELONGS_TO]->(c2)
        RETURN p2, r2 LIMIT 10
      }
      
      RETURN c1.name as cat1, c2.name as cat2, p1.name as prod1, p2.name as prod2 LIMIT 5
    `;
    const res = await session.run(cypher);
    console.log(`Optimized complements query returned ${res.records.length} matches:`);
    res.records.forEach(rec => {
      console.log(`- ${rec.get('cat1')} (${rec.get('prod1')}) <-> ${rec.get('cat2')} (${rec.get('prod2')})`);
    });

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

run();
