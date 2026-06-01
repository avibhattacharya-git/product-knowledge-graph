import { describe, test, expect, mock } from 'bun:test';
import { Hono } from 'hono';
import { ApiController } from '../../presentation/controllers/api.controller';
import { EtlController } from '../../presentation/controllers/etl.controller';
import { createApiRouter } from '../../presentation/routes/api.routes';
import { RecommendationService } from '../../service/recommendation.service';

describe('Category Relationship Recommendation Engine - Service & Endpoint Tests', () => {

  const setupMockedApp = () => {
    // 1. Mock PostgreSQL Client & Pool
    const mockPgClient = {
      query: mock((sql: string, params?: any[]) => {
        if (sql.includes('candidate_pairs')) {
          return Promise.resolve({
            rows: [
              {
                s_id: '101',
                s_name: 'Pancake Mix',
                s_parent: 'department_baking',
                t_id: '202',
                t_name: 'Maple Syrup',
                t_parent: 'department_dairy',
                distance: '0.15'
              },
              {
                s_id: '303',
                s_name: 'Organic Milk',
                s_parent: 'department_dairy',
                t_id: '404',
                t_name: 'Whole Milk',
                t_parent: 'department_dairy',
                distance: '0.05'
              }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: mock(() => {})
    };

    const mockPgPool = {
      connect: mock(() => Promise.resolve(mockPgClient))
    } as any;

    // 2. Mock Neo4j Session & Driver
    const mockNeoSession = {
      run: mock(() => Promise.resolve({ records: [] })),
      close: mock(() => Promise.resolve())
    };

    const mockNeoDriver = {
      session: mock(() => mockNeoSession)
    } as any;

    // 3. Mock other dependencies
    const mockSearchOrchestrator = {} as any;
    const mockChatService = {} as any;
    const mockEtlOrchestrator = {} as any;

    // 4. Initialize ApiController (internal instantiation of RecommendationService uses mocked pools)
    const apiController = new ApiController(mockSearchOrchestrator, mockPgPool, mockNeoDriver, mockChatService);
    const etlController = new EtlController(mockEtlOrchestrator);

    const apiRouter = createApiRouter(apiController, etlController);
    const app = new Hono();
    app.route('/api', apiRouter);

    return { app, mockPgPool, mockPgClient, mockNeoDriver, mockNeoSession };
  };

  test('RecommendationService.getRecommendations formats and classifies pairs accurately', async () => {
    const { mockPgPool, mockPgClient, mockNeoDriver } = setupMockedApp();
    const service = new RecommendationService(mockPgPool, mockNeoDriver);

    const recommendations = await service.getRecommendations(5);
    
    expect(recommendations.length).toBe(2);
    
    // Check complement pair (different parents)
    const complement = recommendations[0];
    expect(complement.sourceId).toBe('101');
    expect(complement.sourceName).toBe('Pancake Mix');
    expect(complement.targetId).toBe('202');
    expect(complement.targetName).toBe('Maple Syrup');
    expect(complement.relationshipType).toBe('COMPLEMENT');
    expect(complement.neo4jType).toBe('COMPLEMENTARY_TO');
    expect(complement.similarity).toBe(0.85); // 1 - 0.15
    expect(complement.rationale).toContain('cross-shopping opportunities');

    // Check substitute pair (same parents)
    const substitute = recommendations[1];
    expect(substitute.sourceId).toBe('303');
    expect(substitute.sourceName).toBe('Organic Milk');
    expect(substitute.targetId).toBe('404');
    expect(substitute.targetName).toBe('Whole Milk');
    expect(substitute.relationshipType).toBe('SUBSTITUTE');
    expect(substitute.neo4jType).toBe('SUBSTITUTE_CATEGORY');
    expect(substitute.similarity).toBe(0.95); // 1 - 0.05
    expect(substitute.rationale).toContain('highly interchangeable substitute choices');
  });

  test('RecommendationService.acceptRecommendations inserts into cache and merges in Neo4j', async () => {
    const { mockPgPool, mockPgClient, mockNeoDriver, mockNeoSession } = setupMockedApp();
    const service = new RecommendationService(mockPgPool, mockNeoDriver);

    const approvedPairs: any[] = [
      { sourceId: '101', targetId: '202', relationshipType: 'COMPLEMENT', similarity: 0.85 }
    ];

    const result = await service.acceptRecommendations(approvedPairs);
    expect(result.acceptedCount).toBe(1);

    // Postgres cache query checks
    expect(mockPgClient.query).toHaveBeenCalled();
    const sqlCall = (mockPgClient.query as any).mock.calls[0][0];
    const paramsCall = (mockPgClient.query as any).mock.calls[0][1];
    expect(sqlCall).toContain('INSERT INTO category_relationships_cache');
    expect(paramsCall).toEqual(['101', '202', 'COMPLEMENT']); // sorted c1 < c2 check

    // Neo4j session merge checks
    expect(mockNeoSession.run).toHaveBeenCalled();
    const cypherCall = (mockNeoSession.run as any).mock.calls[0][0];
    const cypherParams = (mockNeoSession.run as any).mock.calls[0][1];
    expect(cypherCall).toContain('MERGE (c1)-[r1:COMPLEMENTARY_TO]->(c2)');
    expect(cypherParams).toEqual({ c1: '101', c2: '202', sim: 0.85 });
  });

  test('GET /api/recommendations handles requests and retrieves recommendations successfully', async () => {
    const { app } = setupMockedApp();

    const res = await app.request('/api/recommendations?limit=5', {
      method: 'GET'
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(2);
    expect(body[0].sourceName).toBe('Pancake Mix');
  });

  test('POST /api/recommendations/accept accepts selections and returns sync statistics', async () => {
    const { app } = setupMockedApp();

    const res = await app.request('/api/recommendations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: [
          { sourceId: '101', targetId: '202', relationshipType: 'COMPLEMENT', similarity: 0.85 },
          { sourceId: '303', targetId: '404', relationshipType: 'SUBSTITUTE', similarity: 0.95 }
        ]
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acceptedCount).toBe(2);
  });

  test('POST /api/recommendations/accept rejects missing or invalid inputs', async () => {
    const { app } = setupMockedApp();

    const resBad = await app.request('/api/recommendations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(resBad.status).toBe(400);
    const bodyBad = await resBad.json();
    expect(bodyBad.error).toContain('must be an array');
  });
});
