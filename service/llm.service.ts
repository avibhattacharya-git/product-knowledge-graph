import { appConfig } from '../configs/app.config';

export class LlmService {
  async generateContent(
    prompt: string,
    purpose: 'ingest' | 'nlq',
    forceJson = false,
    overrideModel?: string,
    overrideProvider?: 'gemini' | 'openai' | 'anthropic'
  ): Promise<string> {
    const provider = overrideProvider || appConfig.llm.activeProvider;
    const providerConfig = appConfig.llm[provider];
    const model = overrideModel || (purpose === 'ingest' ? providerConfig.ingestModel : providerConfig.nlqModel);

    if (provider === 'openai') {
      return this.callOpenAi(prompt, model, forceJson);
    } else if (provider === 'anthropic') {
      return this.callAnthropic(prompt, model, forceJson);
    } else {
      return this.callGemini(prompt, model, forceJson);
    }
  }

  private async callGemini(prompt: string, model: string, forceJson: boolean): Promise<string> {
    const apiKey = appConfig.geminiApiKey;
    if (!apiKey) {
      throw new Error('Gemini API key is not defined.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body: any = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    if (forceJson) {
      body.generationConfig = {
        responseMimeType: "application/json"
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Gemini API Error: Status ${res.status} - ${data.error?.message || 'Unknown Error'}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Empty response returned by Gemini.');
    }

    return text;
  }

  private async callOpenAi(prompt: string, model: string, forceJson: boolean): Promise<string> {
    const apiKey = appConfig.openAiApiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key is not defined.');
    }

    const body: any = {
      model: model,
      messages: [{ role: 'user', content: prompt }]
    };

    // Use max_completion_tokens for gpt-5.5 or o1 models; use max_tokens for others
    const isReasoningModel = model.startsWith('gpt-5.5') || model.startsWith('o1-') || model.startsWith('o3-');
    if (isReasoningModel) {
      body.max_completion_tokens = 4000;
    } else {
      body.max_tokens = 4000;
    }

    if (forceJson) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`OpenAI API Error: Status ${res.status} - ${data.error?.message || 'Unknown Error'}`);
    }

    const text = data.choices?.[0]?.message?.content;
    if (text === undefined || text === null) {
      throw new Error('Empty response returned by OpenAI.');
    }

    return text;
  }

  private async callAnthropic(prompt: string, model: string, forceJson: boolean): Promise<string> {
    const apiKey = appConfig.anthropicApiKey;
    if (!apiKey) {
      throw new Error('Anthropic API key is not defined.');
    }

    const body: any = {
      model: model,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Anthropic API Error: Status ${res.status} - ${data.error?.message || 'Unknown Error'}`);
    }

    const text = data.content?.[0]?.text;
    if (!text) {
      throw new Error('Empty response returned by Anthropic.');
    }

    return text;
  }
}
