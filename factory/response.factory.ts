import neo4j from 'neo4j-driver';

export interface VisualNode {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

export interface VisualLink {
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

export interface VisualGraph {
  nodes: VisualNode[];
  links: VisualLink[];
}

export function formatNeoResult(result: any): VisualGraph {
  const nodesMap = new Map<string, VisualNode>();
  const linksMap = new Map<string, VisualLink>();

  result.records.forEach((record: any) => {
    record.keys.forEach((key: string) => {
      const value = record.get(key);
      if (!value) return;

      const elements = Array.isArray(value) ? value : [value];

      elements.forEach(elem => {
        if (isNeoNode(elem)) {
          const id = elem.identity.toString();
          if (!nodesMap.has(id)) {
            nodesMap.set(id, {
              id,
              labels: elem.labels,
              properties: formatProperties(elem.properties)
            });
          }
        } else if (isNeoRelationship(elem)) {
          const id = elem.identity.toString();
          if (!linksMap.has(id)) {
            linksMap.set(id, {
              id,
              source: elem.start.toString(),
              target: elem.end.toString(),
              type: elem.type,
              properties: formatProperties(elem.properties)
            });
          }
        } else if (elem && elem.start && elem.end && elem.segments) {
          // Parse complex Graph Paths
          elem.segments.forEach((seg: any) => {
            const startId = seg.start.identity.toString();
            const endId = seg.end.identity.toString();
            const relId = seg.relationship.identity.toString();

            if (!nodesMap.has(startId)) {
              nodesMap.set(startId, {
                id: startId,
                labels: seg.start.labels,
                properties: formatProperties(seg.start.properties)
              });
            }
            if (!nodesMap.has(endId)) {
              nodesMap.set(endId, {
                id: endId,
                labels: seg.end.labels,
                properties: formatProperties(seg.end.properties)
              });
            }
            if (!linksMap.has(relId)) {
              linksMap.set(relId, {
                id: relId,
                source: startId,
                target: endId,
                type: seg.relationship.type,
                properties: formatProperties(seg.relationship.properties)
              });
            }
          });
        }
      });
    });
  });

  const nodes = Array.from(nodesMap.values());
  const links = Array.from(linksMap.values());

  // Enrich link objects with source/target node metadata details
  links.forEach(link => {
    const srcNode = nodesMap.get(link.source);
    const tgtNode = nodesMap.get(link.target);
    if (srcNode) {
      link.sourceName = srcNode.properties.name || srcNode.id;
      link.sourceType = srcNode.labels[0] || 'Unknown';
    }
    if (tgtNode) {
      link.targetName = tgtNode.properties.name || tgtNode.id;
      link.targetType = tgtNode.labels[0] || 'Unknown';
    }
  });

  return {
    nodes,
    links
  };
}

export function isNeoNode(obj: any): boolean {
  return obj && obj.labels !== undefined && obj.identity !== undefined && obj.properties !== undefined;
}

export function isNeoRelationship(obj: any): boolean {
  return obj && obj.type !== undefined && obj.start !== undefined && obj.end !== undefined;
}

export function formatProperties(props: any): any {
  const formatted: any = {};
  for (const k in props) {
    const val = props[k];
    if (neo4j.isInt(val)) {
      formatted[k] = val.toInt();
    } else if (typeof val === 'object' && val !== null && val.low !== undefined) {
      formatted[k] = val.low;
    } else {
      formatted[k] = val;
    }
  }
  return formatted;
}
