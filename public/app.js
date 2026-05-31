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
  isDrawerExpanded: false
};

// D3 Selections & Simulation
let svg, g, simulation, zoomBehavior;
const width = window.innerWidth;
const height = window.innerHeight;

// Icons mapping for FontAwesome in SVG rendering
const iconMap = {
  Product: '\uf0ab',       /* fa-box */
  Brand: '\uf1f9',         /* fa-copyright */
  Category: '\uf02c'       /* fa-tags */
};

// Colors matching the Design System HSL
const colorMap = {
  Product: 'hsl(263, 90%, 62%)',
  Brand: 'hsl(184, 90%, 45%)',
  Category: 'hsl(290, 85%, 60%)'
};

// 2. Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initD3Canvas();
  bindUIEvents();
  checkDatabasesStatus();
  fetchGraphData();
  fetchCategoryHierarchy();
  fetchBrandsList();
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
  // A. Node Filtering
  state.filteredNodes = state.allNodes.filter(node => {
    const label = node.labels[0] || 'Product';
    
    // Check type toggle
    if (!state.filters[label]) return false;

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
      const belongs = state.allLinks.some(link => 
        link.source === node.id && 
        link.type === 'BELONGS_TO' && 
        link.target === state.activeCategoryFilterId
      );
      if (!belongs) return false;
    }

    // Check Brand Explorer focus path
    if (state.activeBrandFilterId && label === 'Product') {
      const manufactures = state.allLinks.some(link => 
        link.source === node.id && 
        link.type === 'MANUFACTURED_BY' && 
        link.target === state.activeBrandFilterId
      );
      if (!manufactures) return false;
    }

    return true;
  });

  // B. Edge Filtering
  const nodeIds = new Set(state.filteredNodes.map(n => n.id));
  state.filteredLinks = state.allLinks.filter(link => {
    // Both endpoints must exist in active node set
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) return false;
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
    .attr('class', d => `node-circle ${d.labels[0] || 'Product'}`)
    .attr('r', 15);

  // Centered Icon Character
  node.append('text')
    .attr('class', 'node-icon-text')
    .text(d => iconMap[d.labels[0] || 'Product']);

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
  const connectedNodeIds = new Set([focusedNode.id]);
  const connectedEdgeIds = new Set();

  state.filteredLinks.forEach(link => {
    if (link.source.id === focusedNode.id) {
      connectedNodeIds.add(link.target.id);
      connectedEdgeIds.add(link.id);
    } else if (link.target.id === focusedNode.id) {
      connectedNodeIds.add(link.source.id);
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

  const label = node.labels[0] || 'Product';
  document.getElementById('node-type-label').className = `node-type-tag ${label}`;
  document.getElementById('node-type-label').textContent = label;
  document.getElementById('node-name-label').textContent = node.properties.name || node.id;
  
  // Setup Subtitle Info
  const subLabel = document.getElementById('node-subtitle-label');
  if (label === 'Product') {
    // Try to find the brand manufacture relation to show
    const mfgLink = state.allLinks.find(link => link.source === node.id && link.type === 'MANUFACTURED_BY');
    let brandName = 'Generic Brand';
    if (mfgLink) {
      const brandNode = state.allNodes.find(n => n.id === mfgLink.target);
      brandName = brandNode ? brandNode.properties.name : mfgLink.target;
    }
    subLabel.textContent = `Brand: ${brandName}`;
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
function compileProductMetadata(productNode) {
  const grid = document.getElementById('product-metadata-grid');
  grid.innerHTML = '';

  const props = productNode.properties;

  const msrpVal = parseFloat(props.price || 0);
  const items = [
    { name: 'MSRP', val: msrpVal > 0 ? `$${msrpVal.toFixed(2)}` : 'N/A' },
    { name: 'GTIN14 / SKU', val: props.gtin || 'N/A' },
    { name: 'Package Size', val: props.size ? `${props.size} ${props.measure || ''}` : 'N/A' },
    { name: 'Validation State', val: props.validationState || 'VALID' }
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
function selectNodeFromId(nodeId) {
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
    showToast('Product is in the database but currently not visible on active visual canvas context.', 'warning');
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
}

// Compile Ecosystem list of connections for Brand/Source/Category
function compileEcosystemConnections(node) {
  const list = document.getElementById('node-ecosystem-list');
  list.innerHTML = '';

  const label = node.labels[0];
  const targetRel = label === 'Brand' ? 'MANUFACTURED_BY' : 'BELONGS_TO';

  const connections = state.allLinks.filter(link => 
    link.target === node.id && link.type === targetRel
  );

  if (connections.length === 0) {
    list.innerHTML = `<li class="text-muted text-center py-2">No connected catalog products.</li>`;
    return;
  }

  connections.forEach(link => {
    const productNode = state.allNodes.find(n => n.id === link.source);
    if (!productNode) return;
    
    const name = productNode.properties.name || link.source;
    const priceVal = parseFloat(productNode.properties.price || 0);
    const priceStr = priceVal > 0 ? ` ($${priceVal.toFixed(2)})` : '';

    const li = document.createElement('li');
    li.onclick = () => selectNode(productNode);
    li.innerHTML = `
      <span><i class="fa-solid fa-box text-primary mr-2"></i> ${name}</span>
      <span class="text-muted">${priceStr} <i class="fa-solid fa-chevron-right"></i></span>
    `;
    list.appendChild(li);
  });
}

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
    folderIcon.innerHTML = `<i class="fa-solid fa-folder"></i> `;
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

    searchBarIcon.className = 'fa-solid fa-wand-magic-sparkles search-inner-icon';
    searchInput.placeholder = "Ask Gemini AI: e.g. 'Show Pepsi competitors'...";
    
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

  // Core Gemini AI Search Traversal Caller
  async function triggerGeminiAISearch(questionText) {
    loadingOverlay.classList.remove('hide');
    showToast('Gemini is translating prompt to Cypher...', 'warning');

    try {
      const res = await fetch('/api/nlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: questionText })
      });
      const data = await res.json();

      if (res.ok) {
        showToast(`Gemini successfully mapped ${data.nodes.length} nodes!`, 'success');
        
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
        showToast(`Gemini execution failed: ${data.error}`, 'error');
        cypherPreviewBadge.classList.add('hide');
      }
    } catch (err) {
      showToast('Network timeout connecting to Gemini AI service.', 'error');
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
    const source = document.getElementById('rel-source-node').value;
    const target = document.getElementById('rel-target-node').value;
    const type = document.getElementById('rel-type').value;

    const properties = {};
    const id = `rel_${source}_${target}_${Math.floor(Math.random()*1000)}`;
    const newLink = { id, source, target, type, properties };

    state.allLinks.push(newLink);
    applyGraphFilters();
    showToast(`Relationship Link [${type}] drawn successfully!`, 'success');
    document.getElementById('add-relation-form').reset();
  };
}

function getRelCheckSuffix(type) {
  if (type === 'COMPETES_WITH') return 'comp';
  if (type === 'SUBSTITUTE_FOR') return 'sub';
  if (type === 'COMPLEMENTARY_TO') return 'comp-to';
  return 'sourced';
}

function populateFormSelects() {
  const sourceSel = document.getElementById('rel-source-node');
  const targetSel = document.getElementById('rel-target-node');
  
  const oldSourceVal = sourceSel.value;
  const oldTargetVal = targetSel.value;

  sourceSel.innerHTML = '<option value="">-- Select Source --</option>';
  targetSel.innerHTML = '<option value="">-- Select Target --</option>';

  const sorted = [...state.allNodes].sort((a,b) => {
    const na = a.properties.name || a.id;
    const nb = b.properties.name || b.id;
    return na.localeCompare(nb);
  });

  sorted.forEach(node => {
    const name = node.properties.name || node.id;
    const type = node.labels[0] || 'Product';
    const opt = `<option value="${node.id}">[${type}] ${name}</option>`;
    
    sourceSel.innerHTML += opt;
    targetSel.innerHTML += opt;
  });

  sourceSel.value = oldSourceVal;
  targetSel.value = oldTargetVal;
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
      <span><i class="fa-solid fa-copyright text-accent mr-2"></i> ${b.name}</span>
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
    const res = await fetch(`/api/brands/${brandNode.id}/competitors`);
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
    const res = await fetch(`/api/categories/${categoryNode.id}/related`);
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


