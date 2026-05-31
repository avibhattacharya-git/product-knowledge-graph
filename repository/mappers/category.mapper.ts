import { CategoryDTO } from '../../models/dto/category.dto';

export class CategoryMapper {
  static toDTO(rec: any): CategoryDTO {
    return {
      id: rec.get('id'),
      name: rec.get('name'),
      parentId: rec.keys.includes('parentId') ? (rec.get('parentId') || undefined) : undefined
    };
  }
}
