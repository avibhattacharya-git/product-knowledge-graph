import { Driver } from 'neo4j-driver';
import { GraphDTO, NLQResultDTO } from '../models/dto/graph.dto';
import { GraphMapper } from './mappers/graph.mapper';

export class GraphRepository {
  constructor(private neoDriver: Driver) {}

  async fetchVisualGraph(): Promise<GraphDTO> {
    const session = this.neoDriver.session();
    try {
      const cypher = `
        CALL {
          MATCH (p:Product) RETURN p AS n LIMIT 150
          UNION
          MATCH (b:Brand) RETURN b AS n LIMIT 80
          UNION
          MATCH (c:Category) RETURN c AS n LIMIT 50
        }
        OPTIONAL MATCH (n)-[r]->(m)
        RETURN n, r, m LIMIT 800
      `;
      const result = await session.run(cypher);
      return GraphMapper.toDTO(result);
    } finally {
      await session.close();
    }
  }

  async executeCustomCypher(query: string): Promise<GraphDTO> {
    const session = this.neoDriver.session();
    try {
      console.log(`Executing Cypher Terminal Query: ${query}`);
      const result = await session.run(query);
      return GraphMapper.toDTO(result);
    } finally {
      await session.close();
    }
  }

  async globalKeywordSearch(q: string): Promise<GraphDTO> {
    const term = q.trim();
    const session = this.neoDriver.session();
    try {
      console.log(`Executing Global DB Keyword Search for: "${term}"`);
      const cypher = `
        MATCH (n)
        WHERE toLower(n.name) CONTAINS toLower($term)
           OR (n:Product AND toLower(n.gtin) CONTAINS toLower($term))
        OPTIONAL MATCH (n)-[r]-(m)
        RETURN n, r, m LIMIT 150
      `;
      const result = await session.run(cypher, { term });
      return GraphMapper.toDTO(result);
    } finally {
      await session.close();
    }
  }

  async runRawCypher(query: string, parameters?: Record<string, any>): Promise<any> {
    const session = this.neoDriver.session();
    try {
      return await session.run(query, parameters);
    } finally {
      await session.close();
    }
  }
}
