

async function testEndpoints() {
  console.log('======================================================');
  console.log('  PROGRAMMATIC INTEGRATION & SCHEMA CONFORMANCE TEST ');
  console.log('======================================================\n');

  const baseUrl = 'http://localhost:3000';

  // 1. Test /api/db-status
  try {
    console.log('1. Querying /api/db-status...');
    const res = await fetch(`${baseUrl}/api/db-status`);
    const status = await res.json();
    console.log('Status Response PG Connected:', status.postgres?.connected);
    console.log('Status Response Neo4j Connected:', status.neo4j?.connected);
    console.log('Active Neo4j Node Counts:', JSON.stringify(status.neo4j?.counts));
  } catch (err: any) {
    console.error('Failed db-status query:', err.message);
  }

  // 2. Test /api/graph node/relationship constraints
  try {
    console.log('\n2. Fetching D3 Graph Visual Canvas Data (/api/graph)...');
    const res = await fetch(`${baseUrl}/api/graph`);
    const graph: any = await res.json();
    console.log(`Loaded ${graph.nodes?.length || 0} nodes and ${graph.links?.length || 0} links.`);

    // Check for schema violations
    let catalogSourceCount = 0;
    let sourcedFromCount = 0;

    if (Array.isArray(graph.nodes)) {
      graph.nodes.forEach((node: any) => {
        if (node.labels && node.labels.includes('CatalogSource')) {
          catalogSourceCount++;
        }
      });
    }

    if (Array.isArray(graph.links)) {
      graph.links.forEach((link: any) => {
        if (link.type === 'SOURCED_FROM') {
          sourcedFromCount++;
        }
      });
    }

    console.log('--> Schema Conformance Verification Result:');
    if (catalogSourceCount === 0) {
      console.log('  [PASS] Exactly 0 CatalogSource nodes returned.');
    } else {
      console.error(`  [FAIL] Detected ${catalogSourceCount} CatalogSource nodes!`);
    }

    if (sourcedFromCount === 0) {
      console.log('  [PASS] Exactly 0 SOURCED_FROM relationships returned.');
    } else {
      console.error(`  [FAIL] Detected ${sourcedFromCount} SOURCED_FROM relationships!`);
    }

  } catch (err: any) {
    console.error('Failed graph query:', err.message);
  }

  // 3. Test autocomplete
  try {
    console.log('\n3. Testing autocomplete search suggestions (/api/autocomplete?q=coke)...');
    const res = await fetch(`${baseUrl}/api/autocomplete?q=coke`);
    const suggestions: any = await res.json();
    console.log(`Suggestions returned: ${suggestions.length}`);
    if (suggestions.length > 0) {
      console.log('Sample suggestion:', suggestions[0]);
    }
  } catch (err: any) {
    console.error('Failed autocomplete query:', err.message);
  }
}

testEndpoints().then(() => console.log('\nTesting completed.'));
