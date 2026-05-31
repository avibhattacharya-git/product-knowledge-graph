import { BrandRepository } from '../repository/brand.repository';
import { BrandDTO, BrandCompetitorsDTO } from '../models/dto/brand.dto';

export class BrandService {
  constructor(private brandRepo: BrandRepository) {}

  async getBrands(): Promise<BrandDTO[]> {
    return this.brandRepo.fetchBrands();
  }

  async getBrandCompetitors(brandId: string): Promise<BrandDTO[]> {
    return this.brandRepo.fetchBrandCompetitors(brandId);
  }

  async searchBrandCompetitors(q: string): Promise<BrandCompetitorsDTO> {
    return this.brandRepo.searchBrandCompetitors(q);
  }
}
