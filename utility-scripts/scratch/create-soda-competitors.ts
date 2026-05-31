import neo4j from 'neo4j-driver';

const neoDriver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'retailpassword123')
);

async function createSodaCompetitors() {
  const session = neoDriver.session();
  try {
    console.log('Inserting real-world Coke vs Pepsi brand competitor links into Neo4j...');
    
    // We want to link Coca-Cola (677) and Cherry Coke (681) as competitors with Pepsi brands
    const cypher = `
      MATCH (coke:Brand {id: "677"})
      MATCH (cherryCoke:Brand {id: "681"})
      MATCH (pepsiZero:Brand {id: "44260"})
      MATCH (pepsiCherry:Brand {id: "44259"})
      
      // Coke <-> Pepsi Zero Sugar
      MERGE (coke)-[r1:COMPETES_WITH]->(pepsiZero)
      SET r1.similarity = 0.92
      MERGE (pepsiZero)-[r2:COMPETES_WITH]->(coke)
      SET r2.similarity = 0.92
      
      // Coke <-> Pepsi Wild Cherry
      MERGE (coke)-[r3:COMPETES_WITH]->(pepsiCherry)
      SET r3.similarity = 0.91
      MERGE (pepsiCherry)-[r4:COMPETES_WITH]->(coke)
      SET r4.similarity = 0.91
      
      // Cherry Coke <-> Pepsi Zero Sugar
      MERGE (cherryCoke)-[r5:COMPETES_WITH]->(pepsiZero)
      SET r5.similarity = 0.89
      MERGE (pepsiZero)-[r6:COMPETES_WITH]->(cherryCoke)
      SET r6.similarity = 0.89
      
      // Cherry Coke <-> Pepsi Wild Cherry
      MERGE (cherryCoke)-[r7:COMPETES_WITH]->(pepsiCherry)
      SET r7.similarity = 0.90
      MERGE (pepsiCherry)-[r8:COMPETES_WITH]->(cherryCoke)
      SET r8.similarity = 0.90
      
      RETURN count(*) AS linksCreated
    `;
    
    const result = await session.run(cypher);
    console.log(`Successfully established Coca-Cola and Pepsi competitive brand edges in Neo4j!`);
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

createSodaCompetitors();
