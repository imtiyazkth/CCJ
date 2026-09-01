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
// Used both as a genuine fallback (no AI keys configured) and as a
// safety net when AI extraction fails/returns malformed JSON — so it
// must behave sanely even on long, multi-sentence instruction-style
// topics (e.g. "Research the causes and consequences of X. Find
// relevant YouTube videos and extract... Show the Evidence Vault...").
// Feeding an entire such paragraph as a search "entity" to every
// downstream search API produces useless/empty results, so we first
// reduce very long inputs down to their core subject before proceeding.
function extractCoreSubject(raw: string): string {
  // Take only the first sentence — later sentences are almost always
  // meta-instructions ("Show the Evidence Vault...", "generate a script")
  // rather than part of the actual research subject.
  const firstSentence = raw.split(/[.!?]\s/)[0] ?? raw;
  // Even a single long sentence can be 30+ words for elaborate prompts;
  // cap it so search queries stay usable rather than becoming a full
  // paragraph no search API can match well.
  const words = firstSentence.trim().split(/\s+/);
  return words.length > 20 ? words.slice(0, 20).join(" ") : firstSentence.trim();
}

function ruleBasedExtract(raw: string): CleanedQuery {
  const subject = extractCoreSubject(raw);
  let cleaned = subject;

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

  // Stop words (Hindi + English conversational filler)
  const STOP_WORDS = new Set([
    "the","a","an","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could","should",
    "what","who","where","when","how","why","which","this","that","these",
    "those","about","for","with","from","into","through","during",
    // Conjunctions, prepositions, comparatives — these pass the length>2
    // filter but produce useless standalone search queries like
    // "What is known about: and?" if not excluded.
    "and","but","or","nor","yet","so","because","since","although",
    "than","then","also","more","most","very","just","only","some",
    "any","all","each","every","both","either","neither","not","no",
    "becoming","become","becomes","being","seems","seem","seemed",
    "such","same","other","another","new","old","recent","recently",
    "major","minor","real","actual","true","many","much","few","several",
    "over","under","above","below","between","among","across","within",
    "without","against","toward","towards","upon","after","before",
    // Hindi stop words
    "karo","kiya","kya","hai","hain","mein","se","ke","ka","ki","ko",
    "aur","ya","yah","iska","uska","jab","tab","thi","tha","the",
    "thik","abhiyan","wala","wali","wale","jo","bhi","to","par","per",
    // Common filler
    "want","need","make","create","find","tell","show","help",
    "please","documentary","article","content","research","know",
  ]);

  // Generate keywords from meaningful words only (length > 2, not stop word).
  // CRITICAL: never search these words standalone — always anchored to the
  // entity/subject. A bare "economic development" query with no "Qatar"
  // pulls generic global results (COVID studies, unrelated papers) instead
  // of anything about the actual subject. Every keyword below therefore
  // includes the core entity.
  const significantWords = cleaned
    .split(" ")
    .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 5);

  // Use up to 2 significant words per pair so keywords stay specific
  // without collapsing back into the full (possibly long) subject string.
  const anchoredPairs: string[] = [];
  for (let i = 0; i < significantWords.length; i += 2) {
    const pair = significantWords.slice(i, i + 2).join(" ");
    if (pair && pair !== cleaned) anchoredPairs.push(`${cleaned} ${pair}`);
  }

  const keywords = [
    cleaned,                                              // full entity
    ...anchoredPairs,                                     // entity + thematic word-pairs
    intent !== "general" ? `${cleaned} ${intent}` : "",  // entity + intent
    `${cleaned} news`,
    `${cleaned} official`,
    intent === "legal"       ? `${cleaned} court` : "",
    intent === "biography"   ? `${cleaned} profile` : "",
    intent === "investigation"? `${cleaned} exposed` : "",
  ].filter(Boolean);

  return {
    cleanEntity:   cleaned,
    intent,
    keywords:      [...new Set(keywords)].slice(0, 10),
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
You are a precise Research Query Architect for an OSINT research platform.
Analyse this raw user input and extract structured research intent.
Return ONLY valid JSON — no markdown, no explanation.

Raw input: "${raw}"

CRITICAL RULES FOR "keywords":
1. Every keyword MUST contain the core entity/subject name. Never output a
   standalone thematic term alone (e.g. never just "economic development",
   "leadership", or "infrastructure" — these pull generic, unrelated
   results with no connection to the actual subject).
2. If the input asks about MULTIPLE distinct sub-topics, angles, people,
   or time periods (e.g. "trace the history from X to Y", "compare leader
   A and leader B", "cover economy, education, and diplomacy"), generate
   ONE keyword PER distinct sub-topic mentioned — do not collapse them
   into a handful of generic pairs. A request naming 6 different pillars
   needs roughly 6+ distinct, specific keywords, one per pillar.
3. Pair the entity with a SPECIFIC theme/actor/sub-topic/time-period per
   keyword, e.g. for subject "Qatar" with a request covering history,
   leadership, and education: "Qatar pearling economy 1930s collapse",
   "Qatar Sheikh Hamad bin Khalifa LNG North Field", "Qatar Sheikh Tamim
   National Vision 2030", "Qatar Education City Foundation universities",
   "Qatar Al Jazeera founding 1996", "Qatar Kafala labor rights criticism".
4. Prefer specific, named sub-topics (people's names, policy names, years,
   institution names) over vague single words.
5. Do not include unrelated generic domains (sports scores, unrelated
   legal topics, generic health studies) unless the subject is directly
   about that domain.
6. Generate up to 10 keywords if the input genuinely covers that many
   distinct sub-topics — do not artificially limit yourself to fewer
   keywords than the request's actual scope requires.

Return this exact schema:
{
  "cleanEntity": "core entity name (person/org/event/topic — no filler words)",
  "intent": "one of: biography | legal | current-events | investigation | statements | corporate | political | academic | general",
  "keywords": ["entity + specific sub-topic 1", "entity + specific sub-topic 2", "... one per distinct angle/pillar/person/era mentioned, up to 10"],
  "language": "en | hi | ar | bn | ta (detected from input)",
  "entityType": "person | organization | event | topic | place | unknown"
}`;

  async function callGroq(): Promise<string> {
    if (!GROQ_KEY) throw new Error("no groq");
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        temperature: 0.1,
        // 300 tokens was silently consumed entirely by this reasoning
        // model's internal chain-of-thought, leaving zero tokens for the
        // actual JSON answer — the root cause of AI query extraction
        // always failing and falling through to the rule-based extractor.
        // Raised further (600->900) since the prompt now asks for up to
        // 10 detailed, multi-word keyword strings instead of 5 short ones.
        max_tokens: 900,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a precise OSINT query parser. Return only valid JSON." },
          { role: "user",   content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const bodyText = await r.text().catch(() => "");
      throw new Error(`Groq ${r.status}: ${bodyText.slice(0, 300)}`);
    }
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content ?? "";
  }

  async function callGemini(): Promise<string> {
    if (!GEMINI_KEY) throw new Error("no gemini");
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 900, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) {
      const bodyText = await r.text().catch(() => "");
      throw new Error(`Gemini ${r.status}: ${bodyText.slice(0, 300)}`);
    }
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
          keywords:      parsed.keywords.slice(0, 10),
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
