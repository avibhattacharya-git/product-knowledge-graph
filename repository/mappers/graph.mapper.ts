import { formatNeoResult } from '../../factory/response.factory';
import { GraphDTO, NLQResultDTO } from '../../models/dto/graph.dto';

export class GraphMapper {
  static toDTO(result: any): GraphDTO {
    const parsed = formatNeoResult(result);
    return {
      nodes: parsed.nodes,
      links: parsed.links
    };
  }

  static toNLQResultDTO(result: any, cypher: string, explanation: string, isFallback: boolean): NLQResultDTO {
    const parsed = formatNeoResult(result);
    return {
      nodes: parsed.nodes,
      links: parsed.links,
      translatedCypher: cypher,
      explanation: explanation,
      isFallback: isFallback
    };
  }
}
