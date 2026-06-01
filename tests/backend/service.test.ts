import { describe, test, expect, mock } from 'bun:test';
import { ProductService } from '../../service/product.service';
import { BrandService } from '../../service/brand.service';
import { CategoryService } from '../../service/category.service';
import { GraphService } from '../../service/graph.service';
import { NlqService } from '../../service/nlq.service';
import { SearchOrchestrator } from '../../service/orchestrator/search.orchestrator';
import { EtlOrchestrator } from '../../service/orchestrator/etl.orchestrator';

describe('US Retailer Product Knowledge Graph - Core Services Unit Tests', () => {
  
  test('ProductService delegates properly to ProductRepository', async () => {
    // 1. Mock the repository with fully-typed DTO responses
    const mockProductRepo = {
      fetchDetail: mock((id: string) => Promise.resolve({
        id: id,
        name: 'Test Cherry Soda',
        price: 4.99,
        gtin: '1234',
        size: null,
        measure: 'oz',
        validationState: 'VALID'
      })),
      fetchCategoryPath: mock(() => Promise.resolve([{ name: 'Soda' }])),
      fetchRelated: mock(() => Promise.resolve({ competitors: [], complements: [], siblings: [] })),
      autocomplete: mock(() => Promise.resolve([{ name: 'Test', type: 'product', id: '123' }]))
    } as any;

    const productService = new ProductService(mockProductRepo);

    // Test product detail
    const detail = await productService.getProductDetail('123');
    expect(detail.id).toBe('123');
    expect(detail.name).toBe('Test Cherry Soda');
    expect(mockProductRepo.fetchDetail).toHaveBeenCalledTimes(1);

    // Test product category path
    const path = await productService.getProductCategoryPath('123');
    expect(path[0].name).toBe('Soda');
    expect(mockProductRepo.fetchCategoryPath).toHaveBeenCalledTimes(1);

    // Test related products
    const related = await productService.getRelatedProducts('123');
    expect(related.competitors).toEqual([]);
    expect(mockProductRepo.fetchRelated).toHaveBeenCalledTimes(1);

    // Test autocomplete
    const suggestions = await productService.autocompleteSearch('Test');
    expect(suggestions[0].name).toBe('Test');
    expect(mockProductRepo.autocomplete).toHaveBeenCalledTimes(1);
  });

  test('BrandService delegates properly to BrandRepository', async () => {
    const mockBrandRepo = {
      fetchBrands: mock(() => Promise.resolve([{ id: 'b1', name: 'Brand A', productCount: 5 }])),
      fetchBrandCompetitors: mock(() => Promise.resolve([{ id: 'b2', name: 'Brand B' }])),
      searchBrandCompetitors: mock(() => Promise.resolve({ matchedId: 'b1', matchedName: 'Brand A', competitors: [] }))
    } as any;

    const brandService = new BrandService(mockBrandRepo);

    const brands = await brandService.getBrands();
    expect(brands[0].name).toBe('Brand A');
    expect(mockBrandRepo.fetchBrands).toHaveBeenCalledTimes(1);

    const competitors = await brandService.getBrandCompetitors('b1');
    expect(competitors[0].name).toBe('Brand B');
    expect(mockBrandRepo.fetchBrandCompetitors).toHaveBeenCalledTimes(1);

    const searchRes = await brandService.searchBrandCompetitors('Brand A');
    expect(searchRes.matchedName).toBe('Brand A');
    expect(mockBrandRepo.searchBrandCompetitors).toHaveBeenCalledTimes(1);
  });

  test('CategoryService delegates properly to CategoryRepository', async () => {
    const mockCategoryRepo = {
      fetchCategories: mock(() => Promise.resolve([{ id: 'c1', name: 'Category A', parentId: undefined }])),
      fetchCategoryRelated: mock(() => Promise.resolve({ substitutes: [], complements: [] })),
      searchCategoryRelated: mock(() => Promise.resolve({ matchedId: 'c1', matchedName: 'Category A', substitutes: [], complements: [] }))
    } as any;

    const categoryService = new CategoryService(mockCategoryRepo);

    const categories = await categoryService.getCategories();
    expect(categories[0].name).toBe('Category A');
    expect(mockCategoryRepo.fetchCategories).toHaveBeenCalledTimes(1);

    const related = await categoryService.getCategoryRelated('c1');
    expect(related.substitutes).toEqual([]);
    expect(mockCategoryRepo.fetchCategoryRelated).toHaveBeenCalledTimes(1);

    const searchRes = await categoryService.searchCategoryRelated('Category A');
    expect(searchRes.matchedName).toBe('Category A');
    expect(mockCategoryRepo.searchCategoryRelated).toHaveBeenCalledTimes(1);
  });

  test('SearchOrchestrator coordinates visual graphs, keyword searches, and NLQ queries', async () => {
    const mockProductService = {} as any;
    const mockBrandService = {} as any;
    const mockCategoryService = {} as any;
    const mockGraphService = {
      getVisualGraph: mock(() => Promise.resolve({ nodes: [], links: [] })),
      executeCustomCypher: mock(() => Promise.resolve({ nodes: [], links: [] })),
      globalKeywordSearch: mock(() => Promise.resolve({ nodes: [], links: [] }))
    } as any;
    const mockNlqService = {
      processNLQQuery: mock(() => Promise.resolve({
        translatedCypher: 'MATCH (n) RETURN n',
        explanation: 'Mock Cypher query',
        isFallback: false,
        nodes: [],
        links: []
      }))
    } as any;

    const orchestrator = new SearchOrchestrator(
      mockProductService,
      mockBrandService,
      mockCategoryService,
      mockGraphService,
      mockNlqService
    );

    const visualGraph = await orchestrator.getVisualGraph();
    expect(visualGraph.nodes).toEqual([]);
    expect(mockGraphService.getVisualGraph).toHaveBeenCalledTimes(1);

    const customCypher = await orchestrator.executeCustomCypher('MATCH (n) RETURN n');
    expect(customCypher.nodes).toEqual([]);
    expect(mockGraphService.executeCustomCypher).toHaveBeenCalledTimes(1);

    const keywordRes = await orchestrator.globalKeywordSearch('Soda');
    expect(keywordRes.nodes).toEqual([]);
    expect(mockGraphService.globalKeywordSearch).toHaveBeenCalledTimes(1);

    const nlqRes = await orchestrator.processNLQ('Show me all sodas');
    expect(nlqRes.translatedCypher).toBe('MATCH (n) RETURN n');
    expect(mockNlqService.processNLQQuery).toHaveBeenCalledTimes(1);
  });

  test('EtlOrchestrator delegates cleanly to EtlService for standard run', async () => {
    const mockEtlService = {
      runPipeline: mock(() => Promise.resolve({
        products: 10,
        brands: 100,
        manufacturers: 5,
        sources: 1,
        categories: 3,
        relationships: 200,
        durationSeconds: 45
      }))
    } as any;

    const orchestrator = new EtlOrchestrator(mockEtlService);

    const stats = await orchestrator.runIngestion();
    expect(stats.brands).toBe(100);
    expect(mockEtlService.runPipeline).toHaveBeenCalledTimes(1);
  });

  test('EtlOrchestrator coordinates selective pipeline runs with granular stages', async () => {
    const mockEtlService = {
      truncateDatabase: mock(() => Promise.resolve({ deletedRels: 100, deletedNodes: 50 })),
      verifySchemaConstraints: mock(() => Promise.resolve()),
      ingestCategoryTopology: mock(() => Promise.resolve({ categories: 3, parentLinksCount: 2 })),
      ingestCategoryRelationships: mock(() => Promise.resolve({ complements: 5, substitutes: 4 })),
      ingestBrandTopology: mock(() => Promise.resolve({ brands: 10, manufacturers: 2, ownedLinksCount: 8 })),
      ingestBrandRelationships: mock(() => Promise.resolve({ competitors: 12 })),
      streamProductCatalog: mock(() => Promise.resolve({ products: 15, relationships: 30 }))
    } as any;

    const orchestrator = new EtlOrchestrator(mockEtlService);

    const options = {
      truncate: true,
      schema: true,
      categories: true,
      brands: true,
      products: true,
      relationships: true
    };

    const stats = await orchestrator.runSelectivePipeline(options);

    expect(stats.categories).toBe(3);
    expect(stats.brands).toBe(10);
    expect(stats.manufacturers).toBe(2);
    expect(stats.products).toBe(15);
    // relationships = parentLinksCount (2) + complements*2 (10) + substitutes*2 (8) + ownedLinksCount (8) + competitors*2 (24) + products.relationships (30) = 82
    expect(stats.relationships).toBe(82);

    expect(mockEtlService.truncateDatabase).toHaveBeenCalledTimes(1);
    expect(mockEtlService.verifySchemaConstraints).toHaveBeenCalledTimes(1);
    expect(mockEtlService.ingestCategoryTopology).toHaveBeenCalledTimes(1);
    expect(mockEtlService.ingestCategoryRelationships).toHaveBeenCalledTimes(1);
    expect(mockEtlService.ingestBrandTopology).toHaveBeenCalledTimes(1);
    expect(mockEtlService.ingestBrandRelationships).toHaveBeenCalledTimes(1);
    expect(mockEtlService.streamProductCatalog).toHaveBeenCalledTimes(1);
  });
});
