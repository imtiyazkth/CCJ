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

/**
 * Generate a concise topic summary — "what is this and why does it matter?"
 * Used in the dossier to give users a clear overview before diving into sources.
 */

// ── Structured research analysis types ───────────────────────

export interface StructuredAnalysis {
  dashboard_result: {
    definition:        string;
    core_conclusion:   string;
    summary_narrative: string;
  };
  extracted_claims: Array<{
    claim:       string;
    source_name: string;
    verdict:     "Supported" | "Contradicted" | "Unverified" | "Disputed";
  }>;
  timeline_events: Array<{
    date:   string;
    event:  string;
    source: string;
  }>;
  key_entities: Array<{
    name: string;
    role: string;
    type: "person" | "organisation" | "place" | "concept";
  }>;
}

const STRUCTURED_SYSTEM_PROMPT = `You are an expert investigative researcher and analyst.
Your task is to analyse the provided source texts and synthesise a highly structured, objective report.

RULES:
- Do NOT output generic metadata like "This is a topic identified through OSINT".
- Read the actual content of the sources and extract real arguments, evidence, and events.
- Decode all HTML entities in titles (&amp; → &, &#39; → ', &lt; → <, &gt; → >).
- Be factual and neutral. Present multiple viewpoints when they exist.
- RESPOND ONLY with valid JSON — no markdown, no preamble, no explanation.`;

const STRUCTURED_USER_PROMPT = (
  topic: string,
  intent: string,
  keyFacts: string[],
  sourceTitles: string[]
) => `Analyse this research topic and sources:

TOPIC: "${topic}"
USER INTENT: ${intent}

SOURCE HEADLINES:
${sourceTitles.slice(0, 10).map((t, i) => `${i+1}. ${t}`).join("\n")}

KEY FACTS EXTRACTED:
${keyFacts.slice(0, 8).map((f, i) => `${i+1}. ${f}`).join("\n")}

Return ONLY this JSON structure (no markdown fences):
{
  "dashboard_result": {
    "definition": "Clear 2-sentence explanation of what this topic is.",
    "core_conclusion": "Direct answer to the user's question based on available evidence.",
    "summary_narrative": "Cohesive 3-4 sentence paragraph synthesising the different viewpoints found in the sources, citing specific articles or scholars."
  },
  "extracted_claims": [
    {
      "claim": "Specific claim found in the sources",
      "source_name": "Name of the article or scholar making this claim",
      "verdict": "Supported | Contradicted | Unverified | Disputed"
    }
  ],
  "timeline_events": [
    {
      "date": "YYYY-MM-DD or YYYY-MM or YYYY",
      "event": "Description of event or publication",
      "source": "Where this was found"
    }
  ],
  "key_entities": [
    {
      "name": "Entity name",
      "role": "Their role or significance to this topic",
      "type": "person | organisation | place | concept"
    }
  ]
}`;

export async function generateTopicSummary(
  topic:        string,
  keyFacts:     string[],
  sourceTitles: string[],
  intent:       string
): Promise<string> {
  // Returns raw JSON string — caller stores as-is, UI parses it
  const GROQ_KEY   = process.env["GROQ_API_KEY"];
  const GEMINI_KEY = process.env["GEMINI_API_KEY"];
  const prompt     = STRUCTURED_USER_PROMPT(topic, intent, keyFacts, sourceTitles);

  const callGroq = async (): Promise<string> => {
    if (!GROQ_KEY) throw new Error("no-groq");
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model:           "llama-3.3-70b-versatile",
        temperature:     0.15,
        max_tokens:      1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: STRUCTURED_SYSTEM_PROMPT },
          { role: "user",   content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content?.trim() ?? "";
  };

  const callGemini = async (): Promise<string> => {
    if (!GEMINI_KEY) throw new Error("no-gemini");
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${STRUCTURED_SYSTEM_PROMPT}\n\n${prompt}` }] }],
          generationConfig: {
            temperature:      0.15,
            maxOutputTokens:  1200,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const d = await r.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    };
    return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  };

  for (const fn of [callGroq, callGemini]) {
    try {
      const raw = await fn();
      if (raw && raw.length > 50) {
        // Validate it parses as JSON
        JSON.parse(raw);
        return raw;
      }
    } catch { continue; }
  }

  // Fallback: rule-based structured JSON
  return JSON.stringify({
    dashboard_result: {
      definition:        `${topic} is the subject of this research.`,
      core_conclusion:   `Based on available sources, this topic requires further investigation. ${keyFacts[0] ?? ""}`,
      summary_narrative: sourceTitles.slice(0, 3).join(". ") + ". Manual review of sources recommended.",
    },
    extracted_claims: sourceTitles.slice(0, 4).map(t => ({
      claim:       t,
      source_name: t.split(" - ").pop() ?? "Unknown source",
      verdict:     "Unverified" as const,
    })),
    timeline_events: [],
    key_entities:    [],
  } as StructuredAnalysis);
}
