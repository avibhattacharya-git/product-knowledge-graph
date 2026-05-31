import 'dotenv/config';

export interface AppConfig {
  port: number;
  geminiApiKey: string | null;
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
  pgViews: {
    products: process.env.PG_VIEW_PRODUCTS || 'global_products_search_mv',
    brands: process.env.PG_VIEW_BRANDS || 'brands_search_mv',
    categories: process.env.PG_VIEW_CATEGORIES || 'product_categories_search_mv',
    brandCategory: process.env.PG_VIEW_BRAND_CATEGORY || 'brand_category_map_mv',
  }
};
