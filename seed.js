require('dotenv').config();
const neo4j = require('neo4j-driver');

const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  )
);

const seedCypher = `
  // Create unique constraints
  CREATE CONSTRAINT IF NOT EXISTS FOR (p:Product) REQUIRE p.id IS UNIQUE;
  CREATE CONSTRAINT IF NOT EXISTS FOR (b:Brand) REQUIRE b.id IS UNIQUE;
  CREATE CONSTRAINT IF NOT EXISTS FOR (r:Retailer) REQUIRE r.id IS UNIQUE;
  CREATE CONSTRAINT IF NOT EXISTS FOR (c:Category) REQUIRE c.id IS UNIQUE;

  // Create Categories
  MERGE (c1:Category {id: "electronics", name: "Electronics"})
  MERGE (c2:Category {id: "audio", name: "Audio"})
  MERGE (c3:Category {id: "smartphones", name: "Smartphones"})
  MERGE (c4:Category {id: "chargers", name: "Chargers"})
  MERGE (c5:Category {id: "consoles", name: "Gaming Consoles"})
  MERGE (c6:Category {id: "controllers", name: "Gaming Controllers"})

  MERGE (c2)-[:PARENT_CATEGORY]->(c1)
  MERGE (c3)-[:PARENT_CATEGORY]->(c1)
  MERGE (c4)-[:PARENT_CATEGORY]->(c1)
  MERGE (c5)-[:PARENT_CATEGORY]->(c1)
  MERGE (c6)-[:PARENT_CATEGORY]->(c1)

  // Create Brands
  MERGE (b1:Brand {id: "apple", name: "Apple"})
  MERGE (b2:Brand {id: "samsung", name: "Samsung"})
  MERGE (b3:Brand {id: "sony", name: "Sony"})
  MERGE (b4:Brand {id: "bose", name: "Bose"})
  MERGE (b5:Brand {id: "anker", name: "Anker"})

  // Create Retailers
  MERGE (r1:Retailer {id: "amazon", name: "Amazon", rating: 4.8, shipping: "Free Prime Shipping"})
  MERGE (r2:Retailer {id: "walmart", name: "Walmart", rating: 4.5, shipping: "Next Day Shipping"})
  MERGE (r3:Retailer {id: "target", name: "Target", rating: 4.4, shipping: "2-Day Delivery"})
  MERGE (r4:Retailer {id: "best_buy", name: "Best Buy", rating: 4.6, shipping: "Store Pickup Available"})

  // Create Products
  MERGE (p1:Product {id: "iphone_15", name: "Apple iPhone 15 Pro", model: "A3102", price: 999.00, rating: 4.7})-[:MANUFACTURED_BY]->(b1)
  MERGE (p2:Product {id: "galaxy_s24", name: "Samsung Galaxy S24 Ultra", model: "SM-S928B", price: 1199.00, rating: 4.6})-[:MANUFACTURED_BY]->(b2)
  MERGE (p3:Product {id: "apple_charger", name: "Apple 20W USB-C Charger", model: "MHJA3AM", price: 19.00, rating: 4.5})-[:MANUFACTURED_BY]->(b1)
  MERGE (p4:Product {id: "anker_charger", name: "Anker 65W GaNPrime Charger", model: "A2668", price: 39.00, rating: 4.8})-[:MANUFACTURED_BY]->(b5)
  
  MERGE (p5:Product {id: "bose_qc", name: "Bose QuietComfort Ultra", model: "QC-Ultra", price: 429.00, rating: 4.8})-[:MANUFACTURED_BY]->(b4)
  MERGE (p6:Product {id: "sony_xm5", name: "Sony WH-1000XM5 Headphones", model: "WH1000XM5/B", price: 398.00, rating: 4.6})-[:MANUFACTURED_BY]->(b3)
  
  MERGE (p7:Product {id: "playstation_5", name: "Sony PlayStation 5 Console", model: "CFI-2000", price: 499.00, rating: 4.9})-[:MANUFACTURED_BY]->(b3)
  MERGE (p8:Product {id: "dualsense", name: "Sony DualSense Edge Controller", model: "CFI-ZCP1", price: 199.00, rating: 4.7})-[:MANUFACTURED_BY]->(b3)

  // Bind Category
  MERGE (p1)-[:BELONGS_TO]->(c3)
  MERGE (p2)-[:BELONGS_TO]->(c3)
  MERGE (p3)-[:BELONGS_TO]->(c4)
  MERGE (p4)-[:BELONGS_TO]->(c4)
  MERGE (p5)-[:BELONGS_TO]->(c2)
  MERGE (p6)-[:BELONGS_TO]->(c2)
  MERGE (p7)-[:BELONGS_TO]->(c5)
  MERGE (p8)-[:BELONGS_TO]->(c6)

  // SOLD_BY links with pricing matrix
  MERGE (p1)-[:SOLD_BY {price: 999.00, stock: "In Stock", url: "https://amazon.com"}]->(r1)
  MERGE (p1)-[:SOLD_BY {price: 989.00, stock: "In Stock", url: "https://walmart.com"}]->(r2)
  MERGE (p1)-[:SOLD_BY {price: 999.00, stock: "Low Stock", url: "https://bestbuy.com"}]->(r4)

  MERGE (p2)-[:SOLD_BY {price: 1199.00, stock: "In Stock", url: "https://amazon.com"}]->(r1)
  MERGE (p2)-[:SOLD_BY {price: 1179.00, stock: "In Stock", url: "https://walmart.com"}]->(r2)

  MERGE (p3)-[:SOLD_BY {price: 19.00, stock: "In Stock", url: "https://target.com"}]->(r3)
  MERGE (p3)-[:SOLD_BY {price: 19.00, stock: "In Stock", url: "https://bestbuy.com"}]->(r4)

  MERGE (p4)-[:SOLD_BY {price: 39.00, stock: "In Stock", url: "https://amazon.com"}]->(r1)
  MERGE (p4)-[:SOLD_BY {price: 34.99, stock: "Low Stock", url: "https://target.com"}]->(r3)

  MERGE (p5)-[:SOLD_BY {price: 429.00, stock: "In Stock", url: "https://amazon.com"}]->(r1)
  MERGE (p5)-[:SOLD_BY {price: 399.00, stock: "In Stock", url: "https://bestbuy.com"}]->(r4)

  // XM5 Headphones
  MERGE (p6)-[:SOLD_BY {price: 398.00, stock: "In Stock", url: "https://amazon.com"}]->(r1)
  MERGE (p6)-[:SOLD_BY {price: 379.00, stock: "In Stock", url: "https://walmart.com"}]->(r2)

  // PS5
  MERGE (p7)-[:SOLD_BY {price: 499.00, stock: "In Stock", url: "https://amazon.com"}]->(r1)
  MERGE (p7)-[:SOLD_BY {price: 489.99, stock: "Low Stock", url: "https://walmart.com"}]->(r2)
  MERGE (p7)-[:SOLD_BY {price: 499.00, stock: "In Stock", url: "https://bestbuy.com"}]->(r4)

  // DualSense Edge
  MERGE (p8)-[:SOLD_BY {price: 199.00, stock: "In Stock", url: "https://amazon.com"}]->(r1)
  MERGE (p8)-[:SOLD_BY {price: 199.00, stock: "In Stock", url: "https://bestbuy.com"}]->(r4)

  // Draw Competitors Heuristic
  MERGE (p1)-[:COMPETES_WITH]->(p2)
  MERGE (p2)-[:COMPETES_WITH]->(p1)
  MERGE (p5)-[:COMPETES_WITH]->(p6)
  MERGE (p6)-[:COMPETES_WITH]->(p5)

  // Draw Substitutes Heuristic
  MERGE (p4)-[:SUBSTITUTE_FOR]->(p3)

  // Draw Complements Heuristic
  MERGE (p1)-[:COMPLEMENTARY_TO]->(p3)
  MERGE (p3)-[:COMPLEMENTARY_TO]->(p1)
  MERGE (p1)-[:COMPLEMENTARY_TO]->(p4)
  MERGE (p4)-[:COMPLEMENTARY_TO]->(p1)
  
  MERGE (p7)-[:COMPLEMENTARY_TO]->(p8)
  MERGE (p8)-[:COMPLEMENTARY_TO]->(p7)
`;

async function seed() {
  console.log('Connecting to Neo4j...');
  const session = neoDriver.session();
  try {
    console.log('Clearing Neo4j database...');
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('Database cleared.');

    console.log('Splitting and executing Cypher statements sequentially...');
    const statements = seedCypher
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      // Skip commented out empty lines
      if (stmt.startsWith('//') && !stmt.includes('\n')) continue;
      await session.run(stmt);
    }

    console.log('\n======================================================');
    console.log('  NEO4J DEFAULT SEED GRAPH SUCCESSFULLY PRELOADED!  ');
    console.log('======================================================\n');
  } catch (err) {
    console.error('Seed Error:', err);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

seed();
