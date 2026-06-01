export interface GraphNodeDTO {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

export interface GraphLinkDTO {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, any>;
  sourceName?: string;
  sourceType?: string;
  targetName?: string;
  targetType?: string;
}

export interface GraphDTO {
  nodes: GraphNodeDTO[];
  links: GraphLinkDTO[];
}

export interface NLQResultDTO extends GraphDTO {
  translatedCypher: string;
  explanation: string;
  isFallback: boolean;
}
