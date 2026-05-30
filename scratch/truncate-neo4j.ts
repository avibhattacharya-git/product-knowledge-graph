import neo4j from 'neo4j-driver';
import 'dotenv/config';

const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  )
);

async function truncate() {
  const session = neoDriver.session();
  console.log('Initiating highly optimized batch truncation via APOC periodic iterate...');
  const startTime = Date.now();
  try {
    const res = await session.run(`
      CALL apoc.periodic.iterate(
        "MATCH (n) RETURN n",
        "DETACH DELETE n",
        {batchSize: 20000, parallel: false}
      )
    `);
    const record = res.records[0];
    console.log('APOC batch deletion completed successfully!');
    console.log(`- Total batches processed: ${record.get('batches').toString()}`);
    console.log(`- Total nodes/relationships affected: ${record.get('total').toString()}`);
    console.log(`- Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
  } catch (err: any) {
    console.error('APOC fast truncate failed, falling back to iterative deletes:', err.message);
    // Fallback: iterative loop deletion
    let deletedCount = 0;
    while (true) {
      console.log('Running iterative batch delete of 50,000 nodes...');
      const loopRes = await session.run(`
        MATCH (n) WITH n LIMIT 50000 DETACH DELETE n RETURN count(n) as count
      `);
      const count = loopRes.records[0].get('count').toNumber();
      deletedCount += count;
      console.log(`Deleted ${count} nodes in this iteration. Total: ${deletedCount}`);
      if (count === 0) break;
    }
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

truncate();
