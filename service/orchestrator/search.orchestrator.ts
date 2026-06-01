import { ProductService } from '../product.service';
import { BrandService } from '../brand.service';
import { CategoryService } from '../category.service';
import { GraphService } from '../graph.service';
import { NlqService } from '../nlq.service';
import { GraphDTO, NLQResultDTO } from '../../models/dto/graph.dto';
import { ProductDTO, RelatedProductsDTO, AutocompleteSuggestionDTO } from '../../models/dto/product.dto';
import { BrandDTO, BrandCompetitorsDTO } from '../../models/dto/brand.dto';
import { CategoryDTO, RelatedCategoriesDTO, CategoryRelatedSearchResultDTO } from '../../models/dto/category.dto';

export class SearchOrchestrator {
  constructor(
    private productService: ProductService,
    private brandService: BrandService,
    private categoryService: CategoryService,
    private graphService: GraphService,
    private nlqService: NlqService
  ) {}

  async getVisualGraph(): Promise<GraphDTO> {
    return this.graphService.getVisualGraph();
  }

  async executeCustomCypher(query: string): Promise<GraphDTO> {
    return this.graphService.executeCustomCypher(query);
  }

  async globalKeywordSearch(q: string): Promise<GraphDTO> {
    return this.graphService.globalKeywordSearch(q);
  }

  async processNLQ(question: string, overrideModel?: string): Promise<NLQResultDTO> {
    return this.nlqService.processNLQQuery(question, overrideModel);
  }

  async getAutocomplete(q: string): Promise<AutocompleteSuggestionDTO[]> {
    return this.productService.autocompleteSearch(q);
  }

  async getProductDetail(id: string): Promise<ProductDTO> {
    return this.productService.getProductDetail(id);
  }

  async getProductCategoryPath(id: string): Promise<any[]> {
    return this.productService.getProductCategoryPath(id);
  }

  async getRelatedProducts(id: string): Promise<RelatedProductsDTO> {
    return this.productService.getRelatedProducts(id);
  }

  async getBrands(): Promise<BrandDTO[]> {
    return this.brandService.getBrands();
  }

  async getBrandCompetitors(brandId: string): Promise<BrandDTO[]> {
    return this.brandService.getBrandCompetitors(brandId);
  }

  async searchBrandCompetitors(q: string): Promise<BrandCompetitorsDTO> {
    return this.brandService.searchBrandCompetitors(q);
  }

  async getCategories(): Promise<CategoryDTO[]> {
    return this.categoryService.getCategories();
  }

  async getCategoryRelated(categoryId: string): Promise<RelatedCategoriesDTO> {
    return this.categoryService.getCategoryRelated(categoryId);
  }

  async searchCategoryRelated(q: string): Promise<CategoryRelatedSearchResultDTO> {
    return this.categoryService.searchCategoryRelated(q);
  }
}
