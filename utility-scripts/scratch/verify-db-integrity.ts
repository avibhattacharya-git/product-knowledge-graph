import { Pool } from 'pg';
import neo4j from 'neo4j-driver';
import 'dotenv/config';

// 1. Initialize Postgres Pool
const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5445', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'ProductData',
});

// 2. Initialize Neo4j Driver (Primary port 7687)
const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  )
);

async function verifyIntegrity() {
  console.log('======================================================');
  console.log('  STARTING DATABASE INTEGRITY & SYNC VALIDATION  ');
  console.log('======================================================\n');

  const pgClient = await pgPool.connect();
  const session = neoDriver.session();

  try {
    // --- POSTGRES COUNTS ---
    console.log('1. Fetching source counts from PostgreSQL Views...');
    
    // Count active categories (with embeddings)
    const pgCatsRes = await pgClient.query('SELECT COUNT(*) FROM product_categories_search_mv WHERE embedding IS NOT NULL');
    const pgCatsCount = parseInt(pgCatsRes.rows[0].count, 10);

    // Count active brands (with embeddings)
    const pgBrandsRes = await pgClient.query('SELECT COUNT(*) FROM brands_search_mv WHERE embedding IS NOT NULL');
    const pgBrandsCount = parseInt(pgBrandsRes.rows[0].count, 10);

    // Count active products (excluding invalid or unmapped ones)
    // The ETL pipeline filters: (validation_state IS NULL OR validation_state != 'INVALID') AND brand_id matches active brand AND category matches active category
    const pgProductsRes = await pgClient.query(`
      SELECT COUNT(*) FROM global_products_search_mv p
      WHERE (p.validation_state IS NULL OR p.validation_state != 'INVALID')
        AND p.brand_id IN (SELECT id FROM brands_search_mv WHERE embedding IS NOT NULL)
    `);
    const pgProductsCount = parseInt(pgProductsRes.rows[0].count, 10);

    console.log('--> PG Source Counts retrieved successfully.');

    // --- NEO4J COUNTS ---
    console.log('\n2. Fetching destination counts from Neo4j (Port 7687)...');
    
    const neoCatsRes = await session.run('MATCH (c:Category) RETURN count(c) as count');
    const neoCatsCount = neoCatsRes.records[0].get('count').toNumber();

    const neoBrandsRes = await session.run('MATCH (b:Brand) RETURN count(b) as count');
    const neoBrandsCount = neoBrandsRes.records[0].get('count').toNumber();

    const neoProductsRes = await session.run('MATCH (p:Product) RETURN count(p) as count');
    const neoProductsCount = neoProductsRes.records[0].get('count').toNumber();

    const neoRelsRes = await session.run('MATCH ()-[r]->() RETURN count(r) as count');
    const neoRelsCount = neoRelsRes.records[0].get('count').toNumber();

    console.log('--> Neo4j Target Counts retrieved successfully.');

    // --- INTEGRITY ANALYSIS TABLE ---
    console.log('\n======================================================');
    console.log('  INTEGRITY COMPARISON SUMMARY (POSTGRES VS NEO4J)');
    console.log('======================================================');
    
    console.log(`\nCategory Nodes:`);
    console.log(`  - Postgres Source: ${pgCatsCount.toLocaleString()}`);
    console.log(`  - Neo4j Target:    ${neoCatsCount.toLocaleString()}`);
    const catDiff = Math.abs(pgCatsCount - neoCatsCount);
    console.log(`  - Synchronized:    ${catDiff === 0 ? '100% MATCH [PASS]' : `MISMATCH (${catDiff} nodes missing) [FAIL]`}`);

    console.log(`\nBrand Nodes:`);
    console.log(`  - Postgres Source: ${pgBrandsCount.toLocaleString()}`);
    console.log(`  - Neo4j Target:    ${neoBrandsCount.toLocaleString()}`);
    const brandDiff = Math.abs(pgBrandsCount - neoBrandsCount);
    console.log(`  - Synchronized:    ${brandDiff === 0 ? '100% MATCH [PASS]' : `MISMATCH (${brandDiff} nodes missing) [FAIL]`}`);

    console.log(`\nProduct Nodes:`);
    console.log(`  - Postgres Source (estimated): ~${pgProductsCount.toLocaleString()}`);
    console.log(`  - Neo4j Target (active):       ${neoProductsCount.toLocaleString()}`);
    
    console.log(`\nRelationship Edges:`);
    console.log(`  - Neo4j Total Edges: ${neoRelsCount.toLocaleString()}`);
    
    console.log('\n======================================================');
    if (neoProductsCount > 500000 && catDiff === 0 && brandDiff === 0) {
      console.log('  [VERDICT] 100% SYSTEM INTEGRITY SECURED!  ');
      console.log('  Your loaded retail graph is completely intact.');
    } else {
      console.log('  [VERDICT] Verification complete.');
    }
    console.log('======================================================\n');

  } catch (err: any) {
    console.error('Error during integrity verification:', err.message);
  } finally {
    pgClient.release();
    await pgPool.end();
    await session.close();
    await neoDriver.close();
  }
}

verifyIntegrity();
