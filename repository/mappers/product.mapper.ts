import { formatProperties } from '../../factory/response.factory';
import { ProductDTO, RelatedItemDTO, AutocompleteSuggestionDTO } from '../../models/dto/product.dto';

export class ProductMapper {
  static toDetailDTO(rec: any): ProductDTO {
    if (!rec) throw new Error('Cannot map empty record');
    return {
      id: rec.get('id'),
      name: rec.get('name') || 'Unknown Product',
      price: rec.get('price') ? parseFloat(rec.get('price')) : 0.0,
      gtin: rec.get('gtin') || 'N/A',
      size: rec.get('size') ? parseFloat(rec.get('size')) : null,
      measure: rec.get('measure') || '',
      validationState: rec.get('validationState') || 'VALID',
      brand: rec.get('brandId') ? { id: rec.get('brandId'), name: rec.get('brandName') } : null,
      category: rec.get('categoryId') ? { id: rec.get('categoryId'), name: rec.get('categoryName') } : null
    };
  }

  static toRelatedItemDTO(node: any, similarityVal?: number): RelatedItemDTO {
    const props = formatProperties(node.properties);
    const dto: RelatedItemDTO = {
      id: props.id || node.identity.toString(),
      name: props.name || 'Unknown Product',
      price: props.price ? parseFloat(props.price) : 0.0,
      gtin: props.gtin || 'N/A',
      size: props.size ? parseFloat(props.size) : null,
      measure: props.measure || ''
    };
    if (similarityVal != null) {
      // Convert to clean percentage scale (e.g. 0.9254 -> 92.5) and bound between 50% and 100%
      dto.matchScore = Math.min(100, Math.max(50, Math.round(similarityVal * 1000) / 10));
    }
    return dto;
  }

  static toAutocompleteSuggestionDTO(rec: any): AutocompleteSuggestionDTO {
    return {
      name: rec.get('name'),
      type: rec.get('type') || 'Unknown',
      id: rec.get('id')
    };
  }
}
