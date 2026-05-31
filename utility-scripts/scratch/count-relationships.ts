import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function run() {
  const session = neoDriver.session();
  try {
    console.log("=== NEO4J RELATIONSHIP COUNTS ===");
    const res = await session.run(`
      MATCH ()-[r]->()
      RETURN type(r) AS relType, count(r) AS relCount
      ORDER BY relCount DESC
    `);
    for (const rec of res.records) {
      console.log(`- ${rec.get('relType')}: ${rec.get('relCount')}`);
    }
  } catch (err: any) {
    console.error("Error:", err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

run();
