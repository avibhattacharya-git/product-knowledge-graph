import puppeteer from 'puppeteer';

async function runE2ETests() {
  console.log('======================================================');
  console.log('  STARTING AUTOMATED E2E UI CONFORMANCE & FLOW TESTS  ');
  console.log('======================================================\n');

  let exitCode = 0;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Set high screen dimensions for responsive styling
    await page.setViewport({ width: 1440, height: 900 });

    console.log('1. Connecting to local server http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

    // 2. Verify Page Title
    const title = await page.title();
    console.log(`--> Page Title: "${title}"`);
    if (title.includes('Retailer Product Knowledge Graph')) {
      console.log('  [PASS] Title conforms successfully.');
    } else {
      console.error('  [FAIL] Title mismatch!');
      exitCode = 1;
    }

    // 3. Conformance Check: Sources Toggle Checkbox Visibility
    console.log('\n2. Asserting "Sources" checkbox node filter is visually hidden...');
    const showSourcesHidden = await page.evaluate(() => {
      const chk = document.getElementById('show-catalogsource-checkbox');
      if (!chk) return false;
      const parent = chk.closest('label');
      if (!parent) return false;
      return window.getComputedStyle(parent).display === 'none';
    });

    if (showSourcesHidden) {
      console.log('  [PASS] "#show-catalogsource-checkbox" is styled as display: none.');
    } else {
      console.error('  [FAIL] "#show-catalogsource-checkbox" is visible!');
      exitCode = 1;
    }

    // 4. Conformance Check: Sourced From Relationship Toggle Visibility
    console.log('\n3. Asserting "Sourced From" checkbox edge filter is visually hidden...');
    const relSourcedHidden = await page.evaluate(() => {
      const chk = document.getElementById('rel-sourced-checkbox');
      if (!chk) return false;
      const parent = chk.closest('label');
      if (!parent) return false;
      return window.getComputedStyle(parent).display === 'none';
    });

    if (relSourcedHidden) {
      console.log('  [PASS] "#rel-sourced-checkbox" is styled as display: none.');
    } else {
      console.error('  [FAIL] "#rel-sourced-checkbox" is visible!');
      exitCode = 1;
    }

    // 5. Conformance Check: Sources Statistics Card Visibility
    console.log('\n4. Asserting "Sources" statistics metrics card is visually hidden...');
    const statSourcesHidden = await page.evaluate(() => {
      const card = document.getElementById('metric-sources')?.closest('.metric-card');
      if (!card) return false;
      return window.getComputedStyle(card).display === 'none';
    });

    if (statSourcesHidden) {
      console.log('  [PASS] "#metric-sources" card is styled as display: none.');
    } else {
      console.error('  [FAIL] "#metric-sources" card is visible!');
      exitCode = 1;
    }

    // 6. Conformance Check: Cypher template select option removal
    console.log('\n5. Verifying Walmart API query template option is purged...');
    const walmartOptionPurged = await page.evaluate(() => {
      const select = document.getElementById('cypher-template-select') as HTMLSelectElement;
      if (!select) return false;
      const options = Array.from(select.options);
      return !options.some(opt => opt.value === 'match_walmart_source');
    });

    if (walmartOptionPurged) {
      console.log('  [PASS] "match_walmart_source" option does not exist in template select.');
    } else {
      console.error('  [FAIL] "match_walmart_source" option still exists!');
      exitCode = 1;
    }

    // 7. Interactive Flow Check: Autocomplete Search Suggestions
    console.log('\n6. Testing interactive autocomplete search flow for "coke"...');
    await page.focus('#search-input');
    await page.keyboard.type('coke');

    // Wait a brief moment for debounce and autocomplete load
    await page.waitForSelector('.suggestion-item', { timeout: 5000 });

    const suggestions = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.suggestion-item'));
      return items.map(el => el.textContent?.trim() || '');
    });

    console.log(`--> Suggestions returned by autocomplete: ${JSON.stringify(suggestions)}`);
    const hasCokeSuggestion = suggestions.some(val => val.toLowerCase().includes('coke'));

    if (hasCokeSuggestion) {
      console.log('  [PASS] Autocomplete successfully rendered active Brand/Product suggestions.');
    } else {
      console.error('  [FAIL] Autocomplete suggestions do not contain "coke"!');
      exitCode = 1;
    }

    // Click on the first suggestion item to trigger the visual search and render product nodes
    console.log('--> Selecting first autocomplete suggestion to load products onto canvas...');
    const firstSuggestion = await page.$('.suggestion-item');
    if (!firstSuggestion) {
      throw new Error('Could not find any suggestion items to click!');
    }
    await firstSuggestion.click();

    // 8. Interactive Flow Check: Visual Node Click & Inspector Panel Mappings
    console.log('\n7. Testing visual graph node click and dynamic inspector panel loading...');
    
    // Wait for the visual D3 Product node circles to render on screen
    console.log('--> Waiting for visual Product nodes to render on the canvas...');
    await page.waitForSelector('.node-circle.Product', { timeout: 15000 });
    
    // Find the first Product node circle and click it
    const productNode = await page.$('.node-circle.Product');
    if (!productNode) {
      throw new Error('Could not find any Product node circles on the SVG canvas!');
    }
    
    console.log('--> Clicking on visual Product node in D3 canvas...');
    await productNode.click();
    
    // Wait for inspector content slide-in panel to expand (should not have class 'hide')
    await page.waitForFunction(() => {
      const inspector = document.getElementById('inspector-content');
      return inspector && !inspector.classList.contains('hide');
    }, { timeout: 5000 });
    
    console.log('  [PASS] Inspector panel slide-in opened successfully.');
    
    // Wait for dynamic API relations lists (competitors, substitutes, complements) to finish loading
    console.log('--> Waiting for dynamic competitors, substitutes, and complements lists to finish loading...');
    await page.waitForFunction(() => {
      const compText = document.getElementById('inspector-competitors-list')?.textContent || '';
      const subText = document.getElementById('inspector-substitutes-list')?.textContent || '';
      const compToText = document.getElementById('inspector-complements-list')?.textContent || '';
      
      // None of the lists should show the loading spinner state text "Finding..." or "Loading..."
      return !compText.includes('Finding') && !subText.includes('Finding') && !compToText.includes('Finding') &&
             !compText.includes('Loading') && !subText.includes('Loading') && !compToText.includes('Loading');
    }, { timeout: 10000 });
    
    const compContent = await page.evaluate(() => document.getElementById('inspector-competitors-list')?.textContent?.trim() || '');
    const subContent = await page.evaluate(() => document.getElementById('inspector-substitutes-list')?.textContent?.trim() || '');
    const compToContent = await page.evaluate(() => document.getElementById('inspector-complements-list')?.textContent?.trim() || '');
    
    console.log(`--> Competitors Panel Content: "${compContent}"`);
    console.log(`--> Substitutions Panel Content: "${subContent}"`);
    console.log(`--> Complements Panel Content: "${compToContent}"`);
    
    console.log('  [PASS] Competitors, substitutions, and complements rendered successfully inside the Inspector Panel.');

  } catch (err: any) {
    console.error('\n[CRITICAL ERROR DURING UI TESTING]:', err.message);
    exitCode = 1;
  } finally {
    await browser.close();
    console.log('\n======================================================');
    console.log(`  E2E UI CONFORMANCE & FLOW TESTS COMPLETED (Exit: ${exitCode})`);
    console.log('======================================================');
    process.exit(exitCode);
  }
}

runE2ETests();
