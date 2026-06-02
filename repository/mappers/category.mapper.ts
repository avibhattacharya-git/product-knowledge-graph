import { CategoryDTO } from '../../models/dto/category.dto';

export class CategoryMapper {
  static toDTO(rec: any): CategoryDTO {
    const parentIdVal = rec.keys.includes('parentId') ? rec.get('parentId') : null;
    return {
      id: String(rec.get('id')),
      name: rec.get('name'),
      parentId: parentIdVal != null ? String(parentIdVal) : undefined
    };
  }
}
