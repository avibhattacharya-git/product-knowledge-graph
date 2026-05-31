export interface CategoryDTO {
  id: string;
  name: string;
  parentId?: string;
}

export interface RelatedCategoriesDTO {
  substitutes: CategoryDTO[];
  complements: CategoryDTO[];
}

export interface CategoryRelatedSearchResultDTO extends RelatedCategoriesDTO {
  matchedId: string;
  matchedName: string;
}
