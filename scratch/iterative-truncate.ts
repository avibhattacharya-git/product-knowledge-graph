import neo4j from 'neo4j-driver';
import 'dotenv/config';

const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  )
);

async function iterativeDelete() {
  const session = neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
  console.log('Initiating high-speed iterative batch truncate (Failsafe DBA Strategy)...');
  const startTime = Date.now();
  let deletedRelationships = 0;
  let deletedNodes = 0;
  
  try {
    // Phase 1: Batch delete all relationships
    console.log('\n--- PHASE 1: Deleting all Relationships in batches of 50,000 ---');
    while (true) {
      const loopStart = Date.now();
      const loopRes = await session.run(`
        MATCH ()-[r]->() WITH r LIMIT 50000 DELETE r RETURN count(r) as count
      `);
      const count = loopRes.records[0].get('count').toNumber();
      deletedRelationships += count;
      const duration = Date.now() - loopStart;
      console.log(`Deleted ${count.toLocaleString()} relationships in ${duration}ms. (Total Relationships Deleted: ${deletedRelationships.toLocaleString()})`);
      if (count === 0) break;
    }
    
    // Phase 2: Batch delete all nodes (now extremely fast since there are zero relationships left!)
    console.log('\n--- PHASE 2: Deleting all Nodes in batches of 50,000 ---');
    while (true) {
      const loopStart = Date.now();
      const loopRes = await session.run(`
        MATCH (n) WITH n LIMIT 50000 DELETE n RETURN count(n) as count
      `);
      const count = loopRes.records[0].get('count').toNumber();
      deletedNodes += count;
      const duration = Date.now() - loopStart;
      console.log(`Deleted ${count.toLocaleString()} nodes in ${duration}ms. (Total Nodes Deleted: ${deletedNodes.toLocaleString()})`);
      if (count === 0) break;
    }
    
    console.log('\n======================================================');
    console.log(`  TRUNCATION COMPLETED SUCCESSFULLY!`);
    console.log(`  Total deleted relationships: ${deletedRelationships.toLocaleString()}`);
    console.log(`  Total deleted nodes: ${deletedNodes.toLocaleString()}`);
    console.log(`  Total duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
    console.log('======================================================\n');
    
  } catch (err: any) {
    console.error('Iterative deletion failed:', err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

iterativeDelete();
