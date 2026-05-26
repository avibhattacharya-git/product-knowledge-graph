require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const neo4j = require('neo4j-driver');

const app = express();
const PORT = process.env.PORT || 3000;

// Body Parser Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Postgres Pool
const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
});

// Initialize Neo4j Driver
const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  )
);

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. GET /api/db-status - Check databases connectivity and row counts
app.get('/api/db-status', async (req, res) => {
  const status = {
    postgres: { connected: false, rowCounts: {} },
    neo4j: { connected: false, counts: {} }
  };

  // Check PostgreSQL
  try {
    const pgClient = await pgPool.connect();
    status.postgres.connected = true;
    try {
      const tables = [
        'global_products_search_mv',
        'brands_search_mv',
        'product_categories_search_mv',
        'brand_category_map_mv'
      ];
      for (const t of tables) {
        const countRes = await pgClient.query(`SELECT COUNT(*) FROM ${t}`).catch(() => ({ rows: [{ count: -1 }] }));
        status.postgres.rowCounts[t] = parseInt(countRes.rows[0].count);
      }
    } finally {
      pgClient.release();
    }
  } catch (err) {
    status.postgres.error = err.message;
  }

  // Check Neo4j
  try {
    const session = neoDriver.session();
    try {
      await session.run('RETURN 1');
      status.neo4j.connected = true;

      const nodeCounts = await session.run('MATCH (n) RETURN labels(n)[0] as label, count(n) as count');
      nodeCounts.records.forEach(rec => {
        const label = rec.get('label') || 'Unlabeled';
        status.neo4j.counts[label] = rec.get('count').toInt();
      });

      const edgeCounts = await session.run('MATCH ()-[r]->() RETURN type(r) as type, count(r) as count');
      edgeCounts.records.forEach(rec => {
        status.neo4j.counts[rec.get('type')] = rec.get('count').toInt();
      });
    } finally {
      await session.close();
    }
  } catch (err) {
    status.neo4j.error = err.message;
  }

  res.json(status);
});

// 2. GET /api/graph - Fetch complete active graph for visualization
app.get('/api/graph', async (req, res) => {
  const session = neoDriver.session();
  try {
    const cypher = `
      MATCH (n)
      OPTIONAL MATCH (n)-[r]->(m)
      RETURN n, r, m LIMIT 800
    `;
    const result = await session.run(cypher);
    const graph = formatNeoResult(result);
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// 3. POST /api/query - Execute custom Cypher query
app.post('/api/query', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query parameter is required' });

  const session = neoDriver.session();
  try {
    console.log(`Executing Cypher: ${query}`);
    const result = await session.run(query);
    const graph = formatNeoResult(result);
    res.json(graph);
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// 4. GET /api/categories - Get category tree
app.get('/api/categories', async (req, res) => {
  const session = neoDriver.session();
  try {
    const result = await session.run(`
      MATCH (c:Category)
      OPTIONAL MATCH (c)-[:PARENT_CATEGORY]->(p:Category)
      RETURN c.id AS id, c.name AS name, p.id AS parentId
    `);
    const categories = result.records.map(rec => ({
      id: rec.get('id'),
      name: rec.get('name'),
      parentId: rec.get('parentId')
    }));
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// 5. POST /api/ingest - Trigger Postgres ETL Ingestion Pipeline
app.post('/api/ingest', async (req, res) => {
  try {
    console.log('Triggering Ingestion Script...');
    // We execute the ingestion script in-process
    const ingest = require('./ingest');
    const stats = await ingest.runPipeline(pgPool, neoDriver);
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Format Neo4j output records into standard D3 nodes and links
function formatNeoResult(result) {
  const nodesMap = new Map();
  const linksMap = new Map();

  result.records.forEach(record => {
    // A Cypher record can contain nodes and relationships
    record.keys.forEach(key => {
      const value = record.get(key);
      if (!value) return;

      // Handle arrays of elements
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
          // It's a Path
          elem.segments.forEach(seg => {
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

  return {
    nodes: Array.from(nodesMap.values()),
    links: Array.from(linksMap.values())
  };
}

function isNeoNode(obj) {
  return obj && obj.labels !== undefined && obj.identity !== undefined && obj.properties !== undefined;
}

function isNeoRelationship(obj) {
  return obj && obj.type !== undefined && obj.start !== undefined && obj.end !== undefined;
}

function formatProperties(props) {
  const formatted = {};
  for (const k in props) {
    const val = props[k];
    if (neo4j.isInt(val)) {
      formatted[k] = val.toInt();
    } else if (typeof val === 'object' && val !== null && val.low !== undefined) {
      formatted[k] = val.low; // handle standard low/high integer representation
    } else {
      formatted[k] = val;
    }
  }
  return formatted;
}

// Global Exception Handler
process.on('SIGINT', async () => {
  console.log('Shutting down API server...');
  await pgPool.end();
  await neoDriver.close();
  process.exit(0);
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  US Retailer Knowledge Graph Server: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
