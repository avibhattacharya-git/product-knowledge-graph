import { Context } from 'hono';
import { SearchOrchestrator } from '../../service/orchestrator/search.orchestrator';
import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';
import { appConfig } from '../../configs/app.config';
import { ChatService } from '../../service/chat.service';
import { RecommendationService } from '../../service/recommendation.service';

export class ApiController {
  private recommendationService: RecommendationService;

  constructor(
    private searchOrchestrator: SearchOrchestrator,
    private pgPool: Pool,
    private neoDriver: Driver,
    private chatService: ChatService
  ) {
    this.recommendationService = new RecommendationService(this.pgPool, this.neoDriver);
  }

  async getDbStatus(c: Context) {
    const provider = appConfig.llm.activeProvider;
    const activeApiKey = provider === 'openai' ? appConfig.openAiApiKey
      : provider === 'anthropic' ? appConfig.anthropicApiKey
      : appConfig.geminiApiKey;

    const status: any = {
      postgres: { connected: false, rowCounts: {} },
      neo4j: { connected: false, counts: {} },
      gemini: {
        apiKeyPresent: !!appConfig.geminiApiKey,
        ingestEnabled: appConfig.llm.ingestEnabled,
        nlqEnabled: appConfig.llm.nlqEnabled
      },
      llm: {
        activeProvider: provider,
        ingestEnabled: appConfig.llm.ingestEnabled,
        nlqEnabled: appConfig.llm.nlqEnabled,
        apiKeyPresent: !!activeApiKey,
        providers: {
          gemini: { nlqModel: appConfig.llm.gemini.nlqModel },
          openai: { nlqModel: appConfig.llm.openai.nlqModel },
          anthropic: { nlqModel: appConfig.llm.anthropic.nlqModel }
        }
      }
    };

    // Check PostgreSQL connection
    try {
      const pgClient = await this.pgPool.connect();
      status.postgres.connected = true;
      try {
        const tables = [
          'global_products_search_mv',
          'brands_search_mv',
          'product_categories_search_mv',
          'brand_category_map_mv'
        ];
        for (const t of tables) {
          const countRes = await pgClient.query(`SELECT COUNT(*) FROM ${t}`);
          status.postgres.rowCounts[t] = parseInt(countRes.rows[0].count, 10);
        }
      } finally {
        pgClient.release();
      }
    } catch (err: any) {
      status.postgres.error = err.message;
    }

    // Check Neo4j connection
    try {
      const session = this.neoDriver.session();
      try {
        await session.run('RETURN 1');
        status.neo4j.connected = true;

        const nodeCounts = await session.run('MATCH (n) RETURN labels(n)[0] as label, count(n) as count');
        nodeCounts.records.forEach(rec => {
          const label = rec.get('label') || 'Unlabeled';
          status.neo4j.counts[label] = rec.get('count').toInt();
        });

        const edgeCounts = await session.run('MATCH ()-[r]->() RETURN type(r) as type, count(r) as count');
        edgeCounts.records.forEach(rec => {
          status.neo4j.counts[rec.get('type')] = rec.get('count').toInt();
        });
      } finally {
        await session.close();
      }
    } catch (err: any) {
      status.neo4j.error = err.message;
    }

    return c.json(status);
  }

  async getGraph(c: Context) {
    try {
      const graph = await this.searchOrchestrator.getVisualGraph();
      return c.json(graph);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async executeQuery(c: Context) {
    try {
      const { query } = await c.req.json();
      if (!query) return c.json({ error: 'Query parameter is required' }, 400);

      const graph = await this.searchOrchestrator.executeCustomCypher(query);
      return c.json(graph);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  }

  async getCategories(c: Context) {
    try {
      const categories = await this.searchOrchestrator.getCategories();
      return c.json(categories);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async getRelatedProducts(c: Context) {
    const productId = c.req.param('id');
    if (!productId) return c.json({ error: 'Product ID parameter is required' }, 400);

    try {
      const recommendations = await this.searchOrchestrator.getRelatedProducts(productId);
      return c.json(recommendations);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async processNLQ(c: Context) {
    try {
      const { question, model } = await c.req.json();
      if (!question) return c.json({ error: 'Question parameter is required' }, 400);

      const result = await this.searchOrchestrator.processNLQ(question, model);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async processChat(c: Context) {
    try {
      const { message, history, model } = await c.req.json();
      if (!message) return c.json({ error: 'Message parameter is required' }, 400);

      const result = await this.chatService.processChatMessage(message, history, model);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async search(c: Context) {
    const q = c.req.query('q');
    if (!q) return c.json({ nodes: [], links: [] });

    try {
      const graph = await this.searchOrchestrator.globalKeywordSearch(q);
      return c.json(graph);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async autocomplete(c: Context) {
    const q = c.req.query('q');
    if (!q) return c.json([]);

    try {
      const suggestions = await this.searchOrchestrator.getAutocomplete(q);
      return c.json(suggestions);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async getBrands(c: Context) {
    try {
      const brands = await this.searchOrchestrator.getBrands();
      return c.json(brands);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async searchBrandCompetitors(c: Context) {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Query parameter q is required' }, 400);

    try {
      const result = await this.searchOrchestrator.searchBrandCompetitors(q);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async searchCategoryRelated(c: Context) {
    const q = c.req.query('q');
    if (!q) return c.json({ error: 'Query parameter q is required' }, 400);

    try {
      const result = await this.searchOrchestrator.searchCategoryRelated(q);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async getBrandCompetitors(c: Context) {
    const brandId = c.req.param('id');
    try {
      const competitors = await this.searchOrchestrator.getBrandCompetitors(brandId);
      return c.json(competitors);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async getCategoryRelated(c: Context) {
    const categoryId = c.req.param('id');
    try {
      const result = await this.searchOrchestrator.getCategoryRelated(categoryId);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async getProductDetail(c: Context) {
    const productId = c.req.param('id');
    try {
      const product = await this.searchOrchestrator.getProductDetail(productId);
      return c.json(product);
    } catch (err: any) {
      const status = err.message === 'Product not found' ? 404 : 500;
      return c.json({ error: err.message }, status);
    }
  }

  async getProductCategoryPath(c: Context) {
    const productId = c.req.param('id');
    try {
      const steps = await this.searchOrchestrator.getProductCategoryPath(productId);
      return c.json({ steps });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async getRecommendations(c: Context) {
    const limitQuery = c.req.query('limit');
    const limit = limitQuery ? parseInt(limitQuery, 10) : 10;
    try {
      const recommendations = await this.recommendationService.getRecommendations(limit);
      return c.json(recommendations);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async acceptRecommendations(c: Context) {
    try {
      const { pairs } = await c.req.json();
      if (!pairs || !Array.isArray(pairs)) {
        return c.json({ error: 'Body parameter "pairs" must be an array of approved recommendations.' }, 400);
      }
      const result = await this.recommendationService.acceptRecommendations(pairs);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async getBrandRecommendations(c: Context) {
    const limitQuery = c.req.query('limit');
    const limit = limitQuery ? parseInt(limitQuery, 10) : 10;
    try {
      const recommendations = await this.recommendationService.getBrandRecommendations(limit);
      return c.json(recommendations);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  async acceptBrandRecommendations(c: Context) {
    try {
      const { pairs } = await c.req.json();
      if (!pairs || !Array.isArray(pairs)) {
        return c.json({ error: 'Body parameter "pairs" must be an array of approved brand recommendations.' }, 400);
      }
      const result = await this.recommendationService.acceptBrandRecommendations(pairs);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }
}
