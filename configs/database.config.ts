import 'dotenv/config';

export const postgresConfig = {
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
  max: 20, // Connection pool size limit
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export const neo4jConfig = {
  uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
  user: process.env.NEO4J_USER || 'neo4j',
  password: process.env.NEO4J_PASSWORD || 'retailpassword123',
  database: process.env.NEO4J_DATABASE || 'neo4j', // Configurable target database
  driverOptions: {
    maxConnectionPoolSize: 100, // Large connection pool for concurrent ETL/queries
    connectionTimeout: 10000,
  }
};
