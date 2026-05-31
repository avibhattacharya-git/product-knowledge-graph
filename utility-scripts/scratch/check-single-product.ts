import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function checkSingleProduct() {
  const session = neoDriver.session();
  const baseUrl = 'http://localhost:3000';
  
  try {
    const productIds = ["6116746", "1417896", "5384286"];
    console.log(`Verifying target products: ${productIds.join(', ')}...`);

    for (const id of productIds) {
      const pRes = await session.run(`
        MATCH (p:Product {id: $id})
        RETURN p.name AS name
      `, { id });
      
      const name = pRes.records[0]?.get('name') || 'Unknown Product';
      console.log(`\n- Target Product ID: "${id}", Name: "${name}"`);

      console.log(`--> Fetching: ${baseUrl}/api/products/${id}/related`);
      const res = await fetch(`${baseUrl}/api/products/${id}/related`);
      console.log(`--> Response Status: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const detail = await res.json();
        console.log(`--> Competitors Count: ${detail.competitors?.length}`);
        if (detail.competitors && detail.competitors.length > 0) {
          const c = detail.competitors[0];
          console.log(`    [SAMPLE COMPETITOR] Name: "${c.name}", MatchScore: ${c.matchScore}%`);
        }
        console.log(`--> Complements Count: ${detail.complements?.length}`);
        if (detail.complements && detail.complements.length > 0) {
          const c = detail.complements[0];
          console.log(`    [SAMPLE COMPLEMENT] Name: "${c.name}", MatchScore: ${c.matchScore}%`);
        }
        console.log(`--> Siblings Count: ${detail.siblings?.length}`);
      } else {
        console.log(`--> Response Text:`, await res.text());
      }
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

checkSingleProduct();
