import { BrandDTO } from '../../models/dto/brand.dto';

export class BrandMapper {
  static toDTO(rec: any): BrandDTO {
    const productCountVal = rec.keys.includes('productCount') ? rec.get('productCount') : null;
    const dto: BrandDTO = {
      id: rec.get('id'),
      name: rec.get('name')
    };
    if (productCountVal !== null) {
      dto.productCount = typeof productCountVal.toInt === 'function' 
        ? productCountVal.toInt() 
        : parseInt(productCountVal, 10);
    }
    return dto;
  }
}
