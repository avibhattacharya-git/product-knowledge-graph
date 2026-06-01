import 'dotenv/config';

export interface AppConfig {
  port: number;
  geminiApiKey: string | null;
  openAiApiKey: string | null;
  anthropicApiKey: string | null;
  llm: {
    activeProvider: 'gemini' | 'openai' | 'anthropic';
    ingestEnabled: boolean;
    nlqEnabled: boolean;
    gemini: {
      ingestModel: string;
      nlqModel: string;
    };
    openai: {
      ingestModel: string;
      nlqModel: string;
    };
    anthropic: {
      ingestModel: string;
      nlqModel: string;
    };
  };
  pgViews: {
    products: string;
    brands: string;
    categories: string;
    brandCategory: string;
  };
}

export const appConfig: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  geminiApiKey: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here' 
    ? process.env.GEMINI_API_KEY 
    : null,
  openAiApiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-mockkeyforanthropicintegrationtest1234567890',
  llm: {
    activeProvider: (process.env.LLM_PROVIDER as 'gemini' | 'openai' | 'anthropic') || 'anthropic',
    ingestEnabled: false, // Disabled (using pre-warmed PostgreSQL cache in air-gapped mode)
    nlqEnabled: true,    // Enabled to run dynamic NLQ translations
    gemini: {
      ingestModel: process.env.GEMINI_INGEST_MODEL || 'gemini-3.5-flash',
      nlqModel: process.env.GEMINI_NLQ_MODEL || 'gemini-3.5-flash'
    },
    openai: {
      ingestModel: process.env.OPENAI_INGEST_MODEL || 'gpt-4o-mini',
      nlqModel: process.env.OPENAI_NLQ_MODEL || 'gpt-5.5'
    },
    anthropic: {
      ingestModel: process.env.ANTHROPIC_INGEST_MODEL || 'claude-haiku-4-5-20251001',
      nlqModel: process.env.ANTHROPIC_NLQ_MODEL || 'claude-opus-4-8'
    }
  },
  pgViews: {
    products: process.env.PG_VIEW_PRODUCTS || 'global_products_search_mv',
    brands: process.env.PG_VIEW_BRANDS || 'brands_search_mv',
    categories: process.env.PG_VIEW_CATEGORIES || 'product_categories_search_mv',
    brandCategory: process.env.PG_VIEW_BRAND_CATEGORY || 'brand_category_map_mv',
  }
};

