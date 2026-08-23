/**
 * CCJ AI Provider
 * Priority: Groq (free) → Gemini (free) → rule-based (always works)
 * Get free Groq key: https://console.groq.com
 * Get free Gemini key: https://aistudio.google.com
 */

export interface ResearchPlan {
  researchQuestions: string[];
  queries:           string[];
  keyEntities:       string[];
  legalQuestions:    string[];
  riskFlags:         string[];
}

// ── Groq (free tier: 14,400 req/day, very fast) ──────────────
async function groqComplete(prompt: string): Promise<string> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new Error("No GROQ_API_KEY");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model:       "llama-3.3-70b-versatile",
      temperature: 0.2,
      max_tokens:  800,
      messages:    [
        {
          role:    "system",
          content: "You are a research planning agent. Return only valid JSON, no markdown.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  };
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Gemini (free tier: 15 RPM, 1M tokens/day) ────────────────
async function geminiComplete(prompt: string): Promise<string> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("No GEMINI_API_KEY");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
      }),
      signal: AbortSignal.timeout(20000),
    }
  );

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ── Rule-based fallback (no key, always works) ────────────────
function ruleBasedPlan(topic: string): ResearchPlan {
  return {
    researchQuestions: [
      `What are the verified primary facts about: ${topic}?`,
      "Who are the key persons, organisations, and institutions involved?",
      "What official statements, documents, or legal provisions exist?",
      "Are there contradictory accounts or disputed claims?",
      "What is the chronological timeline of events?",
    ],
    queries: [
      topic,
      `${topic} official statement`,
      `${topic} news report`,
      `${topic} legal`,
    ],
    keyEntities:    [],
    legalQuestions: [],
    riskFlags:      ["Rule-based plan — set GROQ_API_KEY or GEMINI_API_KEY for AI-powered planning"],
  };
}

// ── Generate research plan — tries AI, falls back gracefully ──
export async function generateResearchPlan(topic: string): Promise<ResearchPlan> {
  const prompt = `
Generate a research plan for: "${topic}"
Return JSON only:
{
  "researchQuestions": ["..."],
  "queries": ["web search query 1", "..."],
  "keyEntities": ["person/org names"],
  "legalQuestions": ["..."],
  "riskFlags": ["..."]
}`;

  // Try Groq first (fastest), then Gemini, then rule-based
  for (const fn of [groqComplete, geminiComplete]) {
    try {
      const raw = await fn(prompt);
      const clean = raw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(clean) as ResearchPlan;
      if (Array.isArray(parsed.researchQuestions)) return parsed;
    } catch {
      // Try next
    }
  }

  return ruleBasedPlan(topic);
}

// ── Extract key claims from article text ──────────────────────
export async function extractClaims(
  text: string,
  source: string,
  topic: string
): Promise<string[]> {
  const prompt = `
From this article about "${topic}", extract 3-5 factual claims.
Source: ${source}
Text: ${text.slice(0, 2000)}

Return JSON array of claim strings only:
["claim 1", "claim 2"]`;

  for (const fn of [groqComplete, geminiComplete]) {
    try {
      const raw = await fn(prompt);
      const clean = raw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(clean) as string[];
      if (Array.isArray(parsed)) return parsed.slice(0, 5);
    } catch {
      // Continue
    }
  }

  // Fallback: take first 3 sentences
  return text
    .split(/[.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)
    .slice(0, 3);
}
