async function testNLQ(question: string) {
  try {
    const response = await fetch('http://localhost:3000/api/nlq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    
    if (!response.ok) {
      console.error(`Error for "${question}": ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error('Error Details:', text);
      return;
    }
    
    const data = await response.json();
    console.log(`\n======================================================`);
    console.log(`QUESTION: "${question}"`);
    console.log(`Is Fallback:`, data.isFallback);
    console.log(`Translated Cypher:`);
    console.log(data.translatedCypher);
    console.log(`\nAI Reasoning / Explanation:`);
    console.log(data.explanation || 'None provided');
    console.log(`Nodes returned: ${data.nodes ? data.nodes.length : 0}`);
    console.log(`Links returned: ${data.links ? data.links.length : 0}`);
  } catch (err: any) {
    console.error('Fetch Error:', err.message);
  }
}

async function run() {
  console.log('--- Testing Upgraded Explainable NLQ Endpoint ---');
  // Test brand competitors
  await testNLQ("Show brand rivals for Coca Cola");
  // Test category substitutes
  await testNLQ("What are substitute categories for Laundry Detergents?");
  // Test parent category hierarchy path
  await testNLQ("What is the parent category hierarchy path for Baking Mixes?");
  // Test healthier substitute
  await testNLQ("Find a healthier substitute for Coca Cola");
}

run();
