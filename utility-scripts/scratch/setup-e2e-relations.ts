import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function run() {
  const session = driver.session();
  try {
    console.log('Inserting test relationships on port 7687 to enable E2E UI testing...');

    // 1. Siblings
    await session.run(`
      MATCH (p1:Product {id: "5384286"})-[:MANUFACTURED_BY]->(b:Brand)
      MATCH (p2:Product {id: "5715877"})
      MERGE (p2)-[:MANUFACTURED_BY]->(b)
    `);
    console.log('1. Created sibling relationship.');

    // 2. Competitors Brand Links
    await session.run(`
      MATCH (p1:Product {id: "5384286"})-[:MANUFACTURED_BY]->(b1:Brand)
      MERGE (b2:Brand {id: "competitor_brand", name: "Ozium Brand"})
      MERGE (b1)-[:COMPETES_WITH {similarity: 0.925}]->(b2)
      MERGE (b2)-[:COMPETES_WITH {similarity: 0.925}]->(b1)
    `);
    console.log('2a. Created competitor brand competition links.');

    // 2b. Competitor Product Link
    await session.run(`
      MATCH (b2:Brand {id: "competitor_brand"})
      WITH b2
      MATCH (rival:Product {id: "186967"})
      MERGE (rival)-[:MANUFACTURED_BY]->(b2)
    `);
    console.log('2b. Linked rival product to competitor brand.');

    // 3. Complements (Companion Accessories)
    await session.run(`
      MATCH (c1:Category {id: "073fc1cb-5f50-536c-9ac4-0369ec1a4b8d"})
      MERGE (dept1:Category {id: "dept_air_care", name: "Air Care Department", level: 2})
      MERGE (c1)-[:PARENT_CATEGORY]->(dept1)
    `);
    await session.run(`
      MERGE (dept1:Category {id: "dept_air_care"})
      MERGE (dept2:Category {id: "dept_car_wash", name: "Car Wash Department", level: 2})
      MERGE (dept1)-[:COMPLEMENTARY_TO {similarity: 0.88}]->(dept2)
      MERGE (dept2)-[:COMPLEMENTARY_TO {similarity: 0.88}]->(dept1)
    `);
    await session.run(`
      MERGE (dept2:Category {id: "dept_car_wash"})
      MERGE (cComp:Category {id: "cat_car_sponges", name: "Car Sponges", level: 3})
      MERGE (cComp)-[:PARENT_CATEGORY]->(dept2)
    `);
    await session.run(`
      MERGE (cComp:Category {id: "cat_car_sponges"})
      WITH cComp
      MATCH (comp:Product {id: "1353032"})
      MERGE (comp)-[:BELONGS_TO]->(cComp)
    `);
    console.log('3. Created complementary department and category relationships.');

    console.log('E2E test relationships setup completed successfully!');
  } catch (err: any) {
    console.error('Setup failed:', err.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

run();
