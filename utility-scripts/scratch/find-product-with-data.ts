import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function findProductWithData() {
  const session = neoDriver.session();
  const baseUrl = 'http://localhost:3000';
  
  try {
    console.log('Querying Neo4j for a product with full companion department hierarchies and competing brands...');
    
    // We want a product that:
    // 1. belongs to a category which has complements
    // 2. is manufactured by a brand which has competitors
    // 3. has siblings (other products of same brand and same category)
    const cypher = `
      MATCH (p:Product)-[:BELONGS_TO]->(c1:Category)
      MATCH (p)-[:MANUFACTURED_BY]->(b1:Brand)
      
      // Filter for brands that have competitors
      WHERE EXISTS {
        MATCH (b1)-[:COMPETES_WITH]-(:Brand)
      }
      
      // Filter for categories that have parent departments with complements
      AND EXISTS {
        MATCH (c1)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})-[:COMPLEMENTARY_TO]-(:Category {level: 2})
      }
      
      // Filter for products that have siblings
      AND EXISTS {
        MATCH (sib:Product)-[:BELONGS_TO]->(c1)
        WHERE (sib)-[:MANUFACTURED_BY]->(b1) AND sib <> p
      }
      
      RETURN p.id AS id, p.name AS name, b1.name AS brandName, c1.name AS categoryName
      LIMIT 100
    `;
    const result = await session.run(cypher);

    console.log(`Found ${result.records.length} candidate matches. Testing related arrays from API...`);

    for (const record of result.records) {
      const id = record.get('id');
      const name = record.get('name');
      const brandName = record.get('brandName');
      const categoryName = record.get('categoryName');

      const res = await fetch(`${baseUrl}/api/products/${id}/related`);
      if (!res.ok) continue;

      const data: any = await res.json();
      const competitorsCount = data.competitors?.length || 0;
      const complementsCount = data.complements?.length || 0;
      const siblingsCount = data.siblings?.length || 0;

      console.log(`- Product: "${name}" (ID: "${id}"): Competitors: ${competitorsCount}, Complements: ${complementsCount}, Siblings: ${siblingsCount}`);

      if (competitorsCount > 0 && complementsCount > 0 && siblingsCount > 0) {
        console.log(`\n🎉 Found Product with populated data!`);
        console.log(`- Product ID: "${id}"`);
        console.log(`- Product Name: "${name}"`);
        console.log(`- Brand: "${brandName}"`);
        console.log(`- Category: "${categoryName}"`);
        console.log(`- Competitors Count: ${competitorsCount}`);
        console.log(`- Complements Count: ${complementsCount}`);
        console.log(`- Sibling alternatives Count: ${siblingsCount}`);
        return;
      }
    }

    console.log('\nNo matching product found.');

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

findProductWithData();
