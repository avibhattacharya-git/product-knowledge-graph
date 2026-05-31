import { EtlService, IngestionStats } from '../etl.service';

export class EtlOrchestrator {
  constructor(private etlService: EtlService) {}

  async runIngestion(): Promise<IngestionStats> {
    console.log('[EtlOrchestrator] Starting database ETL pipeline ingestion flow...');
    return this.etlService.runPipeline();
  }
}
