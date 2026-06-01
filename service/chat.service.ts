import { NlqService } from './nlq.service';
import { LlmService } from './llm.service';
import { appConfig } from '../configs/app.config';

export class ChatService {
  constructor(
    private nlqService: NlqService,
    private llmService: LlmService
  ) {}

  async processChatMessage(
    message: string,
    history: { role: string; content: string }[] = [],
    overrideModel?: string
  ): Promise<any> {
    const provider = overrideModel
      ? (overrideModel.startsWith('gpt') ? 'openai'
        : overrideModel.startsWith('claude') ? 'anthropic'
        : 'gemini')
      : appConfig.llm.activeProvider;

    const apiKey = provider === 'openai' ? appConfig.openAiApiKey
      : provider === 'anthropic' ? appConfig.anthropicApiKey
      : appConfig.geminiApiKey;

    // 1. If LLM is disabled or keys are missing, return a clean informational warning
    if (!apiKey || !appConfig.llm.nlqEnabled) {
      return {
        action: 'reply',
        reply: `### AI Copilot Offline ⚠️\n\nConversational AI features are currently disabled because the active provider's API key is missing or disabled in your configuration.\n\n* **Active Provider:** \`${provider.toUpperCase()}\`\n* **Status:** \`DISABLED\`\n\nTo enable this, please provide a valid API key (e.g. \`GEMINI_API_KEY\`, \`OPENAI_API_KEY\` or \`ANTHROPIC_API_KEY\`) in your \`.env\` file and restart the Hono API server!`
      };
    }

    const activeModel = overrideModel || appConfig.llm[provider].nlqModel;

    // 2. Phrase 1: Run the API Classification Router
    const routerPrompt = `You are the API Routing Brain for the AI Product Knowledge Graph Copilot.
Your job is to read the user's message and decide if answering it requires querying the Neo4j database to fetch node networks and relationships (which renders a visual graph), OR if it's a general conversation/retail strategy question.

Available Mapped APIs:
1. "/api/nlq" - Call this if the user asks to draw, show, find, or search for products, brands, categories, competitors, substitutes, or bundles in the database. 
   - Note: Colloquial questions or follow-ups that ask about specific items (e.g., "what about soda-flavored lip balms?", "do we have any Dr Pepper?", "how about Pepsi rivals?") MUST be routed as "/api/nlq" because answering them requires querying the database to draw the node graph.
2. "reply" - Use this only if the user is asking a general question, explaining a retail concept, greeting you, or continuing a conversation that doesn't require loading a new node graph (e.g., "hi", "how does a substitute relationship help?", "explain the chips and dip bundle strategy you just recommended").

Formulate your routing decision and return it in this exact JSON schema. Do NOT include markdown code blocks, just return the JSON object:
{
  "action": "api_call" | "reply",
  "apiUrl": "/api/nlq" | null,
  "cleanQuestion": "A cleaned-up search query to send to the database if api_call is chosen, or null"
}

User Message: "${message}"
Output JSON:`;

    let routing: any = { action: 'reply', apiUrl: null, cleanQuestion: null };

    try {
      const rawRoute = await this.llmService.generateContent(routerPrompt, 'nlq', true, activeModel, provider);
      const cleanRoute = rawRoute.replace(/```json/gi, '').replace(/```/g, '').trim();
      routing = JSON.parse(cleanRoute);
      console.log(`[ChatRouter] Classified action: "${routing.action}" (Target API: "${routing.apiUrl}")`);
    } catch (err: any) {
      console.warn('[ChatRouter] Failed to parse classification JSON, falling back to conversational reply:', err.message);
    }

    // Robust Rule-based Interceptor for common DB query keywords to guarantee database visual traversal
    const lowerMessage = message.toLowerCase();
    const queryKeywords = [
      'show', 'find', 'search', 'competitor', 'rival', 'substitute', 'complement', 'bundle', 'products', 
      'categories', 'brands', 'list', 'what about', 'how about', 'do we have', 'is there', 'balm', 'smacker', 'soda', 'cola'
    ];
    const containsQueryKeyword = queryKeywords.some(kw => lowerMessage.includes(kw));

    if (containsQueryKeyword && routing.action !== 'api_call') {
      console.log(`[ChatRouter] Intercepted and forced api_call based on keyword rules for: "${message}"`);
      routing.action = 'api_call';
      routing.apiUrl = '/api/nlq';
      routing.cleanQuestion = message;
    }

    // 3. Phase 2: Execute Routing Action
    if (routing.action === 'api_call' && routing.apiUrl === '/api/nlq') {
      try {
        console.log(`[ChatRouter] Executing internal database query for: "${routing.cleanQuestion || message}"`);
        const graphResult = await this.nlqService.processNLQQuery(routing.cleanQuestion || message, overrideModel);
        
        // Formulate a beautiful conversational summary of the loaded graph nodes
        const productNames = graphResult.nodes
          .filter(n => n.labels.includes('Product'))
          .map(n => n.properties.name)
          .slice(0, 10);
        const brandNames = graphResult.nodes
          .filter(n => n.labels.includes('Brand'))
          .map(n => n.properties.name)
          .slice(0, 10);
        const categoryNames = graphResult.nodes
          .filter(n => n.labels.includes('Category'))
          .map(n => n.properties.name)
          .slice(0, 10);

        const synthesisPrompt = `You are the expert AI Product Knowledge Graph Copilot.
The user asked: "${message}"
The database returned a matching graph containing:
- Products: ${productNames.join(', ') || 'None'}
- Brands: ${brandNames.join(', ') || 'None'}
- Categories: ${categoryNames.join(', ') || 'None'}
- Total Nodes returned: ${graphResult.nodes.length}
- Total Relationship Links: ${graphResult.links.length}

The Cypher query that executed was:
\`\`\`cypher
${graphResult.translatedCypher}
\`\`\`

Write a highly engaging, conversational retail response answering the user's question based strictly on this database query result. 
* Highlight key brands or products from the data.
* If a competitor or substitute was found, explain the competitive relationship.
* Format your response in clean, professional Markdown (using bullet points, tables, or bold text where appropriate) to make it visually premium and highly readable!
* Keep your tone expert, insightful, and concise.

Conversational Answer:`;

        const finalAnswer = await this.llmService.generateContent(synthesisPrompt, 'nlq', false, activeModel, provider);

        return {
          action: 'api_call',
          graph: {
            nodes: graphResult.nodes,
            links: graphResult.links
          },
          reply: finalAnswer,
          translatedCypher: graphResult.translatedCypher,
          explanation: graphResult.explanation,
          targetNodeId: graphResult.nodes.length > 0 ? graphResult.nodes[0].id : null
        };
      } catch (err: any) {
        console.error('[ChatRouter] Internal /api/nlq execution failed, falling back to conversational explanation:', err.message);
        return {
          action: 'reply',
          reply: `### Search Error ⚠️\n\nI generated a database query for your request, but the database execution timed out or failed:\n\n* **Error Details:** \`${err.message}\`\n\nLet's try rephrasing your search or querying a different brand!`
        };
      }
    }

    // 4. Case B: Conversational Reply
    const conversationPrompt = `You are the expert AI Product Knowledge Graph Copilot.
You help users explore product hierarchies, competitor trees, and pricing structures.

Format your response in beautiful, premium Markdown (using bullet points, small tables, and bold highlights where appropriate) so it looks outstanding in the chat pane.

Active Conversational Context:
${history.slice(-4).map(h => `${h.role.toUpperCase()}: ${h.content}`).join('\n')}
USER: "${message}"
ASSISTANT:`;

    const answer = await this.llmService.generateContent(conversationPrompt, 'nlq', false, activeModel, provider);
    return {
      action: 'reply',
      reply: answer
    };
  }
}
