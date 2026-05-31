export interface BrandDTO {
  id: string;
  name: string;
  productCount?: number;
}

export interface BrandCompetitorsDTO {
  matchedId: string;
  matchedName: string;
  competitors: BrandDTO[];
}
