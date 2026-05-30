import neo4j from 'neo4j-driver';
import 'dotenv/config';

const neoDriver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'retailpassword123'
  )
);

async function checkAndKill() {
  const session = neoDriver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    console.log('Fetching active Neo4j transactions...');
    const res = await session.run('SHOW TRANSACTIONS');
    console.log(`Found ${res.records.length} active transactions:`);
    
    const killerPromises = [];
    for (const record of res.records) {
      const txId = record.get('transactionId');
      const currentQuery = record.get('currentQuery') || '';
      
      console.log(`- Tx [${txId}]: "${currentQuery}"`);
      
      // Terminate any transaction that is NOT the active SHOW TRANSACTIONS management query
      if (!currentQuery.includes('SHOW TRANSACTIONS')) {
        console.log(`Terminating transaction ${txId}...`);
        killerPromises.push(
          session.run(`TERMINATE TRANSACTION "${txId}"`)
            .then(() => console.log(`Successfully sent terminate signal to Tx [${txId}]`))
            .catch(err => console.error(`Failed to terminate Tx [${txId}]:`, err.message))
        );
      }
    }
    
    if (killerPromises.length > 0) {
      await Promise.all(killerPromises);
    } else {
      console.log('No matching long-running transactions found.');
    }
  } catch (err: any) {
    console.error('Error managing transactions:', err.message);
  } finally {
    await session.close();
    await neoDriver.close();
  }
}

checkAndKill();
