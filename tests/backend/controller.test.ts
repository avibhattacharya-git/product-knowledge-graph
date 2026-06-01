import { describe, test, expect, mock } from 'bun:test';
import { Hono } from 'hono';
import { ApiController } from '../../presentation/controllers/api.controller';
import { EtlController } from '../../presentation/controllers/etl.controller';
import { createApiRouter } from '../../presentation/routes/api.routes';
import { ChatService } from '../../service/chat.service';

describe('US Retailer Product Knowledge Graph - Hono Route & Controller Unit Tests', () => {

  // A helper to initialize standard test routers with mocked dependencies
  const setupTestApp = (customOrchestratorMocks: any = {}, customEtlMocks: any = {}) => {
    const mockSearchOrchestrator = {
      getVisualGraph: mock(() => Promise.resolve({ nodes: [], links: [] })),
      executeCustomCypher: mock(() => Promise.resolve({ nodes: [], links: [] })),
      getCategories: mock(() => Promise.resolve([{ uuid: 'c1', name: 'Soda' }])),
      getRelatedProducts: mock(() => Promise.resolve({ substitutes: [], complements: [] })),
      processNLQ: mock(() => Promise.resolve({ cypher: 'MATCH (n) RETURN n', explanation: 'Mocked translation', results: [] })),
      globalKeywordSearch: mock(() => Promise.resolve({ nodes: [], links: [] })),
      getAutocomplete: mock(() => Promise.resolve([{ value: 'Coca-Cola', label: 'Coca-Cola Cans' }])),
      getBrands: mock(() => Promise.resolve([{ uuid: 'b1', name: 'PepsiCo' }])),
      getBrandCompetitors: mock(() => Promise.resolve([])),
      getCategoryRelated: mock(() => Promise.resolve({ substitutes: [], complements: [] })),
      getProductDetail: mock((id: string) => {
        if (id === 'non-existent') throw new Error('Product not found');
        if (id === 'error-case') throw new Error('Database connection failed');
        return Promise.resolve({
          uuid: id,
          name: 'Coca-Cola Cherry Cans, 7.5 fl oz, 4 Pack',
          brand: 'Coca-Cola',
          price: 4.99,
          categories: ['Organic Soft Drinks']
        });
      }),
      getProductCategoryPath: mock(() => Promise.resolve([{ name: 'Beverage' }, { name: 'Soda' }])),
      searchBrandCompetitors: mock(() => Promise.resolve({ brand: { name: 'Coca-Cola' }, competitors: [] })),
      searchCategoryRelated: mock(() => Promise.resolve({ category: { name: 'Soda' }, substitutes: [], complements: [] })),
      ...customOrchestratorMocks
    } as any;

    const mockPgPool = {
      connect: mock(() => {
        return Promise.resolve({
          query: mock((sql: string) => {
            if (sql.includes('COUNT(*)')) {
              return Promise.resolve({ rows: [{ count: '42' }] });
            }
            return Promise.resolve({ rows: [] });
          }),
          release: mock(() => {})
        });
      })
    } as any;

    const mockNeoSession = {
      run: mock((cypher: string) => {
        if (cypher.includes('labels(n)[0]')) {
          return Promise.resolve({
            records: [
              { get: (k: string) => k === 'label' ? 'Brand' : { toInt: () => 150 } }
            ]
          });
        }
        if (cypher.includes('type(r)')) {
          return Promise.resolve({
            records: [
              { get: (k: string) => k === 'type' ? 'COMPETES_WITH' : { toInt: () => 450 } }
            ]
          });
        }
        return Promise.resolve({ records: [] });
      }),
      close: mock(() => Promise.resolve())
    } as any;

    const mockNeoDriver = {
      session: mock(() => mockNeoSession)
    } as any;

    const mockEtlOrchestrator = {
      runIngestion: mock(() => Promise.resolve({ brandsSynced: 100, relationshipsSynced: 200 })),
      ...customEtlMocks
    } as any;

    const mockChatService = {
      processChatMessage: mock(() => Promise.resolve({ action: 'reply', reply: 'Mocked reply' }))
    } as any;

    const apiController = new ApiController(mockSearchOrchestrator, mockPgPool, mockNeoDriver, mockChatService);
    const etlController = new EtlController(mockEtlOrchestrator);
    const apiRouter = createApiRouter(apiController, etlController);

    const app = new Hono();
    app.route('/api', apiRouter);

    return { app, mockSearchOrchestrator, mockEtlOrchestrator, mockPgPool, mockNeoDriver, mockNeoSession };
  };

  test('GET /api/db-status returns database connectivity counts', async () => {
    const { app, mockPgPool, mockNeoDriver } = setupTestApp();

    const res = await app.request('/api/db-status');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.postgres.connected).toBe(true);
    expect(body.postgres.rowCounts['brands_search_mv']).toBe(42);
    expect(body.neo4j.connected).toBe(true);
    expect(body.neo4j.counts['Brand']).toBe(150);
    expect(body.neo4j.counts['COMPETES_WITH']).toBe(450);

    expect(mockPgPool.connect).toHaveBeenCalledTimes(1);
    expect(mockNeoDriver.session).toHaveBeenCalledTimes(1);
  });

  test('GET /api/products/:id returns detailed product metadata', async () => {
    const { app, mockSearchOrchestrator } = setupTestApp();

    // 1. Success case
    const resSuccess = await app.request('/api/products/7565dd59-cd98-5a01-98b8-9b7a73efb87c');
    expect(resSuccess.status).toBe(200);
    const bodySuccess = await resSuccess.json();
    expect(bodySuccess.name).toContain('Coca-Cola Cherry Cans');
    expect(mockSearchOrchestrator.getProductDetail).toHaveBeenLastCalledWith('7565dd59-cd98-5a01-98b8-9b7a73efb87c');

    // 2. 404 Case
    const resNotFound = await app.request('/api/products/non-existent');
    expect(resNotFound.status).toBe(404);
    const bodyNotFound = await resNotFound.json();
    expect(bodyNotFound.error).toBe('Product not found');

    // 3. 500 Case
    const resError = await app.request('/api/products/error-case');
    expect(resError.status).toBe(500);
    const bodyError = await resError.json();
    expect(bodyError.error).toBe('Database connection failed');
  });

  test('GET /api/autocomplete handles queries correctly', async () => {
    const { app, mockSearchOrchestrator } = setupTestApp();

    // 1. Query present
    const resQuery = await app.request('/api/autocomplete?q=coke');
    expect(resQuery.status).toBe(200);
    const suggestions = await resQuery.json();
    expect(suggestions[0].value).toBe('Coca-Cola');
    expect(mockSearchOrchestrator.getAutocomplete).toHaveBeenCalledWith('coke');

    // 2. Empty query returns empty array
    const resEmpty = await app.request('/api/autocomplete');
    expect(resEmpty.status).toBe(200);
    const suggestionsEmpty = await resEmpty.json();
    expect(suggestionsEmpty).toEqual([]);
  });

  test('POST /api/query accepts valid Cypher query payloads', async () => {
    const { app, mockSearchOrchestrator } = setupTestApp();

    const res = await app.request('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'MATCH (n) RETURN n LIMIT 10' })
    });

    expect(res.status).toBe(200);
    expect(mockSearchOrchestrator.executeCustomCypher).toHaveBeenCalledWith('MATCH (n) RETURN n LIMIT 10');
  });

  test('POST /api/nlq validates input parameter presence', async () => {
    const { app, mockSearchOrchestrator } = setupTestApp();

    // 1. Bad request missing 'question'
    const resBad = await app.request('/api/nlq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(resBad.status).toBe(400);

    // 2. Success case
    const resGood = await app.request('/api/nlq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'List all sodas' })
    });
    expect(resGood.status).toBe(200);
    expect(mockSearchOrchestrator.processNLQ).toHaveBeenCalledWith('List all sodas', undefined);
  });

  test('POST /api/ingest executes high-performance ETL pipeline', async () => {
    const { app, mockEtlOrchestrator } = setupTestApp();

    const res = await app.request('/api/ingest', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.stats.brandsSynced).toBe(100);
    expect(mockEtlOrchestrator.runIngestion).toHaveBeenCalledTimes(1);
  });

  test('POST /api/chat validates input parameter presence and processes prompt', async () => {
    const { app } = setupTestApp();

    // 1. Missing message parameter
    const resBad = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(resBad.status).toBe(400);

    // 2. Success case
    const resGood = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Recommend chips' })
    });
    expect(resGood.status).toBe(200);
    const body = await resGood.json();
    expect(body.action).toBe('reply');
    expect(body.reply).toBe('Mocked reply');
  });
});
