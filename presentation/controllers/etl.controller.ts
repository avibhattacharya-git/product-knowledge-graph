import { Context } from 'hono';
import { EtlOrchestrator } from '../../service/orchestrator/etl.orchestrator';

export class EtlController {
  constructor(private etlOrchestrator: EtlOrchestrator) {}

  async ingest(c: Context) {
    try {
      console.log('Triggering high-throughput database ETL pipeline via Presentation Route...');
      const stats = await this.etlOrchestrator.runIngestion();
      return c.json({ success: true, stats });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }
}
