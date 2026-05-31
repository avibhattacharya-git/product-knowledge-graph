export interface ProductDTO {
  id: string;
  name: string;
  price: number;
  gtin: string;
  size: number | null;
  measure: string;
  validationState: string;
  brand?: {
    id: string;
    name: string;
  } | null;
  category?: {
    id: string;
    name: string;
  } | null;
}

export interface RelatedItemDTO {
  id: string;
  name: string;
  price: number;
  gtin: string;
  size: number | null;
  measure: string;
  matchScore?: number;
}

export interface RelatedProductsDTO {
  competitors: RelatedItemDTO[];
  complements: RelatedItemDTO[];
  siblings: RelatedItemDTO[];
}

export interface AutocompleteSuggestionDTO {
  name: string;
  type: string;
  id: string;
}
