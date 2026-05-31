import puppeteer from 'puppeteer';

declare let selectNodeFromId: any;
declare let state: any;

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
    page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.text()}`));

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
    console.log('\n6. Testing interactive autocomplete search flow for "Active Odor"...');
    await page.focus('#search-input');
    await page.keyboard.type('Active Odor');

    // Wait a brief moment for debounce and autocomplete load
    await page.waitForSelector('.suggestion-item', { timeout: 5000 });

    const suggestions = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.suggestion-item'));
      return items.map(el => el.textContent?.trim() || '');
    });

    console.log(`--> Suggestions returned by autocomplete: ${JSON.stringify(suggestions)}`);
    const hasActiveOdorSuggestion = suggestions.some(val => val.toLowerCase().includes('active odor'));

    if (hasActiveOdorSuggestion) {
      console.log('  [PASS] Autocomplete successfully rendered active Brand/Product suggestions.');
    } else {
      console.error('  [FAIL] Autocomplete suggestions do not contain "Active Odor"!');
      exitCode = 1;
    }

    // Click on the suggestion item that contains "New Car Scent, 3 oz" to trigger search and render product nodes
    console.log('--> Selecting autocomplete suggestion containing "New Car Scent, 3 oz" to load product onto canvas...');
    const targetSuggestion = await page.evaluateHandle(() => {
      const items = Array.from(document.querySelectorAll('.suggestion-item'));
      return items.find(item => item.textContent?.includes('New Car Scent, 3 oz'));
    });
    if (!targetSuggestion) {
      throw new Error('Could not find autocomplete suggestion containing "New Car Scent, 3 oz"!');
    }
    await (targetSuggestion as any).click();

    // 8. Interactive Flow Check: Visual Node Click & Inspector Panel Mappings
    console.log('\n7. Testing visual graph node click and dynamic inspector panel loading...');
    
    // Wait for the specific searched Product node to be rendered on the SVG canvas
    console.log('--> Waiting for the specific searched Product node to render on the canvas...');
    await page.waitForFunction(() => {
      const groups = Array.from(document.querySelectorAll('.node-group'));
      return groups.some(g => {
        const text = g.querySelector('.node-label')?.textContent || '';
        return text.includes('Active Odor') && text.includes('Fogger');
      });
    }, { timeout: 15000 });
    
    // Select the product directly via selectNodeFromId
    console.log('--> Programmatically selecting the searched Product node on the canvas...');
    const productClicked = await page.evaluate(() => {
      console.log("D3 Canvas Selection Triggered!");
      if (typeof selectNodeFromId === 'function' && typeof state !== 'undefined' && state.allNodes) {
        console.log("All nodes count in state:", state.allNodes.length);
        console.log("All node names in state:", JSON.stringify(state.allNodes.map((n: any) => n.properties?.name)));
        const node = state.allNodes.find((n: any) => {
          const name = n.properties?.name || '';
          return name.includes('Active Odor') && name.includes('Fogger');
        });
        if (node) {
          console.log("Selecting matching node by ID:", node.id, "-", node.properties?.name);
          selectNodeFromId(node.id);
          return true;
        } else {
          console.log("No node matching 'Active Odor' and 'Fogger' found in state.allNodes!");
        }
      } else {
        console.log("selectNodeFromId or state not globally defined!");
      }
      return false;
    });

    if (!productClicked) {
      throw new Error('Could not programmatically select the target product dynamically!');
    }
    
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
    
    // STRICT POPULATED DATA ASSERTIONS
    const hasCompetitorsData = compContent.length > 0 && !compContent.includes('No competing brands');
    const hasSubstitutesData = subContent.length > 0 && !subContent.includes('No product size');
    const hasComplementsData = compToContent.length > 0 && !compToContent.includes('No complementary');

    if (hasCompetitorsData) {
      console.log('  [PASS] Competitors list is fully populated with live relation data!');
    } else {
      console.error('  [FAIL] Competitors list is empty or shows fallback text!');
      exitCode = 1;
    }

    if (hasSubstitutesData) {
      console.log('  [PASS] Substitutions list is fully populated with live relation data!');
    } else {
      console.error('  [FAIL] Substitutions list is empty or shows fallback text!');
      exitCode = 1;
    }

    if (hasComplementsData) {
      console.log('  [PASS] Complements list is fully populated with live relation data!');
    } else {
      console.error('  [FAIL] Complements list is empty or shows fallback text!');
      exitCode = 1;
    }

    // 9. Verify Match Badges and Likely Badges Render Successfully
    console.log('\n8. Asserting "Match %" and "Likely %" badges render successfully...');
    const badgeText = await page.evaluate(() => {
      const matchPills = Array.from(document.querySelectorAll('.match-badge'));
      return matchPills.map(pill => pill.textContent?.trim() || '');
    });
    console.log(`--> Match badges found in inspector panel: ${JSON.stringify(badgeText)}`);
    const hasMatchBadge = badgeText.some(t => t.includes('% Match'));
    const hasLikelyBadge = badgeText.some(t => t.includes('% Likely'));

    if (hasMatchBadge) {
      console.log('  [PASS] Competitor "% Match" badge found and verified.');
    } else {
      console.error('  [FAIL] Competitor "% Match" badge not found!');
      exitCode = 1;
    }

    if (hasLikelyBadge) {
      console.log('  [PASS] Companion "% Likely" badge found and verified.');
    } else {
      console.error('  [FAIL] Companion "% Likely" badge not found!');
      exitCode = 1;
    }

    if (exitCode === 0) {
      console.log('  [PASS] Competitors, substitutions, and complements rendered successfully inside the Inspector Panel with LIVE DATA and correct dynamic similarity badges.');
    }

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
