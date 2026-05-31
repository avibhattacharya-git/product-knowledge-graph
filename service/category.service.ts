import { CategoryRepository } from '../repository/category.repository';
import { CategoryDTO, RelatedCategoriesDTO, CategoryRelatedSearchResultDTO } from '../models/dto/category.dto';

export class CategoryService {
  constructor(private categoryRepo: CategoryRepository) {}

  async getCategories(): Promise<CategoryDTO[]> {
    return this.categoryRepo.fetchCategories();
  }

  async getCategoryRelated(categoryId: string): Promise<RelatedCategoriesDTO> {
    return this.categoryRepo.fetchCategoryRelated(categoryId);
  }

  async searchCategoryRelated(q: string): Promise<CategoryRelatedSearchResultDTO> {
    return this.categoryRepo.searchCategoryRelated(q);
  }
}
