import { describe, test, expect, mock } from 'bun:test';

// 1. Mock LlmService before importing ApiController/RecommendationService to guarantee complete isolation!
mock.module('../../service/llm.service', () => {
  return {
    LlmService: class {
      generateContent = mock((prompt: string) => {
        if (prompt.includes('brand competitor')) {
          return Promise.resolve(JSON.stringify({
            validated: [
              {
                brand1Id: 'brand_louisiana',
                brand2Id: 'brand_mccormick',
                similarity: 0.90,
                rationale: 'Mocked brand competitor rationale between Louisiana Fish Fry and McCormick.'
              }
            ]
          }));
        }
        return Promise.resolve(JSON.stringify({
          validated: [
            {
              sourceId: '303',
              targetId: '404',
              relationshipType: 'SUBSTITUTE',
              similarity: 0.95,
              rationale: 'Mocked substitute rationale between Organic Milk and Whole Milk.'
            },
            {
              sourceId: '101',
              targetId: '202',
              relationshipType: 'COMPLEMENT',
              similarity: 0.85,
              rationale: 'Mocked complement rationale between Pancake Mix and Maple Syrup.'
            }
          ]
        }));
      })
    }
  };
});

import { Hono } from 'hono';
import { ApiController } from '../../presentation/controllers/api.controller';
import { EtlController } from '../../presentation/controllers/etl.controller';
import { createApiRouter } from '../../presentation/routes/api.routes';
import { RecommendationService } from '../../service/recommendation.service';

describe('Category & Brand Competitor Recommendation Engine - Pure Graph Tests', () => {

  const createMockRecord = (data: Record<string, any>) => {
    return {
      get: (key: string) => {
        const val = data[key];
        if (val !== undefined && val !== null && typeof val === 'number') {
          return {
            toInt: () => val,
            toNumber: () => val
          };
        }
        return val;
      }
    };
  };

  const setupMockedApp = () => {
    const mockPgPool = {
      connect: mock(() => Promise.resolve({ release: () => {} }))
    } as any;

    const mockNeoSession = {
      run: mock((cypher: string, params?: any) => {
        if (cypher.includes('PARENT_CATEGORY') && cypher.includes('SUBSTITUTE')) {
          return Promise.resolve({
            records: [
              createMockRecord({
                sourceId: '303',
                sourceName: 'Organic Milk',
                targetId: '404',
                targetName: 'Whole Milk',
                relationshipType: 'SUBSTITUTE',
                neo4jType: 'SUBSTITUTE_CATEGORY',
                similarity: 0.95,
                aisleName: 'department_dairy'
              })
            ]
          });
        } else if (cypher.includes('PARENT_CATEGORY') && cypher.includes('COMPLEMENT')) {
          return Promise.resolve({
            records: [
              createMockRecord({
                sourceId: '101',
                sourceName: 'Pancake Mix',
                targetId: '202',
                targetName: 'Maple Syrup',
                relationshipType: 'COMPLEMENT',
                neo4jType: 'COMPLEMENTARY_TO',
                similarity: 0.85,
                dept1: 'department_baking',
                dept2: 'department_dairy'
              })
            ]
          });
        } else if (cypher.includes('MANUFACTURED_BY') && cypher.includes('COMPETES_WITH')) {
          return Promise.resolve({
            records: [
              createMockRecord({
                brand1_id: 'brand_louisiana',
                brand1_name: 'Louisiana Fish Fry',
                brand2_id: 'brand_mccormick',
                brand2_name: 'McCormick',
                sharedCategories: [{ categoryName: 'Spices' }],
                sharedCount: 1,
                totalVolume: 50,
                similarity: 0.90
              })
            ]
          });
        }
        return Promise.resolve({ records: [] });
      }),
      close: mock(() => Promise.resolve())
    };

    const mockNeoDriver = {
      session: mock(() => mockNeoSession)
    } as any;

    const mockSearchOrchestrator = {} as any;
    const mockChatService = {} as any;
    const mockEtlOrchestrator = {} as any;

    const apiController = new ApiController(mockSearchOrchestrator, mockPgPool, mockNeoDriver, mockChatService);
    const etlController = new EtlController(mockEtlOrchestrator);

    const apiRouter = createApiRouter(apiController, etlController);
    const app = new Hono();
    app.route('/api', apiRouter);

    return { app, mockPgPool, mockNeoDriver, mockNeoSession };
  };

  test('RecommendationService.getRecommendations formats and classifies category pairs accurately', async () => {
    const { mockPgPool, mockNeoDriver } = setupMockedApp();
    const service = new RecommendationService(mockPgPool, mockNeoDriver);

    const recommendations = await service.getRecommendations(5);
    
    expect(recommendations.length).toBe(2);
    
    // Check substitute pair (Dairy department)
    const substitute = recommendations[0];
    expect(substitute.sourceId).toBe('303');
    expect(substitute.sourceName).toBe('Organic Milk');
    expect(substitute.targetId).toBe('404');
    expect(substitute.targetName).toBe('Whole Milk');
    expect(substitute.relationshipType).toBe('SUBSTITUTE');
    expect(substitute.neo4jType).toBe('SUBSTITUTE_CATEGORY');
    expect(substitute.similarity).toBe(0.95);
    expect(substitute.rationale).toContain('Organic Milk');

    // Check complement pair (Baking ↔ Dairy)
    const complement = recommendations[1];
    expect(complement.sourceId).toBe('101');
    expect(complement.sourceName).toBe('Pancake Mix');
    expect(complement.targetId).toBe('202');
    expect(complement.targetName).toBe('Maple Syrup');
    expect(complement.relationshipType).toBe('COMPLEMENT');
    expect(complement.neo4jType).toBe('COMPLEMENTARY_TO');
    expect(complement.similarity).toBe(0.85);
  });

  test('RecommendationService.acceptRecommendations merges graph relationship edges in Neo4j', async () => {
    const { mockPgPool, mockNeoDriver, mockNeoSession } = setupMockedApp();
    const service = new RecommendationService(mockPgPool, mockNeoDriver);

    const approvedPairs: any[] = [
      { sourceId: '101', targetId: '202', relationshipType: 'COMPLEMENT', similarity: 0.85 }
    ];

    const result = await service.acceptRecommendations(approvedPairs);
    expect(result.acceptedCount).toBe(1);

    // Neo4j session merge checks
    expect(mockNeoSession.run).toHaveBeenCalled();
    const cypherCall = (mockNeoSession.run as any).mock.calls[0][0];
    const cypherParams = (mockNeoSession.run as any).mock.calls[0][1];
    expect(cypherCall).toContain('MERGE (c1)-[r1:COMPLEMENTARY_TO]->(c2)');
    expect(cypherParams).toEqual({ c1: '101', c2: '202', sim: 0.85 });
  });

  test('RecommendationService.getBrandRecommendations retrieves brand rivals accurately', async () => {
    const { mockPgPool, mockNeoDriver } = setupMockedApp();
    const service = new RecommendationService(mockPgPool, mockNeoDriver);

    const brandRecs = await service.getBrandRecommendations(5);
    
    expect(brandRecs.length).toBe(1);
    const rival = brandRecs[0];
    expect(rival.brand1Id).toBe('brand_louisiana');
    expect(rival.brand1Name).toBe('Louisiana Fish Fry');
    expect(rival.brand2Id).toBe('brand_mccormick');
    expect(rival.brand2Name).toBe('McCormick');
    expect(rival.sharedCount).toBe(1);
    expect(rival.similarity).toBe(0.90);
    expect(rival.rationale).toContain('Louisiana Fish Fry');
  });

  test('RecommendationService.acceptBrandRecommendations merges brand competitor edges in Neo4j', async () => {
    const { mockPgPool, mockNeoDriver, mockNeoSession } = setupMockedApp();
    const service = new RecommendationService(mockPgPool, mockNeoDriver);

    const approvedPairs: any[] = [
      { brand1Id: 'brand_louisiana', brand2Id: 'brand_mccormick', similarity: 0.90 }
    ];

    const result = await service.acceptBrandRecommendations(approvedPairs);
    expect(result.acceptedCount).toBe(1);

    // Neo4j session merge checks
    expect(mockNeoSession.run).toHaveBeenCalled();
    const cypherCall = (mockNeoSession.run as any).mock.calls[0][0];
    const cypherParams = (mockNeoSession.run as any).mock.calls[0][1];
    expect(cypherCall).toContain('MERGE (b1)-[r1:COMPETES_WITH]->(b2)');
    expect(cypherParams).toEqual({ b1: 'brand_louisiana', b2: 'brand_mccormick', sim: 0.90 });
  });

  test('GET /api/recommendations handles requests and retrieves recommendations successfully', async () => {
    const { app } = setupMockedApp();

    const res = await app.request('/api/recommendations?limit=5', {
      method: 'GET'
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(2);
    expect(body[0].sourceName).toBe('Organic Milk');
  });

  test('GET /api/recommendations/brands handles requests successfully', async () => {
    const { app } = setupMockedApp();

    const res = await app.request('/api/recommendations/brands?limit=5', {
      method: 'GET'
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].brand1Name).toBe('Louisiana Fish Fry');
  });

  test('POST /api/recommendations/accept accepts selections and returns statistics', async () => {
    const { app } = setupMockedApp();

    const res = await app.request('/api/recommendations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: [
          { sourceId: '101', targetId: '202', relationshipType: 'COMPLEMENT', similarity: 0.85 }
        ]
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acceptedCount).toBe(1);
  });

  test('POST /api/recommendations/brands/accept accepts selections successfully', async () => {
    const { app } = setupMockedApp();

    const res = await app.request('/api/recommendations/brands/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: [
          { brand1Id: 'brand_louisiana', brand2Id: 'brand_mccormick', similarity: 0.90 }
        ]
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acceptedCount).toBe(1);
  });

  test('POST /api/recommendations/accept rejects invalid inputs', async () => {
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
