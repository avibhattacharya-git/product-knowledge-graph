import { GraphRepository } from '../repository/graph.repository';
import { GraphDTO } from '../models/dto/graph.dto';

export class GraphService {
  constructor(private graphRepo: GraphRepository) {}

  async getVisualGraph(): Promise<GraphDTO> {
    return this.graphRepo.fetchVisualGraph();
  }

  async executeCustomCypher(query: string): Promise<GraphDTO> {
    return this.graphRepo.executeCustomCypher(query);
  }

  async globalKeywordSearch(q: string): Promise<GraphDTO> {
    return this.graphRepo.globalKeywordSearch(q);
  }
}
