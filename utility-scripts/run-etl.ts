import { pgPool, neoDriver, shutdownDatabases } from '../factory/database.factory';
import { runPipeline } from '../service/etl.service';

console.log('Initiating database ingestion pipeline from Command Line Interface...');

runPipeline(pgPool, neoDriver)
  .then(async (stats) => {
    console.log('\n======================================================');
    console.log('  INGESTION PIPELINE RUN FINISHED SUCCESSFULLY!');
    console.log('======================================================');
    console.log('Stats:', JSON.stringify(stats, null, 2));
    await shutdownDatabases();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n[CRITICAL ERROR DURING PIPELINE EXECUTION]:', err);
    try {
      await shutdownDatabases();
    } catch (e) {
      // ignore
    }
    process.exit(1);
  });
