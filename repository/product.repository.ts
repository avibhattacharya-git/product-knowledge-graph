import { Pool } from 'pg';
import { Driver, Session } from 'neo4j-driver';
import { ProductDTO, RelatedProductsDTO, AutocompleteSuggestionDTO } from '../models/dto/product.dto';
import { ProductMapper } from './mappers/product.mapper';

export class ProductRepository {
  constructor(
    private pgPool: Pool,
    private neoDriver: Driver
  ) {}

  async fetchDetail(productId: string): Promise<ProductDTO> {
    const session = this.neoDriver.session();
    try {
      const result = await session.run(`
        MATCH (p:Product {id: $id})
        OPTIONAL MATCH (p)-[:MANUFACTURED_BY]->(b:Brand)
        OPTIONAL MATCH (p)-[:BELONGS_TO]->(cat:Category)
        RETURN p.id AS id, p.name AS name, p.price AS price, p.gtin AS gtin, p.size AS size, p.measure AS measure, p.validationState AS validationState,
               b.id AS brandId, b.name AS brandName,
               cat.id AS categoryId, cat.name AS categoryName
      `, { id: productId });
      
      if (result.records.length === 0) {
        throw new Error('Product not found');
      }
      return ProductMapper.toDetailDTO(result.records[0]);
    } finally {
      await session.close();
    }
  }

  async fetchCategoryPath(productId: string): Promise<any[]> {
    const session = this.neoDriver.session();
    try {
      const result = await session.run(`
        MATCH (p:Product {id: $id})-[:BELONGS_TO]->(c:Category)
        OPTIONAL MATCH path = (c)-[:PARENT_CATEGORY*0..]->(parent:Category)
        WITH path ORDER BY length(path) DESC LIMIT 1
        RETURN [node IN nodes(path) | { id: node.id, name: node.name, level: node.level }] AS steps
      `, { id: productId });
      
      if (result.records.length === 0) {
        return [];
      }
      const steps = result.records[0].get('steps') || [];
      return steps.reverse();
    } finally {
      await session.close();
    }
  }

  async fetchRelated(productId: string): Promise<RelatedProductsDTO> {
    const session = this.neoDriver.session();
    try {
      const cypher = `
        MATCH (p1:Product {id: $id})
        
        // A. Rivals (Same Category or Linked Substitute Categories, Competing Brands)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)
        OPTIONAL MATCH (c1)-[:SUBSTITUTE_CATEGORY]-(c2:Category)
        WITH p1, c1, collect(DISTINCT c2) + c1 AS allowedRivalCategories
        
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b1:Brand)-[compEdge:COMPETES_WITH]-(b2:Brand)
        WITH p1, allowedRivalCategories, collect(DISTINCT b2) AS allowedBrands, collect({ id: b2.id, similarity: compEdge.similarity }) AS brandSimilarities
        
        // Match rivals starting from allowed competing brands (which is very small!)
        UNWIND allowedBrands AS rivalBrand
        OPTIONAL MATCH (rival:Product)-[:MANUFACTURED_BY]->(rivalBrand)
        OPTIONAL MATCH (rival)-[:BELONGS_TO]->(rc:Category)
        WHERE rc IN allowedRivalCategories AND rival <> p1
        
        // Find the similarity for this rival's brand
        WITH p1, rival, [item IN brandSimilarities WHERE item.id = rivalBrand.id][0] AS compInfo
        WITH p1, collect({ node: rival, similarity: compInfo.similarity })[..15] AS competitors
        
        // B. Companion Accessories (Same Brand, Complementary Categories via Parent Departments)
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})-[compToEdge:COMPLEMENTARY_TO]-(dept2:Category {level: 2})
        OPTIONAL MATCH (c2:Category)-[:PARENT_CATEGORY*0..2]->(dept2)
        WITH competitors, p1, b, collect(DISTINCT { catId: c2.id, similarity: compToEdge.similarity }) AS allowedCategorySimilarities
        
        // Traversal starting from the brand "b" (which is just 1 node!) to find accessories
        OPTIONAL MATCH (comp:Product)-[:MANUFACTURED_BY]->(b)
        WHERE comp <> p1
        OPTIONAL MATCH (comp)-[:BELONGS_TO]->(cComp:Category)
        
        // Filter collected brand items in memory
        WITH competitors, p1,
             [item IN collect({ node: comp, catId: cComp.id }) 
              WHERE [x IN allowedCategorySimilarities WHERE x.catId = item.catId][0] IS NOT NULL] AS filteredComplements,
             allowedCategorySimilarities
             
        WITH competitors, p1,
             [item IN filteredComplements | 
              { node: item.node, similarity: [x IN allowedCategorySimilarities WHERE x.catId = item.catId][0].similarity }][..15] AS complements
        
        // C. Packaging/Flavor Siblings (Same Brand, Same Category)
        OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b:Brand)
        OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c:Category)
        OPTIONAL MATCH (sib:Product)-[:BELONGS_TO]->(c)
        WHERE (sib)-[:MANUFACTURED_BY]->(b) AND sib <> p1
        WITH competitors, complements, collect(DISTINCT sib)[..15] AS siblings
        
        RETURN competitors, complements, siblings
      `;
      
      const result = await session.run(cypher, { id: productId });
      
      if (result.records.length === 0) {
        return { competitors: [], complements: [], siblings: [] };
      }

      const rec = result.records[0];
      const rawCompetitors = rec.get('competitors') || [];
      const rawComplements = rec.get('complements') || [];
      const rawSiblings = rec.get('siblings') || [];

      return {
        competitors: rawCompetitors.map((item: any) => ProductMapper.toRelatedItemDTO(item.node, item.similarity)),
        complements: rawComplements.map((item: any) => ProductMapper.toRelatedItemDTO(item.node, item.similarity)),
        siblings: rawSiblings.map((item: any) => ProductMapper.toRelatedItemDTO(item))
      };
    } finally {
      await session.close();
    }
  }

  async autocomplete(q: string): Promise<AutocompleteSuggestionDTO[]> {
    const term = q.trim();
    if (term.length < 2) return [];

    const session = this.neoDriver.session();
    try {
      const cypher = `
        MATCH (n:Brand) WHERE toLower(n.name) CONTAINS toLower($term) RETURN n.name AS name, "Brand" AS type, n.id AS id LIMIT 8
        UNION
        MATCH (n:Category) WHERE toLower(n.name) CONTAINS toLower($term) RETURN n.name AS name, "Category" AS type, n.id AS id LIMIT 8
        UNION
        MATCH (n:Product) WHERE toLower(n.name) CONTAINS toLower($term) RETURN n.name AS name, "Product" AS type, n.id AS id LIMIT 8
      `;
      const result = await session.run(cypher, { term });
      return result.records.map(rec => ProductMapper.toAutocompleteSuggestionDTO(rec));
    } finally {
      await session.close();
    }
  }
}
