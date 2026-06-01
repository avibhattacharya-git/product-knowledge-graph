import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { appConfig } from './configs/app.config';
import { pgPool, neoDriver, shutdownDatabases } from './factory/database.factory';

// Repositories
import { ProductRepository } from './repository/product.repository';
import { BrandRepository } from './repository/brand.repository';
import { CategoryRepository } from './repository/category.repository';
import { GraphRepository } from './repository/graph.repository';

// Services
import { LlmService } from './service/llm.service';
import { EtlService } from './service/etl.service';
import { ProductService } from './service/product.service';
import { BrandService } from './service/brand.service';
import { CategoryService } from './service/category.service';
import { GraphService } from './service/graph.service';
import { NlqService } from './service/nlq.service';
import { ChatService } from './service/chat.service';

// Orchestrators
import { EtlOrchestrator } from './service/orchestrator/etl.orchestrator';
import { SearchOrchestrator } from './service/orchestrator/search.orchestrator';

// Controllers
import { ApiController } from './presentation/controllers/api.controller';
import { EtlController } from './presentation/controllers/etl.controller';

// Routes
import { createApiRouter } from './presentation/routes/api.routes';

// Instantiate DI singleton container bottom-up
const llmService = new LlmService();
const productRepo = new ProductRepository(pgPool, neoDriver);
const brandRepo = new BrandRepository(neoDriver);
const categoryRepo = new CategoryRepository(pgPool, neoDriver);
const graphRepo = new GraphRepository(neoDriver);

const etlService = new EtlService(pgPool, neoDriver, llmService);
const productService = new ProductService(productRepo);
const brandService = new BrandService(brandRepo);
const categoryService = new CategoryService(categoryRepo);
const graphService = new GraphService(graphRepo);
const nlqService = new NlqService(graphRepo, llmService);
const chatService = new ChatService(nlqService, llmService);

const etlOrchestrator = new EtlOrchestrator(etlService);
const searchOrchestrator = new SearchOrchestrator(
  productService,
  brandService,
  categoryService,
  graphService,
  nlqService
);

const apiController = new ApiController(searchOrchestrator, pgPool, neoDriver, chatService);
const etlController = new EtlController(etlOrchestrator);

const apiRouter = createApiRouter(apiController, etlController);

// Initialize Hono Router
const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Mount the decoupled presentation API router
app.route('/api', apiRouter);

// Serve static visual client assets from the ux/public directory
app.use('/*', serveStatic({ root: './ux/public' }));

// Graceful application shutdown handler
const shutdown = async () => {
  console.log('\nShutting down Hono API server gracefully...');
  try {
    await shutdownDatabases();
  } catch (err) {
    console.error('Error during database pool cleanup:', err);
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`\n======================================================`);
console.log(`  Hono API Server listening on port ${appConfig.port}`);
console.log(`======================================================\n`);

// Start server natively on Bun by exporting app configurations
export default {
  port: appConfig.port,
  fetch: app.fetch
};

