import { EtlService, IngestionStats } from '../etl.service';

export interface IngestionOptions {
  truncate?: boolean;
  schema?: boolean;
  categories?: boolean;
  brands?: boolean;
  products?: boolean;
  relationships?: boolean;
}

interface StageTelemetry {
  name: string;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  metric: string;
  durationMs: number;
}

export class EtlOrchestrator {
  constructor(private etlService: EtlService) {}

  async runSelectivePipeline(options: IngestionOptions): Promise<IngestionStats> {
    const startTime = Date.now();
    console.log('\n======================================================');
    console.log('  STARTING MODULAR ORCHESTRATION PIPELINE RUN  ');
    console.log('======================================================');
    console.log('Options:', JSON.stringify(options, null, 2));

    let products = 0;
    let brands = 0;
    let manufacturers = 0;
    let categories = 0;
    let relationships = 0;

    const telemetry: StageTelemetry[] = [];

    // Helper to run a stage with telemetry tracking
    const executeStage = async (
      name: string,
      flag: boolean | undefined,
      fn: () => Promise<string>
    ): Promise<void> => {
      const stageStart = Date.now();
      if (!flag) {
        telemetry.push({
          name,
          status: 'SKIPPED',
          metric: 'N/A',
          durationMs: 0
        });
        return;
      }
      try {
        const metric = await fn();
        telemetry.push({
          name,
          status: 'SUCCESS',
          metric,
          durationMs: Date.now() - stageStart
        });
      } catch (err: any) {
        telemetry.push({
          name,
          status: 'FAILED',
          metric: err.message || 'Error',
          durationMs: Date.now() - stageStart
        });
        throw err;
      }
    };

    // Phase 1: Database Truncation
    await executeStage(
      'Stage A: Database Truncation',
      options.truncate,
      async () => {
        const res = await this.etlService.truncateDatabase();
        return `Deleted ${res.deletedNodes.toLocaleString()} nodes, ${res.deletedRels.toLocaleString()} rels`;
      }
    );

    // Phase 2: Schema & Constraints Setup
    await executeStage(
      'Stage A: Schema & Constraints',
      options.schema,
      async () => {
        await this.etlService.verifySchemaConstraints();
        return 'Verified 4 core unique constraints';
      }
    );

    // Phase 3: Categories Topology
    let parentLinksCount = 0;
    await executeStage(
      'Stage B: Category Topology',
      options.categories,
      async () => {
        const res = await this.etlService.ingestCategoryTopology();
        categories = res.categories;
        parentLinksCount = res.parentLinksCount;
        relationships += parentLinksCount;
        return `Loaded ${categories.toLocaleString()} nodes, ${parentLinksCount.toLocaleString()} parent edges`;
      }
    );

    // Phase 4: Category Relationships (Complements/Substitutes)
    const runCatRels = options.relationships || (options.categories && options.relationships !== false);
    await executeStage(
      'Stage B: Category Relationships',
      runCatRels,
      async () => {
        const res = await this.etlService.ingestCategoryRelationships();
        const count = res.complements * 2 + res.substitutes * 2;
        relationships += count;
        return `Mapped ${res.complements.toLocaleString()} complements, ${res.substitutes.toLocaleString()} substitutes`;
      }
    );

    // Phase 5: Brand Topology
    let ownedLinksCount = 0;
    await executeStage(
      'Stage C: Brand Topology',
      options.brands,
      async () => {
        const res = await this.etlService.ingestBrandTopology();
        brands = res.brands;
        manufacturers = res.manufacturers;
        ownedLinksCount = res.ownedLinksCount;
        relationships += ownedLinksCount;
        return `Loaded ${brands.toLocaleString()} brands, ${manufacturers.toLocaleString()} mfgs, ${ownedLinksCount.toLocaleString()} ownerships`;
      }
    );

    // Phase 6: Brand Relationships (Competitor Overlaps)
    const runBrandRels = options.relationships || (options.brands && options.relationships !== false);
    await executeStage(
      'Stage C: Brand Competitor Matches',
      runBrandRels,
      async () => {
        const res = await this.etlService.ingestBrandRelationships();
        const count = res.competitors * 2;
        relationships += count;
        return `Mapped ${res.competitors.toLocaleString()} competitor edges (bi-directional)`;
      }
    );

    // Phase 7: Product Catalog Streaming
    await executeStage(
      'Stage D: Product Catalog Stream',
      options.products,
      async () => {
        const res = await this.etlService.streamProductCatalog({ appendOnly: false });
        products = res.products;
        relationships += res.relationships;
        return `Streamed ${products.toLocaleString()} products, mapped ${res.relationships.toLocaleString()} edges`;
      }
    );

    const totalDurationSeconds = Math.round((Date.now() - startTime) / 1000);

    // Render a gorgeous, robust ASCII telemetry table
    console.log('\n+-------------------------------------+------------+------------------------------------------+--------------------+');
    console.log('| Ingestion Stage                     | Status     | Result Metric                            | Duration (Seconds) |');
    console.log('+-------------------------------------+------------+------------------------------------------+--------------------+');
    telemetry.forEach(t => {
      const nameCol = t.name.padEnd(35);
      const statusCol = t.status.padEnd(10);
      const metricCol = t.metric.padEnd(40).substring(0, 40);
      const durationCol = `${(t.durationMs / 1000).toFixed(2)}s`.padStart(18);
      console.log(`| ${nameCol} | ${statusCol} | ${metricCol} | ${durationCol} |`);
    });
    console.log('+-------------------------------------+------------+------------------------------------------+--------------------+');
    const totalLabelCol = 'TOTAL OVERALL PIPELINE TIME'.padEnd(35);
    const totalStatusCol = 'COMPLETE'.padEnd(10);
    const totalMetricCol = 'All stages executed successfully'.padEnd(40);
    const totalDurationCol = `${totalDurationSeconds}s`.padStart(18);
    console.log(`| ${totalLabelCol} | ${totalStatusCol} | ${totalMetricCol} | ${totalDurationCol} |`);
    console.log('+-------------------------------------+------------+------------------------------------------+--------------------+\n');

    return {
      products,
      brands,
      manufacturers,
      sources: 0,
      categories,
      relationships,
      durationSeconds: totalDurationSeconds
    };
  }

  async runIngestion(): Promise<IngestionStats> {
    console.log('[EtlOrchestrator] Starting database ETL pipeline ingestion flow...');
    return this.etlService.runPipeline();
  }
}
