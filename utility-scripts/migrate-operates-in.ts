import { neoDriver, shutdownDatabases } from '../factory/database.factory';
import neo4j from 'neo4j-driver';

async function runMigration() {
  console.log('================================================================');
  console.log('  STARTING IN-PLACE MIGRATION: BRAND-TO-CATEGORY (OPERATES_IN)  ');
  console.log('================================================================\n');

  console.log('Connecting to active Neo4j database instance...');
  const session = neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
  const startTime = Date.now();

  try {
    console.log('Executing pre-aggregated Cypher traversal mapping...');
    const cypher = `
      MATCH (b:Brand)<-[:MANUFACTURED_BY]-(p:Product)-[:BELONGS_TO]->(c:Category)
      WITH b, c, count(p) AS count
      MERGE (b)-[r:OPERATES_IN]->(c)
      SET r.productCount = count
      RETURN count(r) AS createdCount
    `;

    const result = await session.run(cypher);
    const count = result.records[0].get('createdCount').toNumber();
    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n================================================================');
    console.log(`  MIGRATION FINISHED SUCCESSFULLY in ${duration}s!`);
    console.log(`  Materialized ${count.toLocaleString()} (:Brand)-[:OPERATES_IN]->(:Category) links.`);
    console.log('================================================================\n');

  } catch (err: any) {
    console.error('\n[FATAL MIGRATION ERROR]:', err.message);
    throw err;
  } finally {
    await session.close();
  }
}

runMigration()
  .then(async () => {
    await shutdownDatabases();
    process.exit(0);
  })
  .catch(async (err) => {
    try {
      await shutdownDatabases();
    } catch (e) {
      // ignore
    }
    process.exit(1);
  });
