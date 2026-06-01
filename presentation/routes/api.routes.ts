import { Hono } from 'hono';
import { ApiController } from '../controllers/api.controller';
import { EtlController } from '../controllers/etl.controller';

export function createApiRouter(
  apiController: ApiController,
  etlController: EtlController
): Hono {
  const apiRouter = new Hono();

  // 1. GET /api/db-status - Database connectivity and views stats counts
  apiRouter.get('/db-status', (c) => apiController.getDbStatus(c));

  // 2. GET /api/graph - Fetch active visual graph for D3 canvas
  apiRouter.get('/graph', (c) => apiController.getGraph(c));

  // 3. POST /api/query - Custom Cypher terminal execution
  apiRouter.post('/query', (c) => apiController.executeQuery(c));

  // 4. GET /api/categories - Expandable taxonomy category lists
  apiRouter.get('/categories', (c) => apiController.getCategories(c));

  // 5. POST /api/ingest - Trigger High-Performance ETL Ingest
  apiRouter.post('/ingest', (c) => etlController.ingest(c));

  // 6. GET /api/products/:id/related - Traversal recommendations
  apiRouter.get('/products/:id/related', (c) => apiController.getRelatedProducts(c));

  // 7. POST /api/nlq - Gemini AI Search Text-to-Cypher Translator
  apiRouter.post('/nlq', (c) => apiController.processNLQ(c));

  // 8. GET /api/search - Global keyword search across Neo4j Product, Brand, or Category
  apiRouter.get('/search', (c) => apiController.search(c));

  // 9. GET /api/autocomplete - Fast typeahead lookup for search suggestions
  apiRouter.get('/autocomplete', (c) => apiController.autocomplete(c));

  // 10. GET /api/brands - Fetch top 50 active brands with count of products
  apiRouter.get('/brands', (c) => apiController.getBrands(c));

  // 11. GET /api/brands/competitors - Search competitors by brand name
  apiRouter.get('/brands/competitors', (c) => apiController.searchBrandCompetitors(c));

  // 12. GET /api/categories/related - Search substitutes and complements by category name
  apiRouter.get('/categories/related', (c) => apiController.searchCategoryRelated(c));

  // 13. GET /api/brands/:id/competitors - Fetch direct competitors for any brand
  apiRouter.get('/brands/:id/competitors', (c) => apiController.getBrandCompetitors(c));

  // 14. GET /api/categories/:id/related - Fetch both substitute and complementary categories
  apiRouter.get('/categories/:id/related', (c) => apiController.getCategoryRelated(c));

  // 15. GET /api/products/:id - Fetch single product detailed properties
  apiRouter.get('/products/:id', (c) => apiController.getProductDetail(c));

  // 16. GET /api/products/:id/path - Fetch hierarchical parent category tree breadcrumbs
  apiRouter.get('/products/:id/path', (c) => apiController.getProductCategoryPath(c));

  // 17. POST /api/chat - Interactive AI Copilot Chat Route
  apiRouter.post('/chat', (c) => apiController.processChat(c));

  // 18. GET /api/recommendations - Missing relationship recommendation engine
  apiRouter.get('/recommendations', (c) => apiController.getRecommendations(c));

  // 19. POST /api/recommendations/accept - Dual-write approved relationship selections
  apiRouter.post('/recommendations/accept', (c) => apiController.acceptRecommendations(c));

  // 20. GET /api/recommendations/brands - Brand competitor recommendation engine
  apiRouter.get('/recommendations/brands', (c) => apiController.getBrandRecommendations(c));

  // 21. POST /api/recommendations/brands/accept - Dual-write approved brand competitor selections
  apiRouter.post('/recommendations/brands/accept', (c) => apiController.acceptBrandRecommendations(c));

  return apiRouter;
}
