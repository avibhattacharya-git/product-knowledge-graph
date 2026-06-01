import { pgPool, neoDriver, shutdownDatabases } from '../factory/database.factory';
import { EtlService } from '../service/etl.service';
import { LlmService } from '../service/llm.service';
import { EtlOrchestrator, IngestionOptions } from '../service/orchestrator/etl.orchestrator';

console.log('Initiating database ingestion pipeline from Command Line Interface...');

const args = process.argv.slice(2);
const options: IngestionOptions = {};
let runAll = true;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--stage' || arg === '-s') {
    runAll = false;
    const stage = args[i + 1];
    if (!stage) {
      console.error('Error: Missing value for --stage argument.');
      process.exit(1);
    }
    const normalizedStage = stage.toLowerCase().trim();
    if (normalizedStage === 'schema') {
      options.schema = true;
    } else if (normalizedStage === 'relationships') {
      options.relationships = true;
    } else if (normalizedStage === 'products') {
      options.products = true;
    } else if (normalizedStage === 'categories') {
      options.categories = true;
    } else if (normalizedStage === 'brands') {
      options.brands = true;
    } else if (normalizedStage === 'truncate') {
      options.truncate = true;
    } else {
      console.error(`Error: Unknown stage '${stage}'. Valid stages are: truncate, schema, categories, brands, relationships, products.`);
      process.exit(1);
    }
    i++;
  } else if (arg === '--only' || arg === '-o') {
    runAll = false;
    const stagesStr = args[i + 1];
    if (!stagesStr) {
      console.error('Error: Missing list of stages for --only argument.');
      process.exit(1);
    }
    const stages = stagesStr.split(',').map(s => s.trim().toLowerCase());
    stages.forEach(stage => {
      if (stage === 'schema') options.schema = true;
      else if (stage === 'relationships') options.relationships = true;
      else if (stage === 'products') options.products = true;
      else if (stage === 'categories') options.categories = true;
      else if (stage === 'brands') options.brands = true;
      else if (stage === 'truncate') options.truncate = true;
      else {
        console.error(`Error: Unknown stage '${stage}' in --only list. Valid stages are: truncate, schema, categories, brands, relationships, products.`);
        process.exit(1);
      }
    });
    i++;
  } else {
    console.warn(`Warning: Unrecognized argument '${arg}' was ignored.`);
  }
}

if (runAll) {
  options.truncate = true;
  options.schema = true;
  options.categories = true;
  options.brands = true;
  options.products = true;
  options.relationships = true;
}

const llmService = new LlmService();
const etlService = new EtlService(pgPool, neoDriver, llmService);
const orchestrator = new EtlOrchestrator(etlService);

orchestrator.runSelectivePipeline(options)
  .then(async (stats) => {
    console.log('======================================================');
    console.log('  INGESTION PIPELINE RUN FINISHED SUCCESSFULLY!');
    console.log('======================================================');
    console.log('Final Stats Summary:', JSON.stringify(stats, null, 2));
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
