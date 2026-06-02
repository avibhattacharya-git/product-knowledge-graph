import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';
import { CategoryDTO, RelatedCategoriesDTO, CategoryRelatedSearchResultDTO } from '../models/dto/category.dto';
import { CategoryMapper } from './mappers/category.mapper';

export class CategoryRepository {
  constructor(
    private pgPool: Pool,
    private neoDriver: Driver
  ) {}

  async fetchCategories(): Promise<CategoryDTO[]> {
    const session = this.neoDriver.session();
    try {
      const result = await session.run(`
        MATCH (c:Category)
        OPTIONAL MATCH (c)-[:PARENT_CATEGORY]->(p:Category)
        RETURN c.id AS id, c.name AS name, p.id AS parentId
      `);
      return result.records.map(rec => CategoryMapper.toDTO(rec));
    } finally {
      await session.close();
    }
  }

  async fetchCategoryRelated(categoryId: string): Promise<RelatedCategoriesDTO> {
    const session = this.neoDriver.session();
    try {
      const subResult = await session.run(`
        MATCH (c:Category {id: $id})-[:SUBSTITUTE_CATEGORY]-(sub:Category)
        RETURN DISTINCT sub.id AS id, sub.name AS name
      `, { id: categoryId });
      
      const compResult = await session.run(`
        MATCH (c:Category {id: $id})-[:COMPLEMENTARY_TO]-(comp:Category)
        RETURN DISTINCT comp.id AS id, comp.name AS name
      `, { id: categoryId });
      
      const substitutes = subResult.records.map(rec => CategoryMapper.toDTO(rec));
      const complements = compResult.records.map(rec => CategoryMapper.toDTO(rec));
      
      return { substitutes, complements };
    } finally {
      await session.close();
    }
  }

  async searchCategoryRelated(q: string): Promise<CategoryRelatedSearchResultDTO> {
    const term = q.trim();
    const session = this.neoDriver.session();
    try {
      // Find matching category
      const catRes = await session.run(`
        MATCH (c:Category)
        WHERE toLower(c.name) CONTAINS toLower($term)
        RETURN c.id AS id, c.name AS name LIMIT 1
      `, { term });
      
      if (catRes.records.length === 0) {
        throw new Error('No matching category found');
      }
      
      const matchedId = catRes.records[0].get('id');
      const matchedName = catRes.records[0].get('name');
      
      const { substitutes, complements } = await this.fetchCategoryRelated(matchedId);
      
      return { matchedId, matchedName, substitutes, complements };
    } finally {
      await session.close();
    }
  }
}
