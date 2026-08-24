/**
 * CCJ Agent Base Class (inspired by agency-agents pattern)
 * All specialist agents extend this.
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
    maxTokens = 800
  ): Promise<string> {
    const GROQ_KEY   = process.env["GROQ_API_KEY"];
    const GEMINI_KEY = process.env["GEMINI_API_KEY"];
    const systemPrompt = this.systemPrompt; // capture before async

    const callGroq = async (): Promise<string> => {
      if (!GROQ_KEY) throw new Error("no-groq");
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model:           "llama-3.3-70b-versatile",
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
      if (!r.ok) throw new Error(`Groq ${r.status}`);
      const d = await r.json() as {
        choices?: Array<{ message?: { content?: string } }>
      };
      return d.choices?.[0]?.message?.content ?? "";
    };

    const callGemini = async (): Promise<string> => {
      if (!GEMINI_KEY) throw new Error("no-gemini");
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: {
              temperature:      0.15,
              maxOutputTokens:  maxTokens,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(25000),
        }
      );
      if (!r.ok) throw new Error(`Gemini ${r.status}`);
      const d = await r.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      };
      return d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    };

    for (const fn of [callGroq, callGemini]) {
      try {
        const raw = await fn();
        if (raw.trim()) return raw;
      } catch { continue; }
    }
    return "";
  }

  abstract run(data: unknown): Promise<AgentResult>;
}
