/* ==========================================================================
   FRONTEND CONTROLLER - D3 GRAPH & INTERACTIVE PLAYGROUND
   ========================================================================== */

// 1. Application State
const state = {
  allNodes: [],
  allLinks: [],
  filteredNodes: [],
  filteredLinks: [],
  selectedNode: null,
  activeCategoryFilterId: null,
  activeBrandFilterId: null, // Track brand filter focus
  activeSearchQuery: '',
  searchMode: 'keyword', // 'keyword' or 'gemini'
  geminiCypher: '',
  filters: {
    Product: true,
    Brand: true,
    Category: true
  },
  relFilters: {
    COMPETES_WITH: true,
    SUBSTITUTE_FOR: true,
    COMPLEMENTARY_TO: true,
    MANUFACTURED_BY: true,
    BELONGS_TO: true,
    PARENT_CATEGORY: true
  },
  physicsEnabled: true,
  isDrawerExpanded: false,
  selectedRecommendations: new Set(),
  recommendations: []
};

// D3 Selections & Simulation
let svg, g, simulation, zoomBehavior;
let selectedSourceId = null;
const selectedTargetIds = new Set();
const width = window.innerWidth;
const height = window.innerHeight;

// Initials mapping for centered node icons
const iconMap = {
  Product: 'GP',
  Brand: 'B',
  Category: 'C',
  Manufacturer: 'M'
};

// Colors matching the Design System HSL
const colorMap = {
  Product: 'hsl(263, 90%, 62%)',
  Brand: 'hsl(184, 90%, 45%)',
  Category: 'hsl(290, 85%, 60%)'
};

// Helper to extract node type/label defensively and map to system-supported filter keys
function getNodeType(node) {
  if (!node || !node.labels || node.labels.length === 0) return 'Product';
  const rawLabel = node.labels[0];
  if (typeof rawLabel !== 'string') return 'Product';
  const lower = rawLabel.toLowerCase();
  if (lower === 'brand') return 'Brand';
  if (lower === 'category') return 'Category';
  if (lower === 'product') return 'Product';
  return rawLabel;
}

// 2. Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initD3Canvas();
  bindUIEvents();
  checkDatabasesStatus();
  fetchGraphData();
  fetchCategoryHierarchy();
  fetchBrandsList();
  initCopilotChat();
  initTypeaheadControllers();
  initRecommendationsController();
});

// Check postgres & neo4j connection status and counts
async function checkDatabasesStatus() {
  try {
    const res = await fetch('/api/db-status');
    const data = await res.json();

    // Postgres status
    const pgInd = document.getElementById('pg-indicator');
    if (data.postgres.connected) {
      pgInd.textContent = 'ONLINE';
      pgInd.className = 'status-indicator online';
    } else {
      pgInd.textContent = 'OFFLINE';
      pgInd.className = 'status-indicator offline';
    }

    // Neo4j status
    const neoInd = document.getElementById('neo-indicator');
    if (data.neo4j.connected) {
      neoInd.textContent = 'ONLINE';
      neoInd.className = 'status-indicator online';
      
      // Update statistics metrics in sidebar
      document.getElementById('metric-products').textContent = data.neo4j.counts.Product || 0;
      document.getElementById('metric-brands').textContent = data.neo4j.counts.Brand || 0;
      document.getElementById('metric-categories').textContent = data.neo4j.counts.Category || 0;
    } else {
      neoInd.textContent = 'OFFLINE';
      neoInd.className = 'status-indicator offline';
    }

    // Gemini/LLM status
    const geminiInd = document.getElementById('gemini-indicator');
    const llm = data.llm || (data.gemini ? {
      activeProvider: 'gemini',
      apiKeyPresent: data.gemini.apiKeyPresent,
      nlqEnabled: data.gemini.nlqEnabled,
      providers: {
        gemini: { nlqModel: 'gemini-3.5-flash' },
        openai: { nlqModel: 'gpt-5.5' },
        anthropic: { nlqModel: 'claude-opus-4-8' }
      }
    } : null);

    if (llm) {
      const isLlmActive = llm.apiKeyPresent && llm.nlqEnabled;
      state.geminiEnabled = isLlmActive;
      
      const providerName = llm.activeProvider.toUpperCase();
      // Dynamically align UX headers and descriptions to match active AI provider
      const statusLabel = document.querySelector('#gemini-status span');
      if (statusLabel) statusLabel.textContent = 'AI NLQ:';

      const modeBtn = document.getElementById('mode-gemini-btn');
      if (modeBtn) modeBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI NLQ`;

      const warningAlertSpan = document.querySelector('#gemini-warning-alert span');
      if (warningAlertSpan) warningAlertSpan.textContent = 'AI API is disabled for NLQ. Searches will execute via keyword fallback parser.';

      const loadingHeader = document.querySelector('#gemini-loading-overlay h3');
      if (loadingHeader) loadingHeader.textContent = 'AI is analyzing the knowledge graph...';

      const previewBadgeSpan = document.querySelector('#cypher-preview-badge .badge-text span');
      if (previewBadgeSpan) {
        previewBadgeSpan.innerHTML = `AI Cypher: <code id="cypher-preview-code">${state.geminiCypher || 'MATCH (n) ...'}</code>`;
      }

      if (geminiInd) {
        if (isLlmActive) {
          geminiInd.textContent = `${providerName} ONLINE`;
          geminiInd.className = 'status-indicator online';
        } else {
          geminiInd.textContent = `${providerName} DISABLED`;
          geminiInd.className = 'status-indicator warning';
        }
      }

      // Dynamically populate model selection dropdowns based on configured models
      const modelSelect = document.getElementById('nlq-model-select');
      const copilotModelSelect = document.getElementById('copilot-model-select');
      if (llm.providers) {
        const geminiModel = llm.providers.gemini.nlqModel;
        const openaiModel = llm.providers.openai.nlqModel;
        const anthropicModel = llm.providers.anthropic.nlqModel;
        
        const optionsHtml = `
          <option value="${geminiModel}">Gemini: ${geminiModel}</option>
          <option value="${openaiModel}">OpenAI: ${openaiModel} (Premium)</option>
          <option value="gpt-4o-mini">OpenAI: gpt-4o-mini (Fast)</option>
          <option value="${anthropicModel}">Anthropic: ${anthropicModel} (Premium)</option>
          <option value="claude-haiku-4-5-20251001">Anthropic: claude-haiku-4-5 (Fast)</option>
        `;
        
        if (modelSelect) {
          modelSelect.innerHTML = optionsHtml;
        }
        if (copilotModelSelect) {
          copilotModelSelect.innerHTML = optionsHtml;
        }
        
        // Select active provider's model by default
        const defaultModel = llm.providers[llm.activeProvider].nlqModel;
        if (modelSelect) modelSelect.value = defaultModel;
        if (copilotModelSelect) copilotModelSelect.value = defaultModel;
      }
    } else {
      state.geminiEnabled = false;
      if (geminiInd) {
        geminiInd.textContent = 'OFFLINE';
        geminiInd.className = 'status-indicator offline';
      }
    }
  } catch (err) {
    console.error('Status check error:', err);
  }
}

// 3. D3.js Force Directed Layout Setup
function initD3Canvas() {
  const container = document.getElementById('graph-canvas');
  container.innerHTML = ''; // clear initial indicators

  svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .style('background', 'transparent');

  g = svg.append('g').attr('class', 'main-draw-group');

  // SVG Marker Defs for link direction arrows
  const defs = svg.append('defs');
  const relTypes = ['COMPETES_WITH', 'SUBSTITUTE_FOR', 'COMPLEMENTARY_TO', 'MANUFACTURED_BY', 'BELONGS_TO', 'PARENT_CATEGORY'];
  
  relTypes.forEach(type => {
    defs.append('marker')
      .attr('id', `arrow-${type}`)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22) // Place arrow head at node boundary (node r=14 + buffer)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L10,0L0,4')
      .attr('fill', getLinkColor(type));
  });

  // Zoom behavior setup
  zoomBehavior = d3.zoom()
    .scaleExtent([0.15, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoomBehavior);

  // Setup force-directed simulation
  simulation = d3.forceSimulation()
    .force('charge', d3.forceManyBody().strength(-150))
    .force('center', d3.forceCenter(container.clientWidth / 2, container.clientHeight / 2))
    .force('collide', d3.forceCollide().radius(32))
    .force('link', d3.forceLink().id(d => d.id).distance(d => {
      if (d.type === 'MANUFACTURED_BY') return 90;
      if (d.type === 'BELONGS_TO') return 80;
      return 120;
    }));
}

function getLinkColor(type) {
  if (type === 'COMPETES_WITH') return 'hsl(330, 90%, 55%)';
  if (type === 'SUBSTITUTE_FOR') return 'hsl(196, 95%, 50%)';
  if (type === 'COMPLEMENTARY_TO') return 'hsl(142, 85%, 45%)';
  if (type === 'MANUFACTURED_BY') return 'rgba(6, 182, 212, 0.45)';
  if (type === 'BELONGS_TO') return 'rgba(217, 70, 239, 0.4)';
  if (type === 'PARENT_CATEGORY') return 'rgba(217, 70, 239, 0.25)';
  return 'rgba(255,255,255,0.15)';
}

// Fetch complete Neo4j Graph schema
async function fetchGraphData() {
  try {
    const res = await fetch('/api/graph');
    const graph = await res.json();
    
    state.allNodes = graph.nodes;
    state.allLinks = graph.links;

    console.log(`Loaded Graph: ${state.allNodes.length} nodes, ${state.allLinks.length} links.`);
    applyGraphFilters();
    populateFormSelects();
  } catch (err) {
    showToast('Failed to fetch Neo4j graph data.', 'error');
  }
}

// 4. Ingestion Filter & Render Loop
function applyGraphFilters() {
  const getLinkId = (endpoint) => (endpoint && typeof endpoint === 'object') ? endpoint.id : endpoint;

  // A. Node Filtering
  state.filteredNodes = state.allNodes.filter(node => {
    const label = getNodeType(node);
    
    // Check type toggle
    if (state.filters[label] !== undefined && !state.filters[label]) return false;

    // Check search term query
    if (state.activeSearchQuery) {
      const q = state.activeSearchQuery.toLowerCase();
      const name = (node.properties.name || '').toLowerCase();
      const brand = (node.properties.brand || '').toLowerCase();
      const gtin = (node.properties.gtin || '').toLowerCase();
      if (!name.includes(q) && !brand.includes(q) && !gtin.includes(q)) return false;
    }

    // Check Category Explorer focus path
    if (state.activeCategoryFilterId && label === 'Product') {
      const belongs = state.allLinks.some(link => {
        const srcId = getLinkId(link.source);
        const tgtId = getLinkId(link.target);
        return srcId === node.id && 
               link.type === 'BELONGS_TO' && 
               tgtId === state.activeCategoryFilterId;
      });
      if (!belongs) return false;
    }

    // Check Brand Explorer focus path
    if (state.activeBrandFilterId && label === 'Product') {
      const manufactures = state.allLinks.some(link => {
        const srcId = getLinkId(link.source);
        const tgtId = getLinkId(link.target);
        return srcId === node.id && 
               link.type === 'MANUFACTURED_BY' && 
               tgtId === state.activeBrandFilterId;
      });
      if (!manufactures) return false;
    }

    return true;
  });

  // B. Edge Filtering
  const nodeIds = new Set(state.filteredNodes.map(n => n.id));
  state.filteredLinks = state.allLinks.filter(link => {
    // Both endpoints must exist in active node set
    const srcId = getLinkId(link.source);
    const tgtId = getLinkId(link.target);
    if (!nodeIds.has(srcId) || !nodeIds.has(tgtId)) return false;
    // Check relationship class checkbox
    if (link.type in state.relFilters && !state.relFilters[link.type]) return false;
    return true;
  });

  renderGraph();
}

function renderGraph() {
  g.selectAll('*').remove();

  // Create Paths
  const edge = g.append('g')
    .attr('class', 'edges-group')
    .selectAll('path')
    .data(state.filteredLinks, d => d.id)
    .enter()
    .append('path')
    .attr('class', d => `edge-path ${d.type}`)
    .attr('marker-end', d => `url(#arrow-${d.type})`);

  // Create Nodes
  const node = g.append('g')
    .attr('class', 'nodes-group')
    .selectAll('g')
    .data(state.filteredNodes, d => d.id)
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .call(d3.drag()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded))
    .on('click', (event, d) => {
      event.stopPropagation();
      selectNode(d);
    })
    .on('mouseover', (event, d) => highlightNodeNeighbors(d))
    .on('mouseout', () => clearHighlights());

  // Circle background
  node.append('circle')
    .attr('class', d => `node-circle ${getNodeType(d)}`)
    .attr('r', 15);

  // Centered Icon Character
  node.append('text')
    .attr('class', 'node-icon-text')
    .text(d => iconMap[getNodeType(d)] || '\uf0ab');

  // Label text under circle
  node.append('text')
    .attr('class', 'node-label')
    .attr('dy', 26)
    .attr('text-anchor', 'middle')
    .text(d => d.properties.name || d.id);

  // Update simulation datasets
  simulation.nodes(state.filteredNodes);
  simulation.force('link').links(state.filteredLinks);
  
  // Resets layout stabilization
  if (state.physicsEnabled) {
    simulation.alpha(0.3).restart();
  } else {
    simulation.alpha(0);
  }

  // Draw loop step
  simulation.on('tick', () => {
    edge.attr('d', d => {
      const s = d.source;
      const t = d.target;
      return `M${s.x},${s.y}L${t.x},${t.y}`;
    });

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

// 5. Dynamic Node Interactive Focus Details
function highlightNodeNeighbors(focusedNode) {
  const getLinkId = (endpoint) => (endpoint && typeof endpoint === 'object') ? endpoint.id : endpoint;
  const connectedNodeIds = new Set([focusedNode.id]);
  const connectedEdgeIds = new Set();

  state.filteredLinks.forEach(link => {
    const srcId = getLinkId(link.source);
    const tgtId = getLinkId(link.target);
    if (srcId === focusedNode.id) {
      connectedNodeIds.add(tgtId);
      connectedEdgeIds.add(link.id);
    } else if (tgtId === focusedNode.id) {
      connectedNodeIds.add(srcId);
      connectedEdgeIds.add(link.id);
    }
  });

  // Dim rest of network elements
  d3.selectAll('.node-group').classed('dimmed', d => !connectedNodeIds.has(d.id));
  d3.selectAll('.edge-path').classed('dimmed', d => !connectedEdgeIds.has(d.id));

  // Glow direct focused node
  d3.selectAll('.node-group').classed('highlighted', d => d.id === focusedNode.id);
  d3.selectAll('.edge-path').classed('highlighted', d => connectedEdgeIds.has(d.id));
}

function clearHighlights() {
  d3.selectAll('.node-group').classed('dimmed', false).classed('highlighted', false);
  d3.selectAll('.edge-path').classed('dimmed', false).classed('highlighted', false);
}

// 6. Right Inspector Panel Updates
function selectNode(node) {
  state.selectedNode = node;
  
  // Highlight node circle borders visually on SVG
  d3.selectAll('.node-circle').style('stroke', null);
  d3.select(`.node-group`)
    .filter(d => d.id === node.id)
    .select('.node-circle')
    .style('stroke', '#fff')
    .style('stroke-width', '4px');

  const defaultMsg = document.getElementById('inspector-default-message');
  const content = document.getElementById('inspector-content');
  
  defaultMsg.classList.add('hide');
  content.classList.remove('hide');

  const label = getNodeType(node);
  document.getElementById('node-type-label').className = `node-type-tag ${label}`;
  document.getElementById('node-type-label').textContent = label;
  document.getElementById('node-name-label').textContent = node.properties.name || node.id;
  
  // Setup Subtitle Info
  const subLabel = document.getElementById('node-subtitle-label');
  if (label === 'Product') {
    // Try to find the brand manufacture relation to show (defensively check for string or object in D3 simulation)
    const mfgLink = state.allLinks.find(link => {
      const srcId = (link.source && typeof link.source === 'object') ? link.source.id : link.source;
      return srcId === node.id && link.type === 'MANUFACTURED_BY';
    });
    let brandName = 'Generic Brand';
    if (mfgLink) {
      const tgtId = (mfgLink.target && typeof mfgLink.target === 'object') ? mfgLink.target.id : mfgLink.target;
      const brandNode = state.allNodes.find(n => n.id === tgtId);
      brandName = brandNode ? brandNode.properties.name : tgtId;
    }
    subLabel.textContent = `Brand: ${brandName}`;

    // Fetch live product details to resolve the "Generic Brand" fallback and enrich metadata
    const productId = node.properties?.id || node.id;
    fetch(`/api/products/${productId}`)
      .then(res => res.json())
      .then(data => {
        const currentSelectedId = state.selectedNode?.properties?.id || state.selectedNode?.id;
        if (currentSelectedId === productId) {
          if (data && data.brand && data.brand.name) {
            subLabel.textContent = `Brand: ${data.brand.name}`;
          } else {
            subLabel.textContent = 'Brand: Generic Brand';
          }
          // Enrich metadata grid with latest server-side database details
          compileProductMetadata(node, data);
        }
      })
      .catch(err => {
        console.error('Error fetching dynamic product details:', err);
      });
  } else {
    subLabel.textContent = `Unique Graph ID: ${node.id}`;
  }

  // Toggle dynamic detail panes based on type
  const priceSec = document.getElementById('inspector-price-section');
  const relSec = document.getElementById('inspector-relations-section');
  const genSec = document.getElementById('inspector-general-section');
  const ecoSec = document.getElementById('inspector-ecosystem-section');

  // Reset custom sub-sections visibility
  document.getElementById('brand-competitors-section').classList.add('hide');
  document.getElementById('category-relations-section').classList.add('hide');

  if (label === 'Product') {
    priceSec.classList.remove('hide');
    relSec.classList.remove('hide');
    genSec.classList.add('hide');
    ecoSec.classList.add('hide');

    compileProductMetadata(node);
    fetchRelatedProductsIntelligence(node);
  } else {
    priceSec.classList.add('hide');
    relSec.classList.add('hide');
    genSec.classList.remove('hide');
    ecoSec.classList.remove('hide');

    compileGeneralProperties(node);
    compileEcosystemConnections(node);

    if (label === 'Brand') {
      fetchBrandCompetitorsIntelligence(node);
    } else if (label === 'Category') {
      fetchCategoryRelationsIntelligence(node);
    }
  }
}

// Compile Product Catalog Metadata
function compileProductMetadata(productNode, fetchedData = null) {
  const grid = document.getElementById('product-metadata-grid');
  grid.innerHTML = '';

  const props = productNode.properties || {};
  const data = fetchedData || {};

  const priceVal = data.price !== undefined ? data.price : props.price;
  const gtinVal = data.gtin || props.gtin;
  const sizeVal = data.size !== undefined ? data.size : props.size;
  const measureVal = data.measure || props.measure;
  const valState = data.validationState || props.validationState;

  const msrpVal = parseFloat(priceVal || 0);
  const items = [
    { name: 'MSRP', val: msrpVal > 0 ? `$${msrpVal.toFixed(2)}` : 'N/A' },
    { name: 'GTIN14 / SKU', val: gtinVal || 'N/A' },
    { name: 'Package Size', val: sizeVal ? `${sizeVal} ${measureVal || ''}` : 'N/A' },
    { name: 'Validation State', val: valState || 'VALID' }
  ];

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'property-item';
    div.innerHTML = `
      <span class="prop-name">${item.name}</span>
      <span class="prop-val">${item.val}</span>
    `;
    grid.appendChild(div);
  });
}

// Fetch Related Products (Competitors, Complements, Siblings) Dynamically from Neo4j
async function fetchRelatedProductsIntelligence(productNode) {
  const compList = document.getElementById('inspector-competitors-list');
  const subList = document.getElementById('inspector-substitutes-list');
  const complementList = document.getElementById('inspector-complements-list');

  compList.innerHTML = `<li class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Finding category rivals...</li>`;
  subList.innerHTML = `<li class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Finding packaging alternatives...</li>`;
  complementList.innerHTML = `<li class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Finding companions...</li>`;

  try {
    const res = await fetch(`/api/products/${productNode.properties?.id || productNode.id}/related`);
    const data = await res.json();

    compList.innerHTML = '';
    subList.innerHTML = '';
    complementList.innerHTML = '';

    // A. Render Category Rivals (Competitors)
    if (data.competitors && data.competitors.length > 0) {
      data.competitors.forEach(rival => {
        const li = document.createElement('li');
        li.className = 'hover-item';
        li.onclick = () => selectNodeFromId(rival.id);
        const priceStr = rival.price > 0 ? ` ($${rival.price.toFixed(2)})` : '';
        const badgeHtml = rival.matchScore ? `<span class="match-badge"><i class="fa-solid fa-sparkles" style="font-size: 8px; margin-right: 2px;"></i> ${rival.matchScore}% Match</span>` : '';
        li.innerHTML = `
          <span class="rel-item-name">${rival.name}${priceStr}${badgeHtml}</span>
          <span class="rel-item-meta">Rival <i class="fa-solid fa-chevron-right"></i></span>
        `;
        compList.appendChild(li);
      });
    } else {
      compList.innerHTML = `<li class="text-muted text-center py-2">No competing brands mapped.</li>`;
    }

    // B. Render Pack/Flavor Siblings (Mapped as substitutes counterpart!)
    if (data.siblings && data.siblings.length > 0) {
      data.siblings.forEach(sib => {
        const li = document.createElement('li');
        li.className = 'hover-item';
        li.onclick = () => selectNodeFromId(sib.id);
        const priceStr = sib.price > 0 ? ` ($${sib.price.toFixed(2)})` : '';
        li.innerHTML = `
          <span class="rel-item-name">${sib.name}${priceStr}</span>
          <span class="rel-item-meta">Size Alternative <i class="fa-solid fa-chevron-right"></i></span>
        `;
        subList.appendChild(li);
      });
    } else {
      subList.innerHTML = `<li class="text-muted text-center py-2">No product size variations.</li>`;
    }

    // C. Render Companions (Complements)
    if (data.complements && data.complements.length > 0) {
      data.complements.forEach(comp => {
        const li = document.createElement('li');
        li.className = 'hover-item';
        li.onclick = () => selectNodeFromId(comp.id);
        const priceStr = comp.price > 0 ? ` ($${comp.price.toFixed(2)})` : '';
        const badgeHtml = comp.matchScore ? `<span class="match-badge companion-badge"><i class="fa-solid fa-sparkles" style="font-size: 8px; margin-right: 2px;"></i> ${comp.matchScore}% Likely</span>` : '';
        li.innerHTML = `
          <span class="rel-item-name">${comp.name}${priceStr}${badgeHtml}</span>
          <span class="rel-item-meta">Companion <i class="fa-solid fa-chevron-right"></i></span>
        `;
        complementList.appendChild(li);
      });
    } else {
      complementList.innerHTML = `<li class="text-muted text-center py-2">No complementary accessories.</li>`;
    }

  } catch (err) {
    console.error('Failed to query related products:', err);
    compList.innerHTML = `<li class="text-muted text-center py-2 text-danger">Query error.</li>`;
    subList.innerHTML = `<li class="text-muted text-center py-2 text-danger">Query error.</li>`;
    complementList.innerHTML = `<li class="text-muted text-center py-2 text-danger">Query error.</li>`;
  }
}

// Helper to select and highlight a node by its ID from related lists
async function selectNodeFromId(nodeId) {
  const targetNode = state.allNodes.find(n => n.id === nodeId || (n.properties && n.properties.id === nodeId));
  if (targetNode) {
    // Zoom/Center camera smoothly to this node on D3 canvas
    const parent = svg.node().parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    
    const transform = d3.zoomIdentity
      .translate(w / 2 - targetNode.x, h / 2 - targetNode.y)
      .scale(1.2);
      
    svg.transition().duration(400).call(zoomBehavior.transform, transform);
    selectNode(targetNode);
  } else {
    // 🚀 Dynamic Graph Expansion: Node is not on canvas, fetch its neighborhood in real-time!
    showToast('Expanding graph visual network...', 'warning');
    
    try {
      const isInternalId = !isNaN(Number(nodeId));
      const cypher = `MATCH (n) WHERE n.id = "${nodeId}" OR id(n) = ${isInternalId ? Number(nodeId) : -1} OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 50`;
      
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cypher })
      });
      
      const data = await res.json();
      if (!data.nodes || data.nodes.length === 0) {
        showToast('Node not found in database.', 'error');
        return;
      }

      // Merge new nodes into state.allNodes (avoid duplicates)
      const existingNodeIds = new Set(state.allNodes.map(n => n.id));
      const parent = svg.node().parentElement;
      
      // Position the new cluster starting at center, with some random scattering
      data.nodes.forEach(n => {
        if (!existingNodeIds.has(n.id)) {
          n.x = parent.clientWidth / 2 + (Math.random() - 0.5) * 150;
          n.y = parent.clientHeight / 2 + (Math.random() - 0.5) * 150;
          state.allNodes.push(n);
        }
      });

      // Merge new links into state.allLinks (avoid duplicates)
      const existingLinkIds = new Set(state.allLinks.map(l => `${l.source}_${l.target}_${l.type}`));
      data.links.forEach(l => {
        const linkKey = `${l.source}_${l.target}_${l.type}`;
        if (!existingLinkIds.has(linkKey)) {
          state.allLinks.push(l);
        }
      });

      // Trigger D3 graph updates and re-draw force layout
      applyGraphFilters();
      
      // Zoom and center camera on the newly spawned node smoothly after D3 layout updates
      setTimeout(() => {
        const newlyFetchedNode = state.allNodes.find(n => n.id === nodeId || (n.properties && n.properties.id === nodeId));
        if (newlyFetchedNode) {
          const w = parent.clientWidth;
          const h = parent.clientHeight;
          
          const transform = d3.zoomIdentity
            .translate(w / 2 - newlyFetchedNode.x, h / 2 - newlyFetchedNode.y)
            .scale(1.2);
            
          svg.transition().duration(400).call(zoomBehavior.transform, transform);
          selectNode(newlyFetchedNode);
          showToast(`Successfully expanded graph neighborhood to show ${newlyFetchedNode.properties?.name || 'node'}!`, 'success');
        }
      }, 350);

    } catch (err) {
      console.error('Failed to expand graph neighborhood dynamically:', err);
      showToast('Ecosystem traversal failed.', 'error');
    }
  }
}

// Compile general properties grid
function compileGeneralProperties(node) {
  const grid = document.getElementById('node-properties-grid');
  grid.innerHTML = '';

  const props = node.properties;
  const skipKeys = ['name', 'id'];

  let count = 0;
  for (const k in props) {
    if (skipKeys.includes(k)) continue;
    count++;
    const item = document.createElement('div');
    item.className = 'property-item';
    item.innerHTML = `
      <span class="prop-name">${k}</span>
      <span class="prop-val">${props[k]}</span>
    `;
    grid.appendChild(item);
  }

  if (count === 0) {
    grid.innerHTML = `<div class="text-muted text-center">No metadata properties defined.</div>`;
  }
}// Compile Ecosystem list of connections for Brand/Source/Category (Dynamic DB Fetch fallback)
async function compileEcosystemConnections(node) {
  const list = document.getElementById('node-ecosystem-list');
  list.innerHTML = `<li class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Loading catalog products...</li>`;

  const label = getNodeType(node);
  const targetRel = label === 'Brand' ? 'MANUFACTURED_BY' : 'BELONGS_TO';
  const getLinkId = (endpoint) => (endpoint && typeof endpoint === 'object') ? endpoint.id : endpoint;

  // 1. Try to find products already loaded on the active canvas
  const connections = state.allLinks.filter(link => {
    const tgtId = getLinkId(link.target);
    return tgtId === node.id && link.type === targetRel;
  });

  if (connections.length > 0) {
    list.innerHTML = '';
    connections.forEach(link => {
      const srcId = getLinkId(link.source);
      const productNode = state.allNodes.find(n => n.id === srcId);
      if (!productNode) return;
      
      const name = productNode.properties.name || srcId;
      const priceVal = parseFloat(productNode.properties.price || 0);
      const priceStr = priceVal > 0 ? ` ($${priceVal.toFixed(2)})` : '';

      const li = document.createElement('li');
      li.className = 'hover-item';
      li.onclick = () => selectNode(productNode);
      li.innerHTML = `
        <span><i class="fa-solid fa-box text-primary mr-2"></i> ${name}</span>
        <span class="text-muted">${priceStr} <i class="fa-solid fa-chevron-right"></i></span>
      `;
      list.appendChild(li);
    });
    return;
  }

  // 2. Fallback: Dynamically fetch connected products from the Neo4j database in real-time!
  try {
    const customId = node.properties?.id || node.id;
    const isInternalId = !isNaN(Number(customId));
    let cypher = '';
    if (label === 'Brand') {
      cypher = `MATCH (p:Product)-[r:MANUFACTURED_BY]->(b:Brand) WHERE b.id = "${customId}" OR id(b) = ${isInternalId ? Number(customId) : -1} RETURN p, r, b LIMIT 15`;
    } else {
      cypher = `MATCH (p:Product)-[r:BELONGS_TO]->(c:Category) WHERE c.id = "${customId}" OR id(c) = ${isInternalId ? Number(customId) : -1} RETURN p, r, c LIMIT 15`;
    }

    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: cypher })
    });
    const data = await res.json();
    list.innerHTML = '';

    const products = data.nodes?.filter(n => n.labels?.includes('Product')) || [];
    if (products.length > 0) {
      products.forEach(productNode => {
        const name = productNode.properties.name || productNode.id;
        const priceVal = parseFloat(productNode.properties.price || 0);
        const priceStr = priceVal > 0 ? ` ($${priceVal.toFixed(2)})` : '';

        const li = document.createElement('li');
        li.className = 'hover-item';
        // When clicking, dynamically load and expand this product's cluster on active D3 canvas!
        li.onclick = () => selectNodeFromId(productNode.properties?.id || productNode.id);
        li.innerHTML = `
          <span><i class="fa-solid fa-box text-primary mr-2"></i> ${name}</span>
          <span class="text-muted">${priceStr} <i class="fa-solid fa-chevron-right"></i></span>
        `;
        list.appendChild(li);
      });
    } else {
      list.innerHTML = `<li class="text-muted text-center py-2">No connected catalog products.</li>`;
    }
  } catch (err) {
    console.error('Failed to fetch dynamic ecosystem connections:', err);
    list.innerHTML = `<li class="text-muted text-center py-2 text-danger">Failed to load catalog.</li>`;
  }
};

// 7. Expandable Category Hierarchical Tree
async function fetchCategoryHierarchy() {
  try {
    const res = await fetch('/api/categories');
    const categories = await res.json();
    
    renderCategoryTree(categories);
  } catch (err) {
    console.error('Failed to load categories hierarchy', err);
  }
}

function renderCategoryTree(categories) {
  const container = document.getElementById('category-tree-container');
  container.innerHTML = '';

  if (categories.length === 0) {
    container.innerHTML = `<div class="text-muted text-center py-2">No categories defined.</div>`;
    return;
  }

  const itemMap = new Map();
  const roots = [];

  categories.forEach(c => {
    itemMap.set(c.id, { ...c, children: [] });
  });

  categories.forEach(c => {
    const mapped = itemMap.get(c.id);
    if (c.parentId && itemMap.has(c.parentId)) {
      itemMap.get(c.parentId).children.push(mapped);
    } else {
      roots.push(mapped);
    }
  });

  function buildHtml(node) {
    const div = document.createElement('div');
    div.className = 'tree-node';

    const header = document.createElement('div');
    header.className = 'tree-node-header';
    if (state.activeCategoryFilterId === node.id) {
      header.classList.add('active');
    }
    header.onclick = (e) => {
      e.stopPropagation();
      toggleCategoryFilter(node.id, node.name);
    };

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'tree-toggle-icon';
    if (node.children.length > 0) {
      toggleIcon.innerHTML = `<i class="fa-solid fa-caret-right"></i>`;
      toggleIcon.onclick = (e) => {
        e.stopPropagation();
        const childContainer = div.querySelector('.tree-node-children');
        const icon = header.querySelector('.tree-toggle-icon');
        
        childContainer.classList.toggle('expanded');
        icon.classList.toggle('expanded');
      };
    }

    header.appendChild(toggleIcon);

    const folderIcon = document.createElement('span');
    folderIcon.className = 'tree-folder-icon';
    folderIcon.innerHTML = `<span class="legend-initial legend-category" style="width: 16px; height: 16px; font-size: 8px; border-radius: 3px; margin-right: 4px;">C</span>`;
    header.appendChild(folderIcon);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name;
    header.appendChild(nameSpan);

    div.appendChild(header);

    if (node.children.length > 0) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-node-children';
      node.children.forEach(child => {
        childrenDiv.appendChild(buildHtml(child));
      });
      div.appendChild(childrenDiv);
    }

    return div;
  }

  roots.forEach(root => {
    container.appendChild(buildHtml(root));
  });
}

function toggleCategoryFilter(categoryId, categoryName) {
  const activeBadge = document.getElementById('active-filter-indicator');
  const activeName = document.getElementById('active-filter-name');
  const resetBtn = document.getElementById('reset-category-filter');

  if (state.activeCategoryFilterId === categoryId) {
    state.activeCategoryFilterId = null;
    activeBadge.classList.add('hide');
    resetBtn.classList.add('hide');
  } else {
    state.activeCategoryFilterId = categoryId;
    activeName.textContent = categoryName;
    activeBadge.classList.remove('hide');
    resetBtn.classList.remove('hide');
  }

  document.querySelectorAll('.tree-node-header').forEach(el => el.classList.remove('active'));
  
  applyGraphFilters();
  fetchCategoryHierarchy();
}

// 8. Dynamic UI Event Bindings
function bindUIEvents() {
  // Sidebar Tab Switching Logic
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = async () => {
      // Deactivate all tab buttons and content sections
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Activate clicked button
      btn.classList.add('active');
      
      // Activate matching content section
      const tabId = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(tabId);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      if (tabId === 'recommendations-tab') {
        loadRecommendations();
      }

      // 🌟 REFRESH SCREEN: Reset all filters upon tab switching for a fresh interactive canvas context!
      state.activeCategoryFilterId = null;
      state.activeBrandFilterId = null;
      state.activeSearchQuery = '';

      // Reset indicators and controls in the UI
      const catReset = document.getElementById('reset-category-filter');
      if (catReset) catReset.classList.add('hide');
      const brandReset = document.getElementById('reset-brand-filter');
      if (brandReset) brandReset.classList.add('hide');
      const activeBadge = document.getElementById('active-filter-indicator');
      if (activeBadge) activeBadge.classList.add('hide');
      const clearBtn = document.getElementById('search-clear-btn');
      if (clearBtn) clearBtn.style.display = 'none';
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = '';
      const cypherPreview = document.getElementById('cypher-preview-badge');
      if (cypherPreview) cypherPreview.classList.add('hide');

      // Clear visual list highlights
      document.querySelectorAll('.brand-list-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tree-node-header').forEach(el => el.classList.remove('active'));

      // Re-fetch category and brand counts and redraw the default clean graph JIT!
      fetchCategoryHierarchy();
      fetchBrandsList();
      await fetchGraphData();
    };
  });

  // Database ETL Sync
  document.getElementById('sync-db-btn').onclick = async () => {
    const btn = document.getElementById('sync-db-btn');
    const icon = btn.querySelector('.sync-icon');
    
    icon.classList.add('fa-spin');
    btn.disabled = true;
    showToast('Starting PostgreSQL view data ingestion pipeline...', 'warning');

    try {
      const res = await fetch('/api/ingest', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        showToast('Neo4j Graph synchronized successfully!', 'success');
        checkDatabasesStatus();
        fetchGraphData();
      } else {
        showToast(`Ingestion failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast('Backend ingestion timeout or connection failure.', 'error');
    } finally {
      icon.classList.remove('fa-spin');
      btn.disabled = false;
    }
  };

  // Search Engine & Gemini AI NLQ Console Input Binds
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('search-clear-btn');
  const modeKeywordBtn = document.getElementById('mode-keyword-btn');
  const modeGeminiBtn = document.getElementById('mode-gemini-btn');
  const searchInputBox = document.getElementById('search-input-box');
  const searchBarIcon = document.getElementById('search-bar-icon');
  const geminiPillsList = document.getElementById('gemini-pills-list');
  const loadingOverlay = document.getElementById('gemini-loading-overlay');
  const cypherPreviewBadge = document.getElementById('cypher-preview-badge');
  const cypherPreviewCode = document.getElementById('cypher-preview-code');
  const cypherBadgeRunBtn = document.getElementById('cypher-badge-run-btn');
  const cypherExplanationText = document.getElementById('cypher-explanation-text');

  // Toggle to Standard Keyword Filtering Mode
  modeKeywordBtn.onclick = () => {
    state.searchMode = 'keyword';
    modeKeywordBtn.classList.add('active');
    modeGeminiBtn.classList.remove('active');
    searchInputBox.classList.remove('gemini-active');
    geminiPillsList.classList.add('hide');
    cypherPreviewBadge.classList.add('hide');
    if (cypherExplanationText) cypherExplanationText.classList.add('hide');

    const warningAlert = document.getElementById('gemini-warning-alert');
    if (warningAlert) warningAlert.classList.add('hide');

    const modelSelectBox = document.getElementById('model-select-box');
    if (modelSelectBox) modelSelectBox.classList.add('hide');

    searchBarIcon.className = 'fa-solid fa-magnifying-glass search-inner-icon';
    searchInput.placeholder = 'Search products, brands, sources...';
    searchInput.value = state.activeSearchQuery;
    
    applyGraphFilters();
  };

  // Toggle to Advanced Gemini AI Natural Language Querying Mode
  modeGeminiBtn.onclick = () => {
    state.searchMode = 'gemini';
    modeKeywordBtn.classList.remove('active');
    modeGeminiBtn.classList.add('active');
    searchInputBox.classList.add('gemini-active');
    geminiPillsList.classList.remove('hide');

    const warningAlert = document.getElementById('gemini-warning-alert');
    const modelSelectBox = document.getElementById('model-select-box');

    if (warningAlert) {
      if (!state.geminiEnabled) {
        warningAlert.classList.remove('hide');
        if (modelSelectBox) modelSelectBox.classList.add('hide');
        searchInput.placeholder = "Ask fallback matcher: e.g. 'Louisiana Fish Fry'...";
      } else {
        warningAlert.classList.add('hide');
        if (modelSelectBox) modelSelectBox.classList.remove('hide');
        searchInput.placeholder = "Ask AI Assistant: e.g. 'Show Pepsi competitors'...";
      }
    } else {
      if (modelSelectBox && state.geminiEnabled) modelSelectBox.classList.remove('hide');
      searchInput.placeholder = "Ask AI Assistant: e.g. 'Show Pepsi competitors'...";
    }
    
    // Clear standard search filters during AI execution
    state.activeSearchQuery = '';
    applyGraphFilters();
  };

  let autocompleteTimeout = null;

  // Handle live inputs (standard filter on typing, reveal clear buttons, trigger typeahead)
  searchInput.addEventListener('input', (e) => {
    if (state.searchMode === 'keyword') {
      state.activeSearchQuery = e.target.value;
      applyGraphFilters();

      const q = e.target.value.trim();
      clearTimeout(autocompleteTimeout);
      if (q.length >= 2) {
        autocompleteTimeout = setTimeout(() => {
          fetchAutocompleteSuggestions(q);
        }, 200);
      } else {
        hideAutocompleteDropdown();
      }
    }
    
    if (e.target.value) {
      clearSearchBtn.style.display = 'block';
    } else {
      clearSearchBtn.style.display = 'none';
      if (state.searchMode === 'keyword') {
        state.activeSearchQuery = '';
        fetchGraphData();
      }
    }
  });

  // Execute Search on pressing Enter
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const queryVal = searchInput.value.trim();
      hideAutocompleteDropdown();
      
      if (state.searchMode === 'gemini') {
        if (!queryVal) return showToast('Please enter a natural language question.', 'warning');
        await triggerGeminiAISearch(queryVal);
      } else {
        if (!queryVal) {
          await fetchGraphData();
          return;
        }
        await triggerGlobalKeywordSearch(queryVal);
      }
    }
  });

  // Hide autocomplete when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (dropdown && e.target !== searchInput && e.target !== dropdown && !dropdown.contains(e.target)) {
      hideAutocompleteDropdown();
    }
  });

  function hideAutocompleteDropdown() {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (dropdown) {
      dropdown.classList.add('hide');
      dropdown.innerHTML = '';
    }
  }

  async function fetchAutocompleteSuggestions(queryVal) {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (!dropdown) return;

    try {
      const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(queryVal)}`);
      const suggestions = await res.json();

      if (!res.ok || !Array.isArray(suggestions) || suggestions.length === 0) {
        hideAutocompleteDropdown();
        return;
      }

      dropdown.innerHTML = '';
      suggestions.forEach(item => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        
        // Highlight matching text case-insensitively
        const escaped = queryVal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        const highlightedName = item.name.replace(regex, `<strong style="color:var(--accent); text-shadow: 0 0 8px rgba(6, 182, 212, 0.4);">$1</strong>`);
        
        div.innerHTML = `
          <span><i class="fa-solid fa-magnifying-glass text-muted mr-2" style="font-size:10px; opacity:0.6;"></i> ${highlightedName}</span>
          <span class="item-type ${item.type}">${item.type}</span>
        `;
        
        div.onclick = async (e) => {
          e.stopPropagation();
          searchInput.value = item.name;
          clearSearchBtn.style.display = 'block';
          hideAutocompleteDropdown();
          await triggerGlobalKeywordSearch(item.name);
        };
        
        dropdown.appendChild(div);
      });
      
      dropdown.classList.remove('hide');
    } catch (err) {
      console.warn('Autocomplete fetch failed:', err);
    }
  }

  // Core AI Search Traversal Caller
  async function triggerGeminiAISearch(questionText) {
    loadingOverlay.classList.remove('hide');
    
    // Get the selected model from UI dropdown
    const modelSelect = document.getElementById('nlq-model-select');
    const selectedModel = modelSelect ? modelSelect.value : null;

    showToast(`AI is translating prompt using ${selectedModel || 'active model'}...`, 'warning');

    try {
      const res = await fetch('/api/nlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          question: questionText,
          model: selectedModel
        })
      });
      const data = await res.json();

      if (res.ok) {
        showToast(`AI successfully mapped ${data.nodes.length} nodes!`, 'success');
        
        // Load the new sub-graph into visual memory
        state.allNodes = data.nodes;
        state.allLinks = data.links;
        applyGraphFilters();

        // Reveal the floating Cypher preview badge and reasoning explanation
        if (data.translatedCypher) {
          state.geminiCypher = data.translatedCypher;
          cypherPreviewCode.textContent = data.translatedCypher;
          cypherPreviewBadge.classList.remove('hide');

          if (data.explanation && cypherExplanationText) {
            cypherExplanationText.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent); font-size:10px; margin-right:6px;"></i> ${data.explanation}`;
            cypherExplanationText.classList.remove('hide');
          } else if (cypherExplanationText) {
            cypherExplanationText.classList.add('hide');
          }
        } else {
          cypherPreviewBadge.classList.add('hide');
          if (cypherExplanationText) cypherExplanationText.classList.add('hide');
        }
      } else {
        showToast(`AI execution failed: ${data.error}`, 'error');
        cypherPreviewBadge.classList.add('hide');
      }
    } catch (err) {
      showToast('Network timeout connecting to AI service.', 'error');
      cypherPreviewBadge.classList.add('hide');
    } finally {
      loadingOverlay.classList.add('hide');
    }
  }

  // Core Global Keyword Search Caller
  async function triggerGlobalKeywordSearch(keywordText) {
    loadingOverlay.classList.remove('hide');
    showToast(`Searching database globally for "${keywordText}"...`, 'warning');

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(keywordText)}`);
      const data = await res.json();

      if (res.ok) {
        showToast(`Found ${data.nodes.length} matching nodes globally!`, 'success');
        state.allNodes = data.nodes;
        state.allLinks = data.links;
        state.activeSearchQuery = keywordText;
        applyGraphFilters();
      } else {
        showToast(`Search failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast('Network timeout connecting to search service.', 'error');
    } finally {
      loadingOverlay.classList.add('hide');
    }
  }

  // Bind Suggested Prompt Pill Badges
  document.querySelectorAll('.gemini-pill').forEach(pill => {
    pill.onclick = async (e) => {
      const promptText = pill.getAttribute('data-prompt');
      searchInput.value = promptText;
      clearSearchBtn.style.display = 'block';
      
      // Force trigger Gemini AI Search mode
      modeGeminiBtn.onclick();
      await triggerGeminiAISearch(promptText);
    };
  });

  // Bind Cypher Tooltip Badge Runner
  cypherBadgeRunBtn.onclick = () => {
    if (!state.geminiCypher) return;
    
    // Copy to Sandbox editor
    const editor = document.getElementById('cypher-query-input');
    editor.value = state.geminiCypher;

    // Expand Cypher terminal drawer if closed
    const drawer = document.getElementById('cypher-drawer');
    const toggleIcon = document.getElementById('toggle-drawer-btn').querySelector('i');
    
    if (!state.isDrawerExpanded) {
      state.isDrawerExpanded = true;
      drawer.classList.add('expanded');
      toggleIcon.className = 'fa-solid fa-chevron-down';
    }

    // Trigger execute
    document.getElementById('run-cypher-btn').click();
  };

  clearSearchBtn.onclick = async () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    cypherPreviewBadge.classList.add('hide');
    if (cypherExplanationText) cypherExplanationText.classList.add('hide');

    if (state.searchMode === 'keyword') {
      state.activeSearchQuery = '';
      await fetchGraphData();
    }
  };

  // Visibility Checkboxes
  const nodeTypes = ['Product', 'Brand', 'Category'];
  nodeTypes.forEach(type => {
    const chk = document.getElementById(`show-${type.toLowerCase()}-checkbox`);
    chk.addEventListener('change', (e) => {
      state.filters[type] = e.target.checked;
      applyGraphFilters();
    });
  });

  const relTypes = ['COMPETES_WITH', 'SUBSTITUTE_FOR', 'COMPLEMENTARY_TO'];
  relTypes.forEach(type => {
    const chk = document.getElementById(`rel-${getRelCheckSuffix(type)}-checkbox`);
    chk.addEventListener('change', (e) => {
      state.relFilters[type] = e.target.checked;
      applyGraphFilters();
    });
  });

  // Category and Brand reset badge clicking
  document.getElementById('clear-active-filter-badge').onclick = () => {
    if (state.activeCategoryFilterId) toggleCategoryFilter(state.activeCategoryFilterId, '');
    if (state.activeBrandFilterId) toggleBrandFilter(state.activeBrandFilterId, '');
  };
  document.getElementById('reset-category-filter').onclick = () => toggleCategoryFilter(state.activeCategoryFilterId, '');
  document.getElementById('reset-brand-filter').onclick = () => toggleBrandFilter(state.activeBrandFilterId, '');

  // Toolbar Actions
  document.getElementById('zoom-in-btn').onclick = () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.25);
  document.getElementById('zoom-out-btn').onclick = () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 0.85);
  document.getElementById('zoom-fit-btn').onclick = () => {
    const bounds = g.node().getBBox();
    const parent = svg.node().parentElement;
    const fullWidth = parent.clientWidth;
    const fullHeight = parent.clientHeight;
    
    const midX = bounds.x + bounds.width / 2;
    const midY = bounds.y + bounds.height / 2;
    if (bounds.width === 0 || bounds.height === 0) return;
    
    const scale = 0.85 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
    const transform = d3.zoomIdentity
      .translate(fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY)
      .scale(scale);

    svg.transition().duration(500).call(zoomBehavior.transform, transform);
  };

  // Toggle force simulation physics
  const physToggle = document.getElementById('physics-toggle-btn');
  physToggle.onclick = () => {
    state.physicsEnabled = !state.physicsEnabled;
    physToggle.classList.toggle('active');
    
    if (state.physicsEnabled) {
      simulation.alphaTarget(0.1).restart();
      physToggle.querySelector('.fa-bolt').style.display = 'inline-block';
    } else {
      simulation.alphaTarget(0).stop();
      physToggle.querySelector('.fa-bolt').style.display = 'none';
      
      state.filteredNodes.forEach(d => {
        d.fx = d.x;
        d.fy = d.y;
      });
    }
  };

  // Cypher query Drawer toggle
  const drawerHeader = document.getElementById('cypher-drawer-header');
  const drawer = document.getElementById('cypher-drawer');
  const toggleBtnIcon = document.getElementById('toggle-drawer-btn').querySelector('i');
  
  drawerHeader.onclick = () => {
    state.isDrawerExpanded = !state.isDrawerExpanded;
    drawer.classList.toggle('expanded');
    toggleBtnIcon.className = state.isDrawerExpanded ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
  };

  // Load Cypher template selectors
  document.getElementById('cypher-template-select').onchange = (e) => {
    const val = e.target.value;
    const editor = document.getElementById('cypher-query-input');
    
    if (val === 'match_all') {
      editor.value = 'MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 300;';
    } else if (val === 'match_competitors') {
      editor.value = 'MATCH (p1:Product)-[r:COMPETES_WITH]->(p2:Product)\nRETURN p1, r, p2 LIMIT 100;';
    } else if (val === 'match_substitutes') {
      editor.value = 'MATCH (p1:Product)-[r:SUBSTITUTE_FOR]->(p2:Product)\nRETURN p1, r, p2 LIMIT 100;';
    } else if (val === 'match_complements') {
      editor.value = 'MATCH (p1:Product)-[r:COMPLEMENTARY_TO]->(p2:Product)\nRETURN p1, r, p2 LIMIT 100;';
    } else if (val === 'electronics_shortest_path') {
      editor.value = 'MATCH path = shortestPath((c1:Category {name: "Baking Mixes"})-[:PARENT_CATEGORY*..5]-(c2:Category {name: "Baking"}))\nRETURN path;';
    }
  };

  // Run Custom Cypher Execution Command
  document.getElementById('run-cypher-btn').onclick = async () => {
    const query = document.getElementById('cypher-query-input').value.trim();
    if (!query) return showToast('Please enter a Cypher query string.', 'warning');

    showToast('Executing Cypher query in Neo4j session...', 'warning');

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      
      if (res.ok) {
        showToast(`Query returned ${data.nodes.length} nodes and ${data.links.length} links.`, 'success');
        state.allNodes = data.nodes;
        state.allLinks = data.links;
        applyGraphFilters();
      } else {
        showToast(`Cypher Error: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast('Network error running Cypher command.', 'error');
    }
  };

  // Builder node type selection change
  document.getElementById('new-node-type').onchange = (e) => {
    const val = e.target.value;
    const dynamicFields = document.getElementById('dynamic-node-fields');
    
    if (val === 'Product') {
      dynamicFields.innerHTML = `
        <div class="form-group product-field">
          <label for="new-product-gtin">GTIN14</label>
          <input type="text" id="new-product-gtin" class="form-control" placeholder="e.g. 00039156009025">
        </div>
        <div class="form-group product-field">
          <label for="new-product-price">MSRP ($)</label>
          <input type="number" id="new-product-price" class="form-control" placeholder="e.g. 6.99" step="0.01">
        </div>
      `;
    } else {
      dynamicFields.innerHTML = '';
    }
  };

  // Submit Nodes
  document.getElementById('add-node-form').onsubmit = (e) => {
    e.preventDefault();
    const type = document.getElementById('new-node-type').value;
    const name = document.getElementById('new-node-name').value.trim();
    
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Math.floor(Math.random()*1000);
    const properties = { name };

    if (type === 'Product') {
      const gtin = document.getElementById('new-product-gtin')?.value || '';
      const price = parseFloat(document.getElementById('new-product-price')?.value || 0);
      properties.gtin = gtin;
      properties.price = price;
    }

    const newNode = { id, labels: [type], properties };
    
    state.allNodes.push(newNode);
    applyGraphFilters();
    populateFormSelects();
    showToast(`Entity [${type}] "${name}" added to visualization!`, 'success');
    document.getElementById('add-node-form').reset();
  };

  // Submit Relationships
  document.getElementById('add-relation-form').onsubmit = (e) => {
    e.preventDefault();
    const source = selectedSourceId;
    const type = document.getElementById('rel-type').value;

    if (!source) {
      return showToast('Please select a valid Source Entity.', 'error');
    }
    if (selectedTargetIds.size === 0) {
      return showToast('Please select at least one Target Entity.', 'error');
    }

    let createdCount = 0;
    selectedTargetIds.forEach(target => {
      const properties = {};
      const id = `rel_${source}_${target}_${Math.floor(Math.random()*1000)}`;
      const newLink = { id, source, target, type, properties };
      state.allLinks.push(newLink);
      createdCount++;
    });

    applyGraphFilters();
    showToast(`Successfully drawn ${createdCount} relationship link(s) on canvas!`, 'success');
    
    // Reset form & selections
    populateFormSelects();
  };
}

function getRelCheckSuffix(type) {
  if (type === 'COMPETES_WITH') return 'comp';
  if (type === 'SUBSTITUTE_FOR') return 'sub';
  if (type === 'COMPLEMENTARY_TO') return 'comp-to';
  return 'sourced';
}

function populateFormSelects() {
  selectedSourceId = null;
  selectedTargetIds.clear();
  
  const sourceSearch = document.getElementById('rel-source-search');
  const sourceHidden = document.getElementById('rel-source-node');
  const targetSearch = document.getElementById('rel-target-search');
  const targetChipsContainer = document.getElementById('target-chips-container');
  
  if (sourceSearch) sourceSearch.value = '';
  if (sourceHidden) sourceHidden.value = '';
  if (targetSearch) targetSearch.value = '';
  
  if (targetChipsContainer) {
    targetChipsContainer.querySelectorAll('.typeahead-chip').forEach(el => el.remove());
  }
}

// 12. Searchable Custom Typeahead Controller
function initTypeaheadControllers() {
  const sourceSearch = document.getElementById('rel-source-search');
  const sourceDropdown = document.getElementById('rel-source-dropdown');
  const sourceHidden = document.getElementById('rel-source-node');

  const targetSearch = document.getElementById('rel-target-search');
  const targetDropdown = document.getElementById('rel-target-dropdown');
  const targetChipsContainer = document.getElementById('target-chips-container');

  if (!sourceSearch || !targetSearch) return;

  // Click on target input wrapper focuses search
  if (targetChipsContainer) {
    targetChipsContainer.onclick = (e) => {
      if (e.target === targetChipsContainer) {
        targetSearch.focus();
      }
    };
  }

  // Bind Source Search Input Binds
  sourceSearch.onfocus = () => {
    renderSourceDropdown(sourceSearch.value);
  };
  sourceSearch.oninput = (e) => {
    renderSourceDropdown(e.target.value);
  };
  
  // Bind Target Search Input Binds
  targetSearch.onfocus = () => {
    renderTargetDropdown(targetSearch.value);
  };
  targetSearch.oninput = (e) => {
    renderTargetDropdown(e.target.value);
  };

  // Hide dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    const srcContainer = document.getElementById('source-typeahead-container');
    const tgtContainer = document.getElementById('target-typeahead-container');
    
    if (srcContainer && !srcContainer.contains(e.target)) {
      sourceDropdown.classList.add('hide');
    }
    if (tgtContainer && !tgtContainer.contains(e.target)) {
      targetDropdown.classList.add('hide');
    }
  });

  let sourceFetchTimeout = null;
  let targetFetchTimeout = null;

  function capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  function renderSourceDropdown(filterText = '') {
    sourceDropdown.innerHTML = '';
    const q = filterText.toLowerCase().trim();

    // 1. Search local canvas nodes first
    const matched = state.allNodes.filter(node => {
      const name = (node.properties.name || node.id).toLowerCase();
      const type = getNodeType(node).toLowerCase();
      return name.includes(q) || type.includes(q);
    }).sort((a,b) => (a.properties.name || a.id).localeCompare(b.properties.name || b.id));

    renderSourceItems(matched);

    // 2. Fetch database-wide matches via autocomplete API (debounced)
    clearTimeout(sourceFetchTimeout);
    if (q.length >= 2) {
      sourceFetchTimeout = setTimeout(async () => {
        try {
          const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
          const suggestions = await res.json();
          if (Array.isArray(suggestions)) {
            const localIds = new Set(matched.map(n => n.id));
            const newSuggestions = suggestions.filter(s => !localIds.has(s.id));
            
            if (newSuggestions.length > 0) {
              const divider = document.createElement('div');
              divider.className = 'typeahead-divider';
              divider.style.cssText = 'padding: 6px 12px; font-size: 10px; color: var(--text-muted); border-top: 1px solid var(--border-glass); background: rgba(0,0,0,0.1); font-weight: 600; text-transform: uppercase;';
              divider.textContent = 'Database Matches';
              sourceDropdown.appendChild(divider);

              renderSourceSuggestions(newSuggestions);
            }
          }
        } catch (err) {
          console.warn('Typeahead source autocomplete failed:', err);
        }
      }, 250);
    }
  }

  function renderSourceItems(items) {
    if (items.length === 0) {
      sourceDropdown.innerHTML = `<div class="p-2 text-muted text-center" style="font-size:11px;">No entities found locally</div>`;
      sourceDropdown.classList.remove('hide');
      return;
    }

    items.forEach(node => {
      const name = node.properties.name || node.id;
      const type = getNodeType(node);
      
      const item = document.createElement('div');
      item.className = 'typeahead-item';
      if (selectedSourceId === node.id) {
        item.classList.add('selected');
      }
      
      item.innerHTML = `
        <span><span class="legend-initial legend-${type.toLowerCase()}" style="width: 14px; height: 14px; font-size: 8px; border-radius: 2px; margin-right: 4px; display: inline-flex; align-items: center; justify-content: center;">${iconMap[type] || 'N'}</span> ${name}</span>
        <span class="item-type ${type}" style="font-size:9px;">${type}</span>
      `;

      item.onclick = (e) => {
        e.stopPropagation();
        selectedSourceId = node.id;
        sourceHidden.value = node.id;
        sourceSearch.value = `[${type}] ${name}`;
        sourceDropdown.classList.add('hide');
        
        if (selectedTargetIds.has(node.id)) {
          selectedTargetIds.delete(node.id);
          renderChips();
        }
      };

      sourceDropdown.appendChild(item);
    });

    sourceDropdown.classList.remove('hide');
  }

  function renderSourceSuggestions(suggestions) {
    suggestions.forEach(s => {
      const name = s.name;
      const type = capitalizeFirstLetter(s.type);
      
      const item = document.createElement('div');
      item.className = 'typeahead-item';
      
      item.innerHTML = `
        <span><span class="legend-initial legend-${type.toLowerCase()}" style="width: 14px; height: 14px; font-size: 8px; border-radius: 2px; margin-right: 4px; display: inline-flex; align-items: center; justify-content: center;">${iconMap[type] || 'N'}</span> ${name}</span>
        <span class="item-type ${type}" style="font-size:9px;">${type}</span>
      `;

      item.onclick = (e) => {
        e.stopPropagation();
        
        // Dynamically inject this database node onto active visual graph state
        const parent = svg.node().parentElement;
        const newNode = {
          id: s.id,
          labels: [type],
          properties: { id: s.id, name: name }
        };
        newNode.x = parent.clientWidth / 2 + (Math.random() - 0.5) * 150;
        newNode.y = parent.clientHeight / 2 + (Math.random() - 0.5) * 150;
        
        if (!state.allNodes.some(n => n.id === s.id)) {
          state.allNodes.push(newNode);
          applyGraphFilters();
        }

        selectedSourceId = s.id;
        sourceHidden.value = s.id;
        sourceSearch.value = `[${type}] ${name}`;
        sourceDropdown.classList.add('hide');
        
        if (selectedTargetIds.has(s.id)) {
          selectedTargetIds.delete(s.id);
          renderChips();
        }
      };

      sourceDropdown.appendChild(item);
    });
  }

  function renderTargetDropdown(filterText = '') {
    targetDropdown.innerHTML = '';
    const q = filterText.toLowerCase().trim();

    // 1. Search local canvas nodes first
    const matched = state.allNodes.filter(node => {
      const name = (node.properties.name || node.id).toLowerCase();
      const type = getNodeType(node).toLowerCase();
      return (name.includes(q) || type.includes(q)) && node.id !== selectedSourceId;
    }).sort((a,b) => (a.properties.name || a.id).localeCompare(b.properties.name || b.id));

    renderTargetItems(matched);

    // 2. Fetch database-wide matches via autocomplete API (debounced)
    clearTimeout(targetFetchTimeout);
    if (q.length >= 2) {
      targetFetchTimeout = setTimeout(async () => {
        try {
          const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
          const suggestions = await res.json();
          if (Array.isArray(suggestions)) {
            const localIds = new Set(matched.map(n => n.id));
            const newSuggestions = suggestions.filter(s => !localIds.has(s.id) && s.id !== selectedSourceId);
            
            if (newSuggestions.length > 0) {
              const divider = document.createElement('div');
              divider.className = 'typeahead-divider';
              divider.style.cssText = 'padding: 6px 12px; font-size: 10px; color: var(--text-muted); border-top: 1px solid var(--border-glass); background: rgba(0,0,0,0.1); font-weight: 600; text-transform: uppercase;';
              divider.textContent = 'Database Matches';
              targetDropdown.appendChild(divider);

              renderTargetSuggestions(newSuggestions);
            }
          }
        } catch (err) {
          console.warn('Typeahead target autocomplete failed:', err);
        }
      }, 250);
    }
  }

  function renderTargetItems(items) {
    if (items.length === 0) {
      targetDropdown.innerHTML = `<div class="p-2 text-muted text-center" style="font-size:11px;">No entities found locally</div>`;
      targetDropdown.classList.remove('hide');
      return;
    }

    items.forEach(node => {
      const name = node.properties.name || node.id;
      const type = getNodeType(node);
      const isChecked = selectedTargetIds.has(node.id);

      const item = document.createElement('div');
      item.className = 'typeahead-item';
      if (isChecked) {
        item.classList.add('selected');
      }

      item.innerHTML = `
        <span><span class="legend-initial legend-${type.toLowerCase()}" style="width: 14px; height: 14px; font-size: 8px; border-radius: 2px; margin-right: 4px; display: inline-flex; align-items: center; justify-content: center;">${iconMap[type] || 'N'}</span> ${name}</span>
        <span style="font-size: 11px;">${isChecked ? '<i class="fa-solid fa-square-check" style="color:var(--accent);"></i>' : '<i class="fa-regular fa-square"></i>'}</span>
      `;

      item.onclick = (e) => {
        e.stopPropagation();
        if (selectedTargetIds.has(node.id)) {
          selectedTargetIds.delete(node.id);
        } else {
          selectedTargetIds.add(node.id);
        }
        renderChips();
        renderTargetDropdown(targetSearch.value);
        targetSearch.focus();
      };

      targetDropdown.appendChild(item);
    });

    targetDropdown.classList.remove('hide');
  }

  function renderTargetSuggestions(suggestions) {
    suggestions.forEach(s => {
      const name = s.name;
      const type = capitalizeFirstLetter(s.type);
      const isChecked = selectedTargetIds.has(s.id);

      const item = document.createElement('div');
      item.className = 'typeahead-item';
      if (isChecked) {
        item.classList.add('selected');
      }

      item.innerHTML = `
        <span><span class="legend-initial legend-${type.toLowerCase()}" style="width: 14px; height: 14px; font-size: 8px; border-radius: 2px; margin-right: 4px; display: inline-flex; align-items: center; justify-content: center;">${iconMap[type] || 'N'}</span> ${name}</span>
        <span style="font-size: 11px;">${isChecked ? '<i class="fa-solid fa-square-check" style="color:var(--accent);"></i>' : '<i class="fa-regular fa-square"></i>'}</span>
      `;

      item.onclick = (e) => {
        e.stopPropagation();

        // Dynamically inject this database target node onto active visual graph state
        const parent = svg.node().parentElement;
        const newNode = {
          id: s.id,
          labels: [type],
          properties: { id: s.id, name: name }
        };
        newNode.x = parent.clientWidth / 2 + (Math.random() - 0.5) * 150;
        newNode.y = parent.clientHeight / 2 + (Math.random() - 0.5) * 150;
        
        if (!state.allNodes.some(n => n.id === s.id)) {
          state.allNodes.push(newNode);
          applyGraphFilters();
        }

        if (selectedTargetIds.has(s.id)) {
          selectedTargetIds.delete(s.id);
        } else {
          selectedTargetIds.add(s.id);
        }
        renderChips();
        renderTargetDropdown(targetSearch.value);
        targetSearch.focus();
      };

      targetDropdown.appendChild(item);
    });
  }

  function renderChips() {
    // Remove existing chips
    targetChipsContainer.querySelectorAll('.typeahead-chip').forEach(el => el.remove());

    selectedTargetIds.forEach(id => {
      const node = state.allNodes.find(n => n.id === id);
      if (!node) return;

      const chip = document.createElement('span');
      chip.className = 'typeahead-chip';
      chip.innerHTML = `
        <span>${node.properties.name || node.id}</span>
        <i class="fa-solid fa-xmark chip-remove-icon"></i>
      `;

      chip.querySelector('.chip-remove-icon').onclick = (e) => {
        e.stopPropagation();
        selectedTargetIds.delete(id);
        renderChips();
        if (!targetDropdown.classList.contains('hide')) {
          renderTargetDropdown(targetSearch.value);
        }
      };

      targetChipsContainer.insertBefore(chip, targetSearch);
    });
  }
}

// 9. D3 Simulation Drag Actions
function dragStarted(event, d) {
  if (!event.active && state.physicsEnabled) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragEnded(event, d) {
  if (!event.active && state.physicsEnabled) simulation.alphaTarget(0);
  if (state.physicsEnabled) {
    d.fx = null;
    d.fy = null;
  }
}

// Toast Notifications helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconClass = type === 'success' ? 'fa-solid fa-circle-check' : 
                    type === 'error' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info';

  toast.innerHTML = `
    <i class="${iconClass} toast-icon"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 350);
  }, 4000);
}

// 10. Fetch and render searchable top brands list
async function fetchBrandsList() {
  try {
    const res = await fetch('/api/brands');
    const brands = await res.json();
    
    renderBrandsList(brands);
  } catch (err) {
    console.error('Failed to load brands list', err);
  }
}

function renderBrandsList(brands) {
  const container = document.getElementById('brands-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (brands.length === 0) {
    container.innerHTML = `<div class="text-muted text-center py-2">No active brands found.</div>`;
    return;
  }

  brands.forEach(b => {
    const div = document.createElement('div');
    div.className = 'brand-list-item';
    if (state.activeBrandFilterId === b.id) {
      div.classList.add('active');
    }
    
    div.onclick = (e) => {
      e.stopPropagation();
      toggleBrandFilter(b.id, b.name);
    };

    div.innerHTML = `
      <span><span class="legend-initial legend-brand" style="width: 16px; height: 16px; font-size: 8px; border-radius: 3px; margin-right: 4px;">B</span> ${b.name}</span>
      <span class="brand-item-meta">${b.productCount} Items</span>
    `;

    container.appendChild(div);
  });
}

function toggleBrandFilter(brandId, brandName) {
  const activeBadge = document.getElementById('active-filter-indicator');
  const activeName = document.getElementById('active-filter-name');
  const resetBtn = document.getElementById('reset-brand-filter');

  if (state.activeBrandFilterId === brandId) {
    state.activeBrandFilterId = null;
    activeBadge.classList.add('hide');
    resetBtn.classList.add('hide');
  } else {
    // Clear category filter when activating brand filter to avoid conflicting filters
    state.activeCategoryFilterId = null;
    const catReset = document.getElementById('reset-category-filter');
    if (catReset) catReset.classList.add('hide');
    
    state.activeBrandFilterId = brandId;
    activeName.textContent = `Brand: ${brandName}`;
    activeBadge.classList.remove('hide');
    resetBtn.classList.remove('hide');
  }

  document.querySelectorAll('.brand-list-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tree-node-header').forEach(el => el.classList.remove('active'));
  
  applyGraphFilters();
  fetchBrandsList();
  fetchCategoryHierarchy();
}

// Fetch Brand Competitors Dynamically
async function fetchBrandCompetitorsIntelligence(brandNode) {
  const list = document.getElementById('brand-competitors-list');
  const container = document.getElementById('brand-competitors-section');
  
  list.innerHTML = `<li class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Finding brand rivals...</li>`;
  container.classList.remove('hide');

  try {
    const res = await fetch(`/api/brands/${brandNode.properties?.id || brandNode.id}/competitors`);
    const data = await res.json();
    list.innerHTML = '';
    
    if (Array.isArray(data) && data.length > 0) {
      data.forEach(rival => {
        const li = document.createElement('li');
        li.className = 'hover-item';
        li.onclick = () => selectNodeFromId(rival.id);
        li.innerHTML = `
          <span class="rel-item-name">${rival.name}</span>
          <span class="rel-item-meta">Rival Brand <i class="fa-solid fa-chevron-right"></i></span>
        `;
        list.appendChild(li);
      });
    } else {
      list.innerHTML = `<li class="text-muted text-center py-2">No competing brands mapped.</li>`;
    }
  } catch (err) {
    console.error('Failed to fetch brand competitors:', err);
    list.innerHTML = `<li class="text-muted text-center py-2 text-danger">Query error.</li>`;
  }
}

// Fetch Category Relations Dynamically
async function fetchCategoryRelationsIntelligence(categoryNode) {
  const subList = document.getElementById('category-substitutes-list');
  const compList = document.getElementById('category-complements-list');
  const container = document.getElementById('category-relations-section');
  
  subList.innerHTML = `<li class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Finding substitutes...</li>`;
  compList.innerHTML = `<li class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Finding complements...</li>`;
  container.classList.remove('hide');

  try {
    const res = await fetch(`/api/categories/${categoryNode.properties?.id || categoryNode.id}/related`);
    const data = await res.json();
    subList.innerHTML = '';
    compList.innerHTML = '';

    // Substitutes
    if (data.substitutes && data.substitutes.length > 0) {
      data.substitutes.forEach(sub => {
        const li = document.createElement('li');
        li.className = 'hover-item';
        li.onclick = () => selectNodeFromId(sub.id);
        li.innerHTML = `
          <span class="rel-item-name">${sub.name}</span>
          <span class="rel-item-meta">Alternative <i class="fa-solid fa-chevron-right"></i></span>
        `;
        subList.appendChild(li);
      });
    } else {
      subList.innerHTML = `<li class="text-muted text-center py-2">No substitute categories mapped.</li>`;
    }

    // Complements
    if (data.complements && data.complements.length > 0) {
      data.complements.forEach(comp => {
        const li = document.createElement('li');
        li.className = 'hover-item';
        li.onclick = () => selectNodeFromId(comp.id);
        li.innerHTML = `
          <span class="rel-item-name">${comp.name}</span>
          <span class="rel-item-meta">Companion <i class="fa-solid fa-chevron-right"></i></span>
        `;
        compList.appendChild(li);
      });
    } else {
      compList.innerHTML = `<li class="text-muted text-center py-2">No companion categories mapped.</li>`;
    }
  } catch (err) {
    console.error('Failed to fetch category relations:', err);
    subList.innerHTML = `<li class="text-muted text-center py-2 text-danger">Query error.</li>`;
    compList.innerHTML = `<li class="text-muted text-center py-2 text-danger">Query error.</li>`;
  }
}

// Expose state and selectNodeFromId globally on window for E2E validation
window.state = state;
window.selectNodeFromId = selectNodeFromId;

// ==========================================================================
   // 11. Interactive AI Copilot Conversational Chat Controller
   // ==========================================================================

function initCopilotChat() {
  const toggleBtn = document.getElementById('copilot-toggle-btn');
  const closeBtn = document.getElementById('close-copilot-btn');
  const clearBtn = document.getElementById('clear-copilot-btn');
  const drawer = document.getElementById('copilot-drawer');
  const sendBtn = document.getElementById('copilot-send-btn');
  const chatInput = document.getElementById('copilot-chat-input');
  const chatHistory = document.getElementById('copilot-chat-history');

  if (!toggleBtn || !drawer) return;

  // Clear Chat and Context
  if (clearBtn) {
    clearBtn.onclick = () => {
      const greetingBubble = chatHistory.querySelector('.chat-message.assistant');
      const greetingHtml = greetingBubble ? greetingBubble.innerHTML : '';
      chatHistory.innerHTML = '';
      
      if (greetingHtml) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message assistant';
        msgDiv.innerHTML = greetingHtml;
        chatHistory.appendChild(msgDiv);
      } else {
        appendBubble('assistant', 'Hi! I am your interactive **AI Product Knowledge Graph Copilot** 🚀<br><br>I can explain retail concepts, suggest high-margin bundles, and execute visual graph queries.');
      }
      
      showToast('Conversational context cleared!', 'success');
      chatInput.focus();
    };
  }

  // Synchronize model selectors in real-time
  const modelSelect = document.getElementById('nlq-model-select');
  const copilotModelSelect = document.getElementById('copilot-model-select');
  if (modelSelect && copilotModelSelect) {
    modelSelect.addEventListener('change', () => {
      copilotModelSelect.value = modelSelect.value;
    });
    copilotModelSelect.addEventListener('change', () => {
      modelSelect.value = copilotModelSelect.value;
    });
  }

  // Add neon visual unread badge indicator upon visual platform launch
  setTimeout(() => {
    toggleBtn.classList.add('copilot-toggle-badge');
  }, 3000);

  // Toggle Drawer open/close -> programmatically activates sidebar tab
  toggleBtn.onclick = () => {
    toggleBtn.classList.remove('copilot-toggle-badge');
    const copilotTabBtn = document.getElementById('copilot-tab-btn');
    if (copilotTabBtn) {
      copilotTabBtn.click();
      chatInput.focus();
    }
  };

  closeBtn.onclick = () => {
    // Switch active tab back to inspector tab upon close click
    const inspectorTabBtn = document.querySelector('.tab-btn[data-tab="inspector-tab"]');
    if (inspectorTabBtn) {
      inspectorTabBtn.click();
    }
  };

  // Submit on Send Button click
  sendBtn.onclick = () => submitMessage();

  // Submit on pressing Enter in input field
  chatInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      submitMessage();
    }
  };

  async function submitMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';
    
    // Stage User Bubble
    appendBubble('user', text);

    // Stage Loader typing indicator
    const loaderId = appendTypingIndicator();

    try {
      const selectedModel = (copilotModelSelect && copilotModelSelect.value) || (modelSelect && modelSelect.value) || null;

      const history = compileChatHistory();

      // Send to API Chat
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: history,
          model: selectedModel
        })
      });

      const data = await res.json();
      removeTypingIndicator(loaderId);

      if (res.ok) {
        // A. If query requires dynamic graph update, inject nodes/links into simulation
        if (data.action === 'api_call' && data.graph) {
          showToast('AI loaded new graph visualization onto canvas!', 'success');
          state.allNodes = data.graph.nodes;
          state.allLinks = data.graph.links;
          applyGraphFilters();

          // Reveal floating Cypher badge info in visualization panel
          if (data.translatedCypher) {
            state.geminiCypher = data.translatedCypher;
            const previewCode = document.getElementById('cypher-preview-code');
            const previewBadge = document.getElementById('cypher-preview-badge');
            const previewExplanation = document.getElementById('cypher-explanation-text');
            
            if (previewCode) previewCode.textContent = data.translatedCypher;
            if (previewBadge) previewBadge.classList.remove('hide');
            if (previewExplanation && data.explanation) {
              previewExplanation.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent); font-size:10px; margin-right:6px;"></i> ${data.explanation}`;
              previewExplanation.classList.remove('hide');
            }
          }

          // Smoothly center camera and highlight first node if a target is returned
          if (data.targetNodeId) {
            setTimeout(() => {
              selectNodeFromId(data.targetNodeId);
            }, 500);
          }
        }

        // B. Render markdown conversational response bubble
        appendBubble('assistant', data.reply);
      } else {
        appendBubble('assistant', `### Service Error ⚠️\n\nI was unable to complete your request:\n\n* **Details:** \`${data.error || 'Unknown API Exception'}\``);
      }
    } catch (err) {
      removeTypingIndicator(loaderId);
      appendBubble('assistant', `### Network Timeout ⚠️\n\nFailed to establish connection to the AI Chat service:\n\n* **Error:** \`${err.message}\``);
    }
  }

  function appendBubble(role, rawContent) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    // Parse simple Markdown elements inside reply (bold, backticks, bullet lists, tables)
    bubble.innerHTML = parseMarkdown(rawContent);

    // Auto-detect backticked item matches and replace with clickable interactive pill deep-links!
    postProcessPills(bubble);

    messageDiv.appendChild(bubble);
    chatHistory.appendChild(messageDiv);

    // Smooth scroll chat view to bottom
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  function appendTypingIndicator() {
    const loaderId = 'typing_' + Math.floor(Math.random() * 1000);
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message assistant';
    messageDiv.id = loaderId;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble loading-bubble';
    bubble.innerHTML = `
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    `;

    messageDiv.appendChild(bubble);
    chatHistory.appendChild(messageDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    return loaderId;
  }

  function removeTypingIndicator(id) {
    const loader = document.getElementById(id);
    if (loader) loader.remove();
  }

  function compileChatHistory() {
    const history = [];
    const bubbles = chatHistory.querySelectorAll('.chat-message');
    bubbles.forEach(b => {
      const role = b.classList.contains('user') ? 'user' : 'assistant';
      const text = b.textContent.trim();
      if (text) {
        history.push({ role, content: text });
      }
    });
    return history.slice(-6); // pass last 6 turns of context to save tokens
  }

  // Pure-JS Markdown parser
  function parseMarkdown(md) {
    if (!md) return '';
    let html = md;

    // 1. Process Markdown tables
    const tableRegex = /\|(.+)\|[\r\n]+\|([-:\s|]+)\|[\r\n]+((?:\|.+|[\r\n]+)*)/g;
    html = html.replace(tableRegex, (match, headerRow, separatorRow, bodyRows) => {
      const headers = headerRow.split('|').map(h => h.trim()).filter(h => h);
      const rows = bodyRows.split('\n')
        .map(r => r.trim())
        .filter(r => r.startsWith('|'))
        .map(r => r.split('|').map(c => c.trim()).filter(c => c !== ''));

      let tableHtml = '<table><thead><tr>';
      headers.forEach(h => { tableHtml += `<th>${h}</th>`; });
      tableHtml += '</tr></thead><tbody>';

      rows.forEach(row => {
        if (row.length === 0) return;
        tableHtml += '<tr>';
        row.forEach(cell => { tableHtml += `<td>${cell}</td>`; });
        tableHtml += '</tr>';
      });

      tableHtml += '</tbody></table>';
      return tableHtml;
    });

    // 2. Headings
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');

    // 3. Bold tags
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 4. Bullet lists
    html = html.replace(/^\*\s+(.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, ''); // consolidate neighboring lists

    // 5. Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  // Replaces backticked items with beautiful click-interactive capsules
  function postProcessPills(bubbleContainer) {
    const rawHtml = bubbleContainer.innerHTML;
    // Find all backticked items
    const matches = rawHtml.match(/`(.*?)`/g);
    if (!matches) return;

    let updatedHtml = rawHtml;
    matches.forEach(match => {
      const term = match.slice(1, -1).trim();
      
      // Attempt to locate this entity dynamically inside the active canvas nodes!
      const matchingNode = state.allNodes.find(n => {
        const name = (n.properties?.name || '').toLowerCase();
        return name === term.toLowerCase();
      });

      if (matchingNode) {
        const type = getNodeType(matchingNode);
        const pillClass = type === 'Brand' ? 'chat-pill chat-pill-brand' : 'chat-pill';
        const replaceString = `<span class="${pillClass}" onclick="selectNodeFromId('${matchingNode.id}')"><i class="fa-solid fa-crosshairs mr-1" style="font-size: 8px;"></i> ${matchingNode.properties.name}</span>`;
        updatedHtml = updatedHtml.replace(match, replaceString);
      } else {
        // Fallback: strip backticks and format as high-contrast code block
        updatedHtml = updatedHtml.replace(match, `<code>${term}</code>`);
      }
    });

    bubbleContainer.innerHTML = updatedHtml;
  }
}

// ==========================================================================
// 12. Category & Brand Relationship Recommendations Controller
// ==========================================================================

function initRecommendationsController() {
  state.activeRecMode = 'categories';
  
  const refreshBtn = document.getElementById('refresh-recommendations-btn');
  const acceptBtn = document.getElementById('accept-recommendations-btn');
  const toggleCatsBtn = document.getElementById('rec-toggle-cats-btn');
  const toggleBrandsBtn = document.getElementById('rec-toggle-brands-btn');
  
  if (toggleCatsBtn && toggleBrandsBtn) {
    toggleCatsBtn.onclick = () => {
      if (state.activeRecMode === 'categories') return;
      state.activeRecMode = 'categories';
      toggleCatsBtn.classList.add('active');
      toggleBrandsBtn.classList.remove('active');
      
      const subtitle = document.getElementById('rec-widget-subtitle');
      if (subtitle) {
        subtitle.textContent = 'Discover missing category relationships (complements and substitutes) purely from graph Jaccard overlaps. Review and approve pairings to merge them in Neo4j.';
      }
      
      loadRecommendations();
    };
    
    toggleBrandsBtn.onclick = () => {
      if (state.activeRecMode === 'brands') return;
      state.activeRecMode = 'brands';
      toggleBrandsBtn.classList.add('active');
      toggleCatsBtn.classList.remove('active');
      
      const subtitle = document.getElementById('rec-widget-subtitle');
      if (subtitle) {
        subtitle.textContent = 'Discover potential market rival brands based on category overlap co-occurrences in catalog listings. Review and approve pairings to merge them in Neo4j.';
      }
      
      loadRecommendations();
    };
  }

  if (refreshBtn) {
    refreshBtn.onclick = () => {
      loadRecommendations();
    };
  }

  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      if (state.selectedRecommendations.size === 0) {
        showToast('Please select at least one recommendation to approve.', 'warning');
        return;
      }

      acceptBtn.disabled = true;
      const originalText = acceptBtn.innerHTML;
      acceptBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
      
      const isBrands = state.activeRecMode === 'brands';
      const endpoint = isBrands ? '/api/recommendations/brands/accept' : '/api/recommendations/accept';
      
      const pairsToAccept = [];
      state.selectedRecommendations.forEach(key => {
        if (isBrands) {
          const item = state.recommendations.find(r => `${r.brand1Id}_${r.brand2Id}` === key);
          if (item) {
            pairsToAccept.push({
              brand1Id: item.brand1Id,
              brand2Id: item.brand2Id,
              similarity: item.similarity
            });
          }
        } else {
          const item = state.recommendations.find(r => `${r.sourceId}_${r.targetId}` === key);
          if (item) {
            pairsToAccept.push({
              sourceId: item.sourceId,
              targetId: item.targetId,
              relationshipType: item.relationshipType,
              similarity: item.similarity
            });
          }
        }
      });

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairs: pairsToAccept })
        });
        const data = await res.json();
        
        if (data.acceptedCount !== undefined) {
          showToast(`Successfully approved & merged ${data.acceptedCount} relationship(s) in Neo4j!`, 'success');
          state.selectedRecommendations.clear();
          
          // Re-fetch visual data and status to draw JIT on-screen
          checkDatabasesStatus();
          await fetchGraphData();
          
          // Refresh recommendations list
          await loadRecommendations();
        } else {
          showToast(`Approve failed: ${data.error || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        showToast('Network error while accepting recommendations.', 'error');
      } finally {
        acceptBtn.disabled = false;
        acceptBtn.innerHTML = originalText;
      }
    };
  }
}

async function loadRecommendations() {
  const listContainer = document.getElementById('recommendations-list');
  const actionBar = document.getElementById('rec-action-bar');
  const countLabel = document.getElementById('rec-selection-count');
  
  if (!listContainer) return;

  listContainer.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-wand-magic-sparkles fa-spin"></i> Analyzing graph topology...</div>';
  if (actionBar) actionBar.classList.add('hide');
  state.selectedRecommendations.clear();

  const isBrands = state.activeRecMode === 'brands';
  const endpoint = isBrands ? '/api/recommendations/brands?limit=15' : '/api/recommendations?limit=15';

  try {
    const res = await fetch(endpoint);
    const data = await res.json();
    
    if (Array.isArray(data)) {
      state.recommendations = data;
      
      if (data.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-state-card" style="text-align: center; padding: 24px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px dashed rgba(255,255,255,0.05);">
            <i class="fa-solid fa-circle-check" style="font-size: 24px; color: var(--color-success); margin-bottom: 8px;"></i>
            <h4 style="margin-bottom: 4px; font-size: 13px; font-weight: 600;">Taxonomy Up-to-Date</h4>
            <p style="font-size: 11px; color: var(--text-muted); margin: 0;">No further recommended clusters located in this section of the graph!</p>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = '';
      data.forEach((item) => {
        const key = isBrands ? `${item.brand1Id}_${item.brand2Id}` : `${item.sourceId}_${item.targetId}`;
        const isSelected = state.selectedRecommendations.has(key);
        const card = document.createElement('div');
        card.className = `recommendation-card ${isSelected ? 'selected' : ''}`;
        
        let topRowHtml = '';
        let titleRowHtml = '';
        
        if (isBrands) {
          const pctSimilarity = Math.round(item.similarity * 100);
          topRowHtml = `
            <div class="card-top-row">
              <span class="card-badge badge-competitor">COMPETITOR</span>
              <span class="card-similarity">${pctSimilarity}% overlap</span>
            </div>
          `;
          titleRowHtml = `
            <div class="card-title-row">
              <span class="node-name">${item.brand1Name}</span>
              <i class="fa-solid fa-fire-burner card-arrow" style="color: var(--danger); font-size: 11px;"></i>
              <span class="node-name">${item.brand2Name}</span>
            </div>
          `;
        } else {
          const badgeClass = item.relationshipType === 'SUBSTITUTE' ? 'badge-substitute' : 'badge-complement';
          const pctSimilarity = Math.round(item.similarity * 100);
          topRowHtml = `
            <div class="card-top-row">
              <span class="card-badge ${badgeClass}">${item.relationshipType}</span>
              <span class="card-similarity">${pctSimilarity}% overlap</span>
            </div>
          `;
          titleRowHtml = `
            <div class="card-title-row">
              <span class="node-name">${item.sourceName}</span>
              <i class="fa-solid fa-arrows-h-to-line card-arrow"></i>
              <span class="node-name">${item.targetName}</span>
            </div>
          `;
        }
        
        card.innerHTML = `
          ${topRowHtml}
          ${titleRowHtml}
          <p class="card-rationale">${item.rationale}</p>
        `;

        card.onclick = () => {
          if (state.selectedRecommendations.has(key)) {
            state.selectedRecommendations.delete(key);
            card.classList.remove('selected');
          } else {
            state.selectedRecommendations.add(key);
            card.classList.add('selected');
          }

          // Update action bar state
          const selCount = state.selectedRecommendations.size;
          if (countLabel) countLabel.textContent = `${selCount} selected`;
          
          if (selCount > 0) {
            if (actionBar) actionBar.classList.remove('hide');
          } else {
            if (actionBar) actionBar.classList.add('hide');
          }
        };

        listContainer.appendChild(card);
      });
    } else {
      listContainer.innerHTML = `<div class="empty-state-card text-danger" style="padding: 16px;">Failed to fetch recommendations: ${data.error || 'Server error'}</div>`;
    }
  } catch (err) {
    listContainer.innerHTML = `<div class="empty-state-card text-danger" style="padding: 16px;">Connection timeout loading recommendations.</div>`;
  }
}
