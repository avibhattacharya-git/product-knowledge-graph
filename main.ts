import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { Pool } from 'pg';
import neo4j from 'neo4j-driver';
import {
  handleDbStatus,
  handleGraphData,
  handleCustomCypher,
  handleCategories,
  handleIngestTrigger,
  handleRelatedProducts,
  handleNLQQuery,
  handleSearch,
  handleAutocomplete,
  handleBrands,
  handleBrandCompetitors,
  handleCategoryRelated,
  handleProductDetail,
  handleProductCategoryPath,
  handleBrandCompetitorsSearch,
  handleCategoryRelatedSearch
} from './handlers';

// Initialize Hono Router
const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Initialize PostgreSQL Pool
export const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
  max: 20, // Max connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Initialize Neo4j Driver
export const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  ),
  {
    maxConnectionPoolSize: 100, // Large connection pool for concurrent batch transactions
    connectionTimeout: 10000,
  }
);

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

app.get('/api/db-status', handleDbStatus);
app.get('/api/graph', handleGraphData);
app.post('/api/query', handleCustomCypher);
app.get('/api/categories', handleCategories);
app.post('/api/ingest', handleIngestTrigger);
app.get('/api/products/:id/related', handleRelatedProducts);
app.post('/api/nlq', handleNLQQuery);
app.get('/api/search', handleSearch);
app.get('/api/autocomplete', handleAutocomplete);
app.get('/api/brands', handleBrands);
app.get('/api/brands/competitors', handleBrandCompetitorsSearch);
app.get('/api/categories/related', handleCategoryRelatedSearch);
app.get('/api/brands/:id/competitors', handleBrandCompetitors);
app.get('/api/categories/:id/related', handleCategoryRelated);
app.get('/api/products/:id', handleProductDetail);
app.get('/api/products/:id/path', handleProductCategoryPath);

// Serve static frontend assets from public/ directory using Node serveStatic
app.use('/*', serveStatic({ root: './public' }));

// Graceful database shutdown handler
const shutdown = async () => {
  console.log('\nShutting down Hono API server...');
  try {
    await pgPool.end();
    console.log('PostgreSQL connection pool closed.');
    await neoDriver.close();
    console.log('Neo4j driver connection closed.');
  } catch (err) {
    console.error('Error during database pools teardown:', err);
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`\n======================================================`);
console.log(`  Hono API Server listening on port ${process.env.PORT || 3000}`);
console.log(`======================================================\n`);

// Start server natively on Bun by exporting app configurations
export default {
  port: parseInt(process.env.PORT || '3000'),
  fetch: app.fetch
};
