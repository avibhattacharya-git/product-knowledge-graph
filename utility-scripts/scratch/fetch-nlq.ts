async function run() {
  try {
    const response = await fetch('http://localhost:3000/api/nlq', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        question: "lets do a complementary product search for shopping for toothbrushes"
      })
    });
    
    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      return;
    }
    
    const data = await response.json();
    console.log('--- API RESPONSE METADATA ---');
    console.log('Translated Cypher:', data.translatedCypher);
    console.log('Is Fallback Mode:', data.isFallback);
    console.log(`Total Nodes Mapped: ${data.nodes.length}`);
    console.log(`Total Links Mapped: ${data.links.length}`);
    
    console.log('\n--- SAMPLE CATEGORY NODES ---');
    const categories = data.nodes.filter((n: any) => n.labels.includes('Category'));
    console.log(JSON.stringify(categories.slice(0, 5), null, 2));
    
    console.log('\n--- SAMPLE PRODUCT NODES ---');
    const products = data.nodes.filter((n: any) => n.labels.includes('Product'));
    console.log(JSON.stringify(products.slice(0, 3), null, 2));
    
  } catch (err: any) {
    console.error('Fetch Error:', err.message);
  }
}

run();
