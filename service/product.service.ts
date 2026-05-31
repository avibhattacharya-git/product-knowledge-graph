import { ProductRepository } from '../repository/product.repository';
import { ProductDTO, RelatedProductsDTO, AutocompleteSuggestionDTO } from '../models/dto/product.dto';

export class ProductService {
  constructor(private productRepo: ProductRepository) {}

  async getProductDetail(id: string): Promise<ProductDTO> {
    return this.productRepo.fetchDetail(id);
  }

  async getProductCategoryPath(id: string): Promise<any[]> {
    return this.productRepo.fetchCategoryPath(id);
  }

  async getRelatedProducts(id: string): Promise<RelatedProductsDTO> {
    return this.productRepo.fetchRelated(id);
  }

  async autocompleteSearch(q: string): Promise<AutocompleteSuggestionDTO[]> {
    return this.productRepo.autocomplete(q);
  }
}
