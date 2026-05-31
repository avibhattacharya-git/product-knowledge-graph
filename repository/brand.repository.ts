import { Driver } from 'neo4j-driver';
import { BrandDTO, BrandCompetitorsDTO } from '../models/dto/brand.dto';
import { BrandMapper } from './mappers/brand.mapper';

export class BrandRepository {
  constructor(private neoDriver: Driver) {}

  async fetchBrands(): Promise<BrandDTO[]> {
    const session = this.neoDriver.session();
    try {
      const cypher = `
        MATCH (b:Brand)<-[:MANUFACTURED_BY]-(p:Product)
        RETURN b.id as id, b.name as name, count(p) as productCount
        ORDER BY productCount DESC
        LIMIT 50
      `;
      const result = await session.run(cypher);
      return result.records.map(rec => BrandMapper.toDTO(rec));
    } finally {
      await session.close();
    }
  }

  async fetchBrandCompetitors(brandId: string): Promise<BrandDTO[]> {
    const session = this.neoDriver.session();
    try {
      const result = await session.run(`
        MATCH (b:Brand {id: $id})-[:COMPETES_WITH]-(comp:Brand)
        RETURN comp.id AS id, comp.name AS name
      `, { id: brandId });
      return result.records.map(rec => BrandMapper.toDTO(rec));
    } finally {
      await session.close();
    }
  }

  async searchBrandCompetitors(q: string): Promise<BrandCompetitorsDTO> {
    const term = q.trim();
    const session = this.neoDriver.session();
    try {
      // Find direct overlaps using COMPETES_WITH
      const result = await session.run(`
        MATCH (b:Brand)
        WHERE toLower(b.name) CONTAINS toLower($term)
        WITH b LIMIT 1
        MATCH (b)-[:COMPETES_WITH]-(comp:Brand)
        RETURN b.id AS matchedId, b.name AS matchedName, comp.id AS id, comp.name AS name
      `, { term });
      
      if (result.records.length === 0) {
        // Try to return just the matching brand if it exists but has no competitors
        const singleBrandRes = await session.run(`
          MATCH (b:Brand)
          WHERE toLower(b.name) CONTAINS toLower($term)
          RETURN b.id AS id, b.name AS name LIMIT 1
        `, { term });
        
        if (singleBrandRes.records.length === 0) {
          throw new Error('No matching brand found');
        }
        
        const b = singleBrandRes.records[0];
        return {
          matchedId: b.get('id'),
          matchedName: b.get('name'),
          competitors: []
        };
      }
      
      const matchedId = result.records[0].get('matchedId');
      const matchedName = result.records[0].get('matchedName');
      const competitors = result.records.map(rec => BrandMapper.toDTO(rec));
      
      return { matchedId, matchedName, competitors };
    } finally {
      await session.close();
    }
  }
}
