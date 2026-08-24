/**
 * CCJ Module 1 — AI Query Cleaner & Entity Extractor
 *
 * Strips conversational noise, extracts core research entity,
 * detects intent, and generates optimal search keywords.
 *
 * Input:  "Who is Narendra Modi I want to make a documentary on him"
 * Output: { cleanEntity: "Narendra Modi", intent: "biography/documentary",
 *           keywords: ["Narendra Modi", "BJP Prime Minister", ...] }
 */

export interface CleanedQuery {
  cleanEntity:   string;
  intent:        string;
  keywords:      string[];
  language:      string;
  entityType:    "person" | "organization" | "event" | "topic" | "place" | "unknown";
  entitySlug:    string;   // URL-safe unique ID: "narendra-modi"
  originalQuery: string;
}

// ── Noise patterns to strip ───────────────────────────────────
const NOISE_PATTERNS = [
  /\b(i want to|i need to|i am|can you|please|help me|tell me|show me|find me)\b/gi,
  /\b(make a documentary|write an article|create content|research this|know about)\b/gi,
  /\b(on him|on her|on them|on it|about him|about her|about it)\b/gi,
  /\b(who is|what is|where is|when is|how is)\b/gi,
  /[?!]+/g,
];

// ── Intent detection rules ────────────────────────────────────
const INTENT_RULES: Array<{ pattern: RegExp; intent: string }> = [
  { pattern: /documentary|biography|life story|profile/i,  intent: "biography" },
  { pattern: /court|case|legal|FIR|arrest|verdict/i,        intent: "legal" },
  { pattern: /latest news|recent|today|yesterday|2025|2026/i, intent: "current-events" },
  { pattern: /scam|fraud|corruption|allegation|contro/i,    intent: "investigation" },
  { pattern: /speech|statement|quote|said|tweet|post/i,     intent: "statements" },
  { pattern: /company|startup|business|CEO|founded/i,       intent: "corporate" },
  { pattern: /government|minister|parliament|policy|law/i,  intent: "political" },
  { pattern: /research|study|paper|journal|finding/i,       intent: "academic" },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

function detectLanguage(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  return "en";
}

// ── Rule-based extractor (zero API calls, instant) ────────────
function ruleBasedExtract(raw: string): CleanedQuery {
  let cleaned = raw;

  // Strip noise
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Detect intent
  let intent = "general";
  for (const { pattern, intent: i } of INTENT_RULES) {
    if (pattern.test(raw)) { intent = i; break; }
  }

  // Entity type heuristic
  const isOrg    = /company|org|party|govt|ministry|corp|ltd|pvt|association/i.test(cleaned);
  const isEvent  = /protest|riot|election|match|summit|war|battle/i.test(cleaned);
  const isPlace  = /city|state|country|district|village|town|region/i.test(cleaned);
  const entityType = isOrg ? "organization" : isEvent ? "event" : isPlace ? "place" : "person";

  // Generate keyword expansions
  const base = cleaned.split(" ").filter(w => w.length > 2).slice(0, 5);
  const keywords = [
    cleaned,
    ...base,
    intent !== "general" ? `${cleaned} ${intent}` : "",
    `${cleaned} news`,
    `${cleaned} official`,
  ].filter(Boolean);

  return {
    cleanEntity:   cleaned,
    intent,
    keywords:      [...new Set(keywords)].slice(0, 8),
    language:      detectLanguage(raw),
    entityType,
    entitySlug:    slugify(cleaned),
    originalQuery: raw,
  };
}

// ── AI-powered extractor (uses Groq/Gemini if available) ──────
async function aiExtract(raw: string): Promise<CleanedQuery> {
  const GROQ_KEY   = process.env["GROQ_API_KEY"];
  const GEMINI_KEY = process.env["GEMINI_API_KEY"];
  if (!GROQ_KEY && !GEMINI_KEY) return ruleBasedExtract(raw);

  const prompt = `
You are a precise query cleaner for an OSINT research platform.
Analyse this raw user input and extract structured research intent.
Return ONLY valid JSON — no markdown, no explanation.

Raw input: "${raw}"

Return this exact schema:
{
  "cleanEntity": "core entity name (person/org/event — no filler words)",
  "intent": "one of: biography | legal | current-events | investigation | statements | corporate | political | academic | general",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "language": "en | hi | ar | bn | ta (detected from input)",
  "entityType": "person | organization | event | topic | place | unknown"
}`;

  async function callGroq(): Promise<string> {
    if (!GROQ_KEY) throw new Error("no groq");
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        max_tokens: 300,
        messages: [
          { role: "system", content: "You are a precise OSINT query parser. Return only valid JSON." },
          { role: "user",   content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content ?? "";
  }

  async function callGemini(): Promise<string> {
    if (!GEMINI_KEY) throw new Error("no gemini");
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const d = await r.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    };
    return d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  for (const fn of [callGroq, callGemini]) {
    try {
      const raw_response = await fn();
      const clean        = raw_response.replace(/```json\n?|```\n?/g, "").trim();
      const parsed       = JSON.parse(clean) as Partial<CleanedQuery>;

      if (parsed.cleanEntity && parsed.intent && Array.isArray(parsed.keywords)) {
        return {
          cleanEntity:   parsed.cleanEntity,
          intent:        parsed.intent,
          keywords:      parsed.keywords.slice(0, 8),
          language:      parsed.language ?? detectLanguage(raw),
          entityType:    parsed.entityType ?? "unknown",
          entitySlug:    slugify(parsed.cleanEntity),
          originalQuery: raw,
        };
      }
    } catch {
      // Try next
    }
  }

  return ruleBasedExtract(raw);
}

/**
 * Main export — call this before triggering any search pipeline.
 * Always returns a result even if AI fails.
 */
export async function extractSearchEntities(rawTopic: string): Promise<CleanedQuery> {
  const trimmed = rawTopic.trim();
  if (!trimmed) {
    return {
      cleanEntity: "", intent: "general", keywords: [],
      language: "en", entityType: "unknown",
      entitySlug: "", originalQuery: rawTopic,
    };
  }
  return aiExtract(trimmed);
}
