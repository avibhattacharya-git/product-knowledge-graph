import { Pool } from 'pg';
import neo4j, { Driver } from 'neo4j-driver';
import { postgresConfig, neo4jConfig } from '../configs/database.config';

// Instantiates the PostgreSQL Pool
export const pgPool = new Pool(postgresConfig);

// Instantiates the Neo4j Driver
export const neoDriver: Driver = neo4j.driver(
  neo4jConfig.uri,
  neo4j.auth.basic(neo4jConfig.user, neo4jConfig.password),
  neo4jConfig.driverOptions
);

// Factory function to obtain configured session targets
export function getNeoSession(accessMode: 'READ' | 'WRITE' = 'WRITE', databaseOverride?: string) {
  const dbName = databaseOverride || neo4jConfig.database;
  return neoDriver.session({
    defaultAccessMode: accessMode === 'WRITE' ? neo4j.session.WRITE : neo4j.session.READ,
    database: dbName
  });
}

// Graceful database shutdown handler
export async function shutdownDatabases(): Promise<void> {
  console.log('\nClosing database connections gracefully...');
  try {
    await pgPool.end();
    console.log('PostgreSQL connection pool terminated.');
    await neoDriver.close();
    console.log('Neo4j driver connection closed.');
  } catch (err) {
    console.error('Error during databases connection teardown:', err);
    throw err;
  }
}
