/**
 * CCJ Agent Base Class
 *
 * LLM call chain: Groq → Gemini → FreeLLMAPI (self-hosted proxy, optional).
 * Each provider is tried in order; the first one that returns usable
 * content wins. If all three fail, callLLM returns "" (empty string) —
 * callers already treat an empty/unparseable response as "AI analysis
 * unavailable" and fall back to their own non-fabricating defaults.
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

  /** Name of whichever provider actually answered the last callLLM() call. */
  protected lastModelUsed = "none";

  private async callGroq(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
    const key = process.env["GROQ_API_KEY"];
    if (!key) throw new Error("No GROQ_API_KEY");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        temperature: 0.15,
        max_tokens: maxTokens,
        // gpt-oss-120b is a reasoning model that spends tokens on internal
        // "reasoning" before the actual answer. Without capping this,
        // low max_tokens values can be exhausted entirely by reasoning,
        // leaving an empty `content` field (finish_reason: "length") even
        // though the request technically succeeded. "low" keeps reasoning
        // brief so more of max_tokens is available for the actual answer.
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      // Surface the actual API error body (not just the status code) so
      // failures like invalid model IDs, malformed params, or quota issues
      // are diagnosable from logs instead of a bare "Groq 400"/"Groq 404".
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Groq ${res.status}: ${bodyText.slice(0, 300)}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("Groq returned empty content");
    this.lastModelUsed = "groq/gpt-oss-120b";
    return content;
  }

  private async callGemini(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
    const key = process.env["GEMINI_API_KEY"];
    if (!key) throw new Error("No GEMINI_API_KEY");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(25000),
      }
    );
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${bodyText.slice(0, 300)}`);
    }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!content) throw new Error("Gemini returned empty content");
    this.lastModelUsed = "gemini-3.6-flash";
    return content;
  }

  /**
   * Self-hosted FreeLLMAPI proxy (https://github.com/tashfeenahmed/freellmapi).
   * Only attempted when FREELLMAPI_URL is explicitly configured — this is a
   * self-hosted server the user runs themselves, so there is no sensible
   * default endpoint to guess at (localhost:3001 is only correct if that
   * server is actually running).
   */
  private async callFreeLLMAPI(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
    const proxyUrl = process.env["FREELLMAPI_URL"];
    if (!proxyUrl) throw new Error("No FREELLMAPI_URL configured");
    // Accept either FREELLMAPI_KEY or FREELLMAPI_API_KEY, since both names
    // have been used for this project's key across different .env files.
    const proxyKey = process.env["FREELLMAPI_KEY"] || process.env["FREELLMAPI_API_KEY"] || "";

    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${proxyKey}`,
      },
      body: JSON.stringify({
        model: "auto",
        temperature: 0.15,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`FreeLLMAPI ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("FreeLLMAPI returned empty content");
    this.lastModelUsed = "freellmapi/auto";
    return content;
  }

  protected async callLLM(
    userPrompt: string,
    maxTokens = 800,
    _requestedModel = "auto" // retained for call-site compatibility; provider choice is now Groq→Gemini→FreeLLMAPI
  ): Promise<string> {
    const systemPrompt = this.systemPrompt;

    const providers: Array<() => Promise<string>> = [
      () => this.callGroq(systemPrompt, userPrompt, maxTokens),
      () => this.callGemini(systemPrompt, userPrompt, maxTokens),
      () => this.callFreeLLMAPI(systemPrompt, userPrompt, maxTokens),
    ];

    for (const callProvider of providers) {
      try {
        return await callProvider();
      } catch (error) {
        console.warn(`[${this.name}] provider failed, trying next:`, error instanceof Error ? error.message : error);
      }
    }

    console.error(`[${this.name}] All LLM providers failed (Groq, Gemini, FreeLLMAPI).`);
    this.lastModelUsed = "none";
    return "";
  }

  abstract run(data: unknown): Promise<AgentResult>;
}
