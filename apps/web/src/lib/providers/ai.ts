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
      model:       "openai/gpt-oss-120b",
      temperature: 0.2,
      max_tokens:  800,
      reasoning_effort: "low",
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

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${bodyText.slice(0, 300)}`);
  }
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
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

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${bodyText.slice(0, 300)}`);
  }
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
        model:           "openai/gpt-oss-120b",
        temperature:     0.15,
        max_tokens:      2000,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: STRUCTURED_SYSTEM_PROMPT },
          { role: "user",   content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      const bodyText = await r.text().catch(() => "");
      throw new Error(`Groq ${r.status}: ${bodyText.slice(0, 300)}`);
    }
    const d = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content?.trim() ?? "";
  };

  const callGemini = async (): Promise<string> => {
    if (!GEMINI_KEY) throw new Error("no-gemini");
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${STRUCTURED_SYSTEM_PROMPT}\n\n${prompt}` }] }],
          generationConfig: {
            temperature:      0.15,
            maxOutputTokens:  2000,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!r.ok) {
      const bodyText = await r.text().catch(() => "");
      throw new Error(`Gemini ${r.status}: ${bodyText.slice(0, 300)}`);
    }
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

// ══════════════════════════════════════════════════════════════════════
// YouTube research extensions (additive — nothing above this line is
// modified). Reuses the same try-Groq-then-Gemini-then-fallback pattern
// as generateTopicSummary above, but factors Groq/Gemini calls into
// standalone helper functions since this file's Groq/Gemini logic above
// is inlined per-function rather than shared.
//
// CRITICAL PRINCIPLE: a YouTube transcript is evidence of WHAT WAS SAID,
// never automatically evidence that the statement is TRUE. All prompts
// below preserve that distinction, and every fallback path defaults to
// "Unverified" — never "Supported" — since no independent verification
// occurred in the fallback path.
// ══════════════════════════════════════════════════════════════════════

async function youtubeGroqComplete(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new Error("No GROQ_API_KEY");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      temperature: 0.15,
      // Creator scripts need real room: title + hook + several narration
      // sections + ending + disclaimer, plus this model's internal
      // reasoning tokens are drawn from the same budget.
      max_tokens: 3000,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function youtubeGeminiComplete(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("No GEMINI_API_KEY");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 1200 },
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export type YoutubeClaimType =
  | "fact" | "statistic" | "historical_claim" | "political_claim"
  | "scientific_claim" | "religious_claim" | "opinion" | "prediction"
  | "accusation" | "quote" | "interpretation";

export interface ExtractedYoutubeClaim {
  claim: string;
  timestamp: number | null;
  speakerOrAttribution: string | null;
  claimType: YoutubeClaimType;
  importance: "low" | "medium" | "high";
}

const YOUTUBE_CLAIM_SYSTEM_PROMPT = `You are a careful investigative research analyst extracting claims from a YouTube video transcript.

CRITICAL RULES:
1. A transcript tells you what the SPEAKER said. It does not tell you whether it is true.
2. Extract only claims actually present in the transcript text given to you. Never invent claims.
3. Classify opinions ("I think...", "in my view...") as claimType "opinion", never as "fact".
4. Classify unverified numbers/statistics as claimType "statistic" regardless of how confident the speaker sounds.
5. Do not resolve or verify claims here — that happens in a separate step.
6. RESPOND ONLY with valid JSON — no markdown, no preamble.`;

/**
 * Extract structured, attributed claims from a (chunk of) YouTube transcript.
 * Does NOT assign a verification verdict — see verifyClaimsAgainstSources.
 */
export async function extractYoutubeClaims(
  transcriptChunk: string,
  chunkStartSeconds: number,
  videoTitle: string | null
): Promise<ExtractedYoutubeClaim[]> {
  const prompt = `Video title: ${videoTitle ?? "(unknown)"}
Transcript segment (starts at ~${Math.floor(chunkStartSeconds)}s into the video):
"""
${transcriptChunk.slice(0, 3000)}
"""

Extract up to 8 distinct factual/verifiable claims or notable opinions from this segment.

Return ONLY this JSON array (no markdown fences):
[
  {
    "claim": "Neutral restatement of what was said, e.g. 'The speaker states that...' ",
    "timestamp": ${Math.floor(chunkStartSeconds)},
    "speakerOrAttribution": "creator | narrator | quoted person's name if stated, else null",
    "claimType": "fact | statistic | historical_claim | political_claim | scientific_claim | religious_claim | opinion | prediction | accusation | quote | interpretation",
    "importance": "low | medium | high"
  }
]
If there are no extractable claims in this segment, return [].`;

  for (const fn of [youtubeGroqComplete, youtubeGeminiComplete]) {
    try {
      const raw = await fn(YOUTUBE_CLAIM_SYSTEM_PROMPT, prompt);
      const clean = raw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(clean) as ExtractedYoutubeClaim[];
      if (Array.isArray(parsed)) {
        return parsed
          .filter((c) => c && typeof c.claim === "string" && c.claim.trim().length > 0)
          .slice(0, 8)
          .map((c) => ({
            claim: c.claim,
            timestamp: typeof c.timestamp === "number" ? c.timestamp : chunkStartSeconds,
            speakerOrAttribution: c.speakerOrAttribution ?? null,
            claimType: (c.claimType as YoutubeClaimType) ?? "interpretation",
            importance: c.importance ?? "medium",
          }));
      }
    } catch {
      // try next provider
    }
  }

  // Deterministic, non-fabricating fallback: no AI available.
  // Do NOT invent claims — return empty rather than guess.
  return [];
}

export type ClaimVerdict =
  | "Supported" | "Contradicted" | "Partially Supported"
  | "Unverified" | "Disputed" | "Opinion" | "Insufficient Evidence";

export interface ClaimVerification {
  claim: string;
  verdict: ClaimVerdict;
  confidence: number; // 0..1
  reasoning: string;
  supportingSources: string[];
  contradictingSources: string[];
}

const VERIFICATION_SYSTEM_PROMPT = `You are a rigorous fact-verification analyst.

CRITICAL RULES:
1. A claim appearing in a YouTube transcript is NOT independent corroboration of itself.
2. Only mark a claim "Supported" if the provided independent source excerpts actually state or corroborate it.
3. If sources disagree, use "Contradicted" or "Disputed" and cite both sides — never silently pick one.
4. If no independent source excerpt addresses the claim at all, the verdict MUST be "Unverified" or "Insufficient Evidence" — never "Supported".
5. If the claim is an opinion/interpretation rather than a checkable fact, verdict is "Opinion".
6. RESPOND ONLY with valid JSON — no markdown, no preamble.`;

/**
 * Compare a set of extracted claims (e.g. from a YouTube transcript) against
 * independent source excerpts already gathered by the existing research
 * pipeline (web/news/official sources). Never marks a claim Supported solely
 * because it appears in the original video.
 */
export async function verifyClaimsAgainstSources(
  claims: string[],
  independentSourceExcerpts: Array<{ sourceName: string; excerpt: string }>
): Promise<ClaimVerification[]> {
  if (claims.length === 0) return [];

  const sourcesBlock = independentSourceExcerpts.length > 0
    ? independentSourceExcerpts
        .slice(0, 12)
        .map((s, i) => `[${i + 1}] ${s.sourceName}: ${s.excerpt.slice(0, 500)}`)
        .join("\n\n")
    : "(No independent sources were found for this topic.)";

  const prompt = `CLAIMS TO VERIFY:
${claims.slice(0, 15).map((c, i) => `${i + 1}. ${c}`).join("\n")}

INDEPENDENT SOURCE EXCERPTS:
${sourcesBlock}

For EACH claim, return ONLY this JSON array (no markdown fences):
[
  {
    "claim": "exact claim text as given",
    "verdict": "Supported | Contradicted | Partially Supported | Unverified | Disputed | Opinion | Insufficient Evidence",
    "confidence": 0.0,
    "reasoning": "One or two sentences explaining the verdict, referencing which source excerpt(s) informed it, or stating that no independent source addressed it.",
    "supportingSources": ["source names that corroborate this"],
    "contradictingSources": ["source names that contradict this"]
  }
]`;

  for (const fn of [youtubeGroqComplete, youtubeGeminiComplete]) {
    try {
      const raw = await fn(VERIFICATION_SYSTEM_PROMPT, prompt);
      const clean = raw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(clean) as ClaimVerification[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((v) => ({
          claim: v.claim,
          verdict: v.verdict ?? "Unverified",
          confidence: typeof v.confidence === "number" ? Math.min(1, Math.max(0, v.confidence)) : 0.3,
          reasoning: v.reasoning ?? "No reasoning provided by the model.",
          supportingSources: Array.isArray(v.supportingSources) ? v.supportingSources : [],
          contradictingSources: Array.isArray(v.contradictingSources) ? v.contradictingSources : [],
        }));
      }
    } catch {
      // try next provider
    }
  }

  // Deterministic fallback: never claim "Supported" without an AI/manual
  // check actually having compared sources. Default to Unverified.
  return claims.map((claim) => ({
    claim,
    verdict: "Unverified" as const,
    confidence: 0,
    reasoning: independentSourceExcerpts.length === 0
      ? "No independent sources were found, and no AI provider was available to assess this claim."
      : "AI verification providers were unavailable; this claim has not been checked against the gathered sources yet.",
    supportingSources: [],
    contradictingSources: [],
  }));
}

export type CreatorScriptMode =
  | "short" | "explainer" | "deep_research" | "documentary" | "social_thread";
export type CreatorScriptLanguage = "en" | "hi" | "hinglish";

export interface CreatorScriptSection {
  heading: string;
  narration: string;
  sourceRefs: string[];
}

export interface CreatorScript {
  title: string;
  hook: string;
  sections: CreatorScriptSection[];
  ending: string;
  disclaimer: string;
}

const SCRIPT_MODE_GUIDANCE: Record<CreatorScriptMode, string> = {
  short: "60 seconds. Extremely tight. One hook, one core point, one takeaway. No sub-sections.",
  explainer: "3-5 minutes. Hook, context, what happened, evidence, what's disputed, conclusion.",
  deep_research: "8-15 minutes. Full structure: hook, context, what happened, key evidence, viewpoints, contradictions, what's verified, what's unclear, why it matters, timeline, conclusion.",
  documentary: "15-30 minutes. Documentary pacing, deliberate scene-setting, full evidence walkthrough, multiple viewpoints, extended timeline, reflective conclusion.",
  social_thread: "A numbered social media thread (8-12 posts). Each section is one post-length chunk (<280 chars for the hook, slightly more for body posts).",
};

const SCRIPT_LANGUAGE_GUIDANCE: Record<CreatorScriptLanguage, string> = {
  en: "Write in clear, natural English.",
  hi: "Write in Hindi (Devanagari script). Keep proper nouns, statistics, and technical terms accurate — do not mistranslate numbers or names.",
  hinglish: "Write in natural Hinglish (Roman-script Hindi-English code-mixing as commonly used by Indian YouTube creators). Keep proper nouns, statistics, and technical terms accurate.",
};

const SCRIPT_SYSTEM_PROMPT = `You are a professional investigative content creator and scriptwriter.

CRITICAL RULES — THESE OVERRIDE STYLE PREFERENCES:
1. Never state an unverified or disputed claim as settled fact. Use phrasing like "the video claims...", "according to X...", "this has not been independently confirmed...".
2. Never invent dialogue, eyewitnesses, numbers, quotations, motives, or causation not present in the supplied research data.
3. Preserve important counterarguments and disputed points — do not manufacture false consensus.
4. The script must read naturally (storytelling, not a database dump) while remaining strictly accurate to the supplied research.
5. Tag factual statements internally using the sourceRefs array (ids provided to you), not inline raw URLs in the narration text.
6. RESPOND ONLY with valid JSON — no markdown, no preamble.`;

export interface ScriptResearchInput {
  topic: string;
  coreConclusion: string;
  verifiedClaims: Array<{ id: string; claim: string; verdict: string }>;
  unverifiedClaims: Array<{ id: string; claim: string }>;
  disputedClaims: Array<{ id: string; claim: string; sides: string }>;
  timelineEvents: Array<{ date: string; event: string }>;
  researchGaps: Array<{ description: string }>;
}

/**
 * Generate a creator-style script from an ALREADY-RESEARCHED dataset.
 * This function must never be called with just a raw topic string —
 * callers must run research + verification first (see research route).
 */
export async function generateCreatorScript(
  input: ScriptResearchInput,
  mode: CreatorScriptMode,
  language: CreatorScriptLanguage
): Promise<CreatorScript> {
  const prompt = `TOPIC: ${input.topic}
CORE CONCLUSION FROM RESEARCH: ${input.coreConclusion}

VERIFIED/SUPPORTED CLAIMS (safe to state plainly, still cite sourceRefs):
${input.verifiedClaims.map((c) => `- [${c.id}] (${c.verdict}) ${c.claim}`).join("\n") || "(none)"}

UNVERIFIED CLAIMS (must be attributed, e.g. "the video claims..."):
${input.unverifiedClaims.map((c) => `- [${c.id}] ${c.claim}`).join("\n") || "(none)"}

DISPUTED / CONTRADICTED CLAIMS (must present both sides, never pick one):
${input.disputedClaims.map((c) => `- [${c.id}] ${c.claim} — ${c.sides}`).join("\n") || "(none)"}

TIMELINE:
${input.timelineEvents.map((t) => `- ${t.date}: ${t.event}`).join("\n") || "(none established)"}

RESEARCH GAPS (mention what remains unknown, do not fill them with guesses):
${input.researchGaps.map((g) => `- ${g.description}`).join("\n") || "(none identified)"}

MODE: ${mode} — ${SCRIPT_MODE_GUIDANCE[mode]}
LANGUAGE: ${SCRIPT_LANGUAGE_GUIDANCE[language]}

Return ONLY this JSON (no markdown fences):
{
  "title": "Compelling but accurate title",
  "hook": "Opening 1-3 sentences that pull the viewer in without overstating unverified facts",
  "sections": [
    { "heading": "e.g. CONTEXT / WHAT HAPPENED / EVIDENCE / WHAT'S DISPUTED / WHY IT MATTERS", "narration": "Natural spoken narration for this section", "sourceRefs": ["claim/evidence ids referenced, from the ids given above"] }
  ],
  "ending": "Closing 1-3 sentences",
  "disclaimer": "One or two sentences noting which parts remain unverified/disputed, if any"
}`;

  for (const fn of [youtubeGroqComplete, youtubeGeminiComplete]) {
    try {
      const raw = await fn(SCRIPT_SYSTEM_PROMPT, prompt);
      const clean = raw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(clean) as CreatorScript;
      if (parsed && typeof parsed.title === "string" && Array.isArray(parsed.sections)) {
        return {
          title: parsed.title,
          hook: parsed.hook ?? "",
          sections: parsed.sections.map((s) => ({
            heading: s.heading ?? "",
            narration: s.narration ?? "",
            sourceRefs: Array.isArray(s.sourceRefs) ? s.sourceRefs : [],
          })),
          ending: parsed.ending ?? "",
          disclaimer: parsed.disclaimer ??
            (input.unverifiedClaims.length + input.disputedClaims.length > 0
              ? "Some claims in this piece remain unverified or disputed; see the research dashboard for details."
              : ""),
        };
      }
    } catch {
      // try next provider
    }
  }

  // Both AI narrative providers failed or returned unusable output.
  // Per product requirement: never silently substitute a raw structured-
  // data dump as if it were a generated script. Surface an explicit error
  // so the caller can show "Script generation unavailable" instead of
  // pretending a script was produced.
  throw new Error(
    "CREATOR_SCRIPT_GENERATION_FAILED: All configured AI narrative providers " +
    "(Groq, Gemini) failed to generate a script. No script was produced."
  );
}
