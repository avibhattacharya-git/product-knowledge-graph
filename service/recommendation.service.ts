import { Pool } from 'pg';
import { Driver } from 'neo4j-driver';

export interface CategoryRecommendation {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  relationshipType: 'COMPLEMENT' | 'SUBSTITUTE';
  neo4jType: 'COMPLEMENTARY_TO' | 'SUBSTITUTE_CATEGORY';
  similarity: number;
  rationale: string;
}

export interface ApprovedRecommendation {
  sourceId: string;
  targetId: string;
  relationshipType: 'COMPLEMENT' | 'SUBSTITUTE';
  similarity: number;
}

export class RecommendationService {
  constructor(
    private pgPool: Pool,
    private neoDriver: Driver
  ) {}

  /**
   * Scans PostgreSQL for missing Level 2 category pairs using pgvector similarity search,
   * classifying them as complements or substitutes based on taxonomy hierarchy.
   */
  async getRecommendations(limit: number = 10): Promise<CategoryRecommendation[]> {
    const pgClient = await this.pgPool.connect();
    try {
      const sql = `
        WITH lvl2_categories AS (
          SELECT id, name, parent_category_id, embedding
          FROM product_categories_search_mv
          WHERE embedding IS NOT NULL AND category_level = '2'
        ),
        candidate_pairs AS (
          SELECT DISTINCT ON (c1.id, c2.id)
            c1.id AS s_id,
            c1.name AS s_name,
            c1.parent_category_id AS s_parent,
            c2.id AS t_id,
            c2.name AS t_name,
            c2.parent_category_id AS t_parent,
            (c1.embedding <=> c2.embedding) AS distance
          FROM lvl2_categories c1
          CROSS JOIN LATERAL (
            SELECT id, name, parent_category_id, embedding
            FROM lvl2_categories c2
            WHERE c2.id <> c1.id
              AND (c1.embedding <=> c2.embedding) < 0.18
            ORDER BY c1.embedding <=> c2.embedding ASC
            LIMIT 5
          ) c2
        )
        SELECT s_id, s_name, s_parent, t_id, t_name, t_parent, distance
        FROM candidate_pairs p
        WHERE NOT EXISTS (
          SELECT 1 FROM category_relationships_cache cache
          WHERE (cache.category1_id = p.s_id AND cache.category2_id = p.t_id)
             OR (cache.category1_id = p.t_id AND cache.category2_id = p.s_id)
        )
        ORDER BY distance ASC
        LIMIT $1;
      `;

      const res = await pgClient.query(sql, [limit]);
      
      return res.rows.map(row => {
        const isSameParent = row.s_parent && row.t_parent && String(row.s_parent) === String(row.t_parent);
        const relationshipType = isSameParent ? 'SUBSTITUTE' : 'COMPLEMENT';
        const neo4jType = isSameParent ? 'SUBSTITUTE_CATEGORY' : 'COMPLEMENTARY_TO';
        const similarity = Math.round((1 - parseFloat(row.distance)) * 100) / 100;
        
        const rationale = isSameParent
          ? `These categories represent highly interchangeable substitute choices residing within the same parent department aisle ("${row.s_name}" ↔ "${row.t_name}").`
          : `Products in these categories represent strong companion cross-shopping opportunities across contiguous departments ("${row.s_name}" ↔ "${row.t_name}").`;

        return {
          sourceId: String(row.s_id),
          sourceName: String(row.s_name),
          targetId: String(row.t_id),
          targetName: String(row.t_name),
          relationshipType,
          neo4jType,
          similarity,
          rationale
        };
      });
    } finally {
      pgClient.release();
    }
  }

  /**
   * Persistently inserts approved category relationship recommendations into the PostgreSQL cache
   * and merges their corresponding bidirectional edges inside Neo4j in real-time.
   */
  async acceptRecommendations(pairs: ApprovedRecommendation[]): Promise<{ acceptedCount: number }> {
    if (pairs.length === 0) {
      return { acceptedCount: 0 };
    }

    const pgClient = await this.pgPool.connect();
    const session = this.neoDriver.session();

    try {
      let acceptedCount = 0;

      for (const pair of pairs) {
        const { sourceId, targetId, relationshipType, similarity } = pair;
        
        // Purity check: Sort IDs to guarantee consistent cache lookup
        const c1 = sourceId < targetId ? sourceId : targetId;
        const c2 = sourceId < targetId ? targetId : sourceId;

        // A. Persistent Cache Write
        await pgClient.query(
          `INSERT INTO category_relationships_cache (category1_id, category2_id, relationship_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (category1_id, category2_id) DO UPDATE SET relationship_type = $3`,
          [c1, c2, relationshipType]
        );

        // B. Neo4j Graph Write
        const neo4jType = relationshipType === 'COMPLEMENT' ? 'COMPLEMENTARY_TO' : 'SUBSTITUTE_CATEGORY';
        await session.run(`
          MATCH (c1:Category {id: $c1})
          MATCH (c2:Category {id: $c2})
          MERGE (c1)-[r1:${neo4jType}]->(c2)
          SET r1.similarity = toFloat($sim)
          MERGE (c2)-[r2:${neo4jType}]->(c1)
          SET r2.similarity = toFloat($sim)
        `, { c1: sourceId, c2: targetId, sim: similarity });

        acceptedCount++;
      }

      return { acceptedCount };
    } finally {
      pgClient.release();
      await session.close();
    }
  }
}
