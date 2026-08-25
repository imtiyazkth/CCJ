/**
 * CCJ Agent Base Class
 * Fully integrated with FreeLLMAPI Proxy for automatic model fallback.
 */
export interface AgentResult {
  agentName:  string;
  output:     unknown;
  confidence: number;
  sources:    string[];
  reasoning:  string;
  duration:   number;
  model:      string;
}

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly systemPrompt: string;

  protected async callLLM(
    userPrompt: string,
    maxTokens = 800,
    requestedModel = "auto"
  ): Promise<string> {
    const PROXY_URL = process.env["FREELLMAPI_URL"] || "http://localhost:3001/v1/chat/completions";
    const PROXY_KEY = process.env["FREELLMAPI_KEY"] || "";
    const systemPrompt = this.systemPrompt;

    try {
      const response = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${PROXY_KEY}`,
        },
        body: JSON.stringify({
          model:           requestedModel, // "auto" lets proxy pick the best healthy model
          temperature:     0.15,
          max_tokens:      maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (!response.ok) {
        console.warn(`[FreeLLMAPI Proxy Warning] Status: ${response.status}`);
        return "";
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
      };

      return data.choices?.[0]?.message?.content ?? "";
    } catch (error) {
      console.error("[BaseAgent LLM Error]:", error);
      return "";
    }
  }

  abstract run(data: unknown): Promise<AgentResult>;
}
