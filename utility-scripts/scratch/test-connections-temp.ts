import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function test() {
  const session = driver.session();
  try {
    const res = await session.run(`
      MATCH (p1:Product {id: "6116749"})
      
      // Siblings
      OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c:Category)<-[:BELONGS_TO]-(sib:Product)
      WHERE (sib)-[:MANUFACTURED_BY]->(:Brand {name: "Raw Sugar"}) AND sib <> p1
      WITH p1, collect(sib.name) as siblings
      
      // Competitors
      OPTIONAL MATCH (p1)-[:MANUFACTURED_BY]->(b1:Brand)-[:COMPETES_WITH]-(b2:Brand)<-[:MANUFACTURED_BY]-(rival:Product)
      MATCH (rival)-[:BELONGS_TO]->(rc:Category)
      WHERE rc = p1.category OR rc IN [(p1)-[:BELONGS_TO]->(c1)-[:SUBSTITUTE_CATEGORY]-(c2) | c2]
      WITH siblings, collect(DISTINCT rival.name) as competitors, p1
      
      // Complements
      OPTIONAL MATCH (p1)-[:BELONGS_TO]->(c1:Category)-[:PARENT_CATEGORY*0..2]->(dept1:Category {level: 2})-[:COMPLEMENTARY_TO]-(dept2:Category {level: 2})
      OPTIONAL MATCH (c2:Category)-[:PARENT_CATEGORY*0..2]->(dept2)<-[:BELONGS_TO]-(comp:Product)
      WHERE (comp)-[:MANUFACTURED_BY]->(:Brand {name: "Raw Sugar"}) AND comp <> p1
      
      RETURN siblings, competitors, collect(DISTINCT comp.name) as complements
    `);
    
    console.log('Product "6116749" (Raw Sugar Leave-in Conditioner):');
    const rec = res.records[0];
    console.log('- Siblings found:', rec.get('siblings'));
    console.log('- Competitors found:', rec.get('competitors'));
    console.log('- Complements found:', rec.get('complements'));
  } finally {
    await session.close();
    await driver.close();
  }
}

test();
