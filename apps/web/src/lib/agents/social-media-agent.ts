/**
 * CCJ Social Media Agent (Module 3.1)
 *
 * Processes X/Twitter, Reddit, YouTube feeds.
 * Identifies: viral claims, original sources, user sentiment.
 * Flags: misinformation markers, echo chambers, bot signals.
 */
import { BaseAgent, type AgentResult } from "./base-agent";
import type { FetchResult } from "../providers/fetcher";

export interface SocialMediaAnalysis {
  viralClaims:     Array<{ claim: string; source: string; url: string; sentiment: string }>;
  originalSources: string[];
  sentiment:       "positive" | "negative" | "neutral" | "mixed";
  botRisk:         "low" | "medium" | "high";
  keyAccounts:     string[];
  summary:         string;
}

export class SocialMediaAgent extends BaseAgent {
  readonly name = "SocialMediaAgent";
  readonly systemPrompt = `
You are an expert OSINT Social Media Intelligence Analyst.
Analyse social media content and identify:
1. Viral claims being spread (with source attribution)
2. Original sources of information
3. Overall sentiment toward the entity/topic
4. Bot activity risk indicators
5. Key accounts driving narrative

Always return valid JSON matching the SocialMediaAnalysis schema.
Be precise. Flag unverified claims clearly.
`;

  async run(data: FetchResult[]): Promise<AgentResult> {
    const start = Date.now();
    const socialItems = data.filter(d =>
      ["twitter","reddit","youtube","instagram","facebook","threads"].includes(d.platform)
    );

    if (socialItems.length === 0) {
      return {
        agentName:  this.name,
        output:     { viralClaims:[], originalSources:[], sentiment:"neutral",
                      botRisk:"low", keyAccounts:[], summary:"No social media data available." },
        confidence: 0.0,
        sources:    [],
        reasoning:  "No social media items in input data",
        duration:   Date.now() - start,
        model:      "none",
      };
    }

    const prompt = `
Analyse these ${socialItems.length} social media items about the research topic:

${socialItems.map((item, i) =>
  `[${i+1}] Platform: ${item.platform}
  Title: ${item.title}
  Source: ${item.source}
  URL: ${item.url}
  Content: ${item.snippet.slice(0, 300)}
  Timestamp: ${item.timestamp ?? "unknown"}
`).join("\n---\n")}

Return JSON with this exact schema:
{
  "viralClaims": [{ "claim": "string", "source": "string", "url": "string", "sentiment": "positive|negative|neutral" }],
  "originalSources": ["account or outlet that posted first"],
  "sentiment": "positive|negative|neutral|mixed",
  "botRisk": "low|medium|high",
  "keyAccounts": ["@handle or outlet name"],
  "summary": "2-3 sentence analysis of the social media landscape"
}`;

    const raw = await this.callLLM(prompt, 600);
    let analysis: SocialMediaAnalysis;

    try {
      const parsed = JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as Partial<SocialMediaAnalysis>;
      // Defensive normalization — see NewsGovtAgent/FactCheckerAgent for
      // why: syntactically valid JSON can still omit/mistype fields.
      analysis = {
        viralClaims:     Array.isArray(parsed.viralClaims) ? parsed.viralClaims : [],
        originalSources: Array.isArray(parsed.originalSources) ? parsed.originalSources : [],
        sentiment:       parsed.sentiment ?? "neutral",
        botRisk:         parsed.botRisk ?? "low",
        keyAccounts:     Array.isArray(parsed.keyAccounts) ? parsed.keyAccounts : [],
        summary:         typeof parsed.summary === "string" ? parsed.summary : `Analysed ${socialItems.length} social media items.`,
      };
    } catch {
      analysis = {
        viralClaims:     [],
        originalSources: socialItems.slice(0, 3).map(i => i.source),
        sentiment:       "neutral",
        botRisk:         "low",
        keyAccounts:     [],
        summary:         `Found ${socialItems.length} social media items. AI analysis unavailable.`,
      };
    }

    return {
      agentName:  this.name,
      output:     analysis,
      confidence: socialItems.length > 3 ? 0.75 : 0.50,
      sources:    socialItems.map(i => i.url).slice(0, 10),
      reasoning:  `Processed ${socialItems.length} social media items across ${
        [...new Set(socialItems.map(i => i.platform))].join(", ")
      }`,
      duration:   Date.now() - start,
      model:      this.lastModelUsed,
    };
  }
}
